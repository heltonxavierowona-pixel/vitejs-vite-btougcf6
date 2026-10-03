'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  api,
  type EntitySummary,
  type Paginated,
  type Party,
  type Product,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { computeTotals, type LineInput, type VatRateKey } from '@/lib/vat';
import {
  amountToInput,
  formatMoney,
  formatQuantity,
  fromDateInput,
  parseAmount,
  parsePercent,
  parseQuantity,
  toDateInput,
  vatRateLabel,
} from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  Textarea,
  errorMessage,
} from '@/components/ui';

export interface EditableInvoice {
  id: string;
  direction: 'SALE' | 'PURCHASE';
  issuedAt: string;
  dueAt: string | null;
  customerId: string | null;
  supplierId: string | null;
  supplierReference: string | null;
  vatNonDeductible?: boolean;
  notes: string | null;
  terms: string | null;
  lines: Array<{
    productId: string | null;
    label: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    discountPct: number;
    vatRate: VatRateKey;
    isService?: boolean;
    stateBorne?: boolean;
  }>;
}

interface DraftLine extends LineInput {
  key: string;
  label: string;
  productId?: string;
  /** Prestation de services : TVA exigible à l'encaissement (CGI art. 134). */
  isService: boolean;
  /** TVA prise en charge par l'État : mention sur la ligne (CGI art. 150). */
  stateBorne: boolean;
  /** Saisies brutes : on ne reformate pas pendant la frappe. */
  rawQuantity: string;
  rawUnitPrice: string;
  rawDiscount: string;
}

let lineCounter = 0;
const newKey = () => `l${Date.now().toString(36)}${lineCounter++}`;

const emptyLine = (vatRate: VatRateKey = 'STANDARD'): DraftLine => ({
  key: newKey(),
  label: '',
  isService: false,
  stateBorne: false,
  quantity: 1000,
  unitPrice: 0,
  discountPct: 0,
  vatRate,
  rawQuantity: '1',
  rawUnitPrice: '',
  rawDiscount: '',
});

/**
 * ============================================================
 *  SAISIE DE FACTURE — création et modification de brouillon
 * ============================================================
 *
 *  Écran le plus délicat du produit : conversion d'unités,
 *  calcul en direct, et une action irréversible à la fin.
 *
 *  Règles d'interface :
 *  - Les totaux sont calculés par le MÊME moteur que le serveur
 *    (lib/tax), mais le serveur recalcule tout à l'enregistrement.
 *  - L'enregistrement produit TOUJOURS un brouillon. La
 *    validation est un second geste, explicite.
 * ============================================================
 */
export function InvoiceForm({
  entityId,
  direction,
  invoice,
  canValidate,
}: {
  entityId: string;
  direction: 'SALE' | 'PURCHASE';
  invoice?: EditableInvoice;
  canValidate: boolean;
}) {
  const router = useRouter();
  const { current } = useAuth();
  const isSale = direction === 'SALE';
  const isEdit = !!invoice;
  const [entity, setEntity] = useState<EntitySummary | null>(null);
  // Entreprise à l'IGS : pas de TVA sur ses ventes (CGI art. 132).
  const isIgs = isSale && entity?.taxRegime === 'IGS';
  const [vatNonDeductible, setVatNonDeductible] = useState(
    invoice?.vatNonDeductible ?? false,
  );

  const [parties, setParties] = useState<Party[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [partyId, setPartyId] = useState(
    (isSale ? invoice?.customerId : invoice?.supplierId) ?? '',
  );
  const [issuedAt, setIssuedAt] = useState(
    invoice ? toDateInput(invoice.issuedAt) : toDateInput(new Date()),
  );
  const [dueAt, setDueAt] = useState(
    invoice?.dueAt ? toDateInput(invoice.dueAt) : '',
  );
  const [supplierReference, setSupplierReference] = useState(
    invoice?.supplierReference ?? '',
  );
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [terms, setTerms] = useState(invoice?.terms ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    invoice?.lines.length
      ? invoice.lines.map((line) => ({
          key: newKey(),
          label: line.label,
          productId: line.productId ?? undefined,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPct: line.discountPct,
          vatRate: line.vatRate,
          isService: !!line.isService,
          stateBorne: !!line.stateBorne,
          rawQuantity: formatQuantity(line.quantity),
          rawUnitPrice: amountToInput(line.unitPrice),
          rawDiscount: line.discountPct ? String(line.discountPct / 100).replace('.', ',') : '',
        }))
      : [emptyLine()],
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [partyList, productList] = await Promise.all([
          api.get<Paginated<Party>>(
            `/entities/${entityId}/${isSale ? 'customers' : 'suppliers'}?pageSize=200`,
          ),
          api.get<Product[]>(`/entities/${entityId}/products`),
        ]);
        setParties(partyList.items);
        setProducts(productList);
      } catch (err) {
        setError(errorMessage(err, 'Chargement impossible'));
        setParties([]);
      }
    })();
  }, [entityId, isSale]);

  useEffect(() => {
    if (!current?.organizationId) return;
    api
      .get<EntitySummary>(`/organizations/${current.organizationId}/entities/${entityId}`)
      .then((data) => {
        setEntity(data);
        // Nouvelle vente d'une entreprise à l'IGS : lignes sans TVA.
        if (isSale && !invoice && data.taxRegime === 'IGS') {
          setLines((prev) =>
            prev.map((line) =>
              line.vatRate === 'STANDARD' ? { ...line, vatRate: 'EXEMPT' } : line,
            ),
          );
        }
      })
      .catch(() => setEntity(null));
  }, [current?.organizationId, entityId, isSale, invoice]);

  const totals = useMemo(() => computeTotals(lines), [lines]);

  const selectedParty = parties?.find((p) => p.id === partyId);

  // Le NIU du client assujetti est obligatoire sur une facture
  // normalisée : on prévient ici plutôt qu'au moment de la
  // validation, où c'est trop tard.
  const missingNiu = isSale && !!selectedParty?.isVatSubject && !selectedParty.niu;
  // Achat sans NIU du fournisseur : TVA non déductible (LPF art. L 101).
  const supplierWithoutNiu = !isSale && !!selectedParty && !selectedParty.niu;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function applyProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    updateLine(key, {
      productId: product.id,
      label: product.label,
      unitPrice: product.unitPrice,
      rawUnitPrice: amountToInput(product.unitPrice),
      vatRate: isIgs ? 'EXEMPT' : product.vatRate,
      isService: product.isService,
    });
  }

  async function save(thenValidate: boolean) {
    setError(null);

    const usable = lines.filter((line) => line.label.trim() && line.quantity > 0);
    if (usable.length === 0) {
      setError('Ajoutez au moins une ligne avec une désignation et une quantité.');
      return;
    }
    if (usable.some((line) => line.unitPrice <= 0)) {
      setError('Chaque ligne doit avoir un prix unitaire supérieur à zéro.');
      return;
    }
    if (!partyId) {
      setError(isSale ? 'Choisissez un client.' : 'Choisissez un fournisseur.');
      return;
    }
    if (dueAt && dueAt < issuedAt) {
      setError('L’échéance de paiement ne peut pas précéder la date de facture.');
      return;
    }
    if (
      thenValidate &&
      !window.confirm(
        'La facture va recevoir son numéro définitif et ne pourra plus être ' +
          'modifiée. Pour la corriger ensuite, il faudra émettre un avoir. Continuer ?',
      )
    ) {
      return;
    }

    const body = {
      direction,
      issuedAt: fromDateInput(issuedAt),
      ...(dueAt && { dueAt: fromDateInput(dueAt) }),
      ...(isSale
        ? { customerId: partyId }
        : {
            supplierId: partyId,
            supplierReference: supplierReference.trim() || undefined,
            vatNonDeductible,
          }),
      notes: notes.trim() || undefined,
      terms: terms.trim() || undefined,
      lines: usable.map((line) => ({
        ...(line.productId && { productId: line.productId }),
        label: line.label.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct ?? 0,
        vatRate: line.vatRate,
        isService: line.isService,
        stateBorne: line.stateBorne && line.vatRate === 'STANDARD',
      })),
    };

    setSaving(true);
    let savedId = invoice?.id;
    try {
      if (isEdit) {
        await api.put(`/entities/${entityId}/invoices/${invoice.id}`, body);
      } else {
        const created = await api.post<{ id: string }>(
          `/entities/${entityId}/invoices`,
          body,
        );
        savedId = created.id;
      }
    } catch (err) {
      setError(errorMessage(err, 'Enregistrement impossible.'));
      setSaving(false);
      return;
    }

    const detail = `/entreprise/${entityId}/factures/${savedId}`;

    if (thenValidate) {
      try {
        await api.post(`/entities/${entityId}/invoices/${savedId}/validate`);
      } catch (err) {
        // Le brouillon est enregistré : on y renvoie avec le motif
        // du refus, plutôt que de laisser l'utilisateur recliquer
        // (ce qui créerait un doublon).
        router.push(
          `${detail}?refus=${encodeURIComponent(errorMessage(err, 'Validation impossible.'))}`,
        );
        return;
      }
    }

    router.push(detail);
  }

  const partyLabel = isSale ? 'Client' : 'Fournisseur';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto pb-40 sm:pb-32">
      <PageHeader
        title={
          isEdit
            ? 'Modifier le brouillon'
            : isSale
              ? 'Nouvelle facture de vente'
              : 'Nouvelle facture d’achat'
        }
        subtitle={
          isSale
            ? 'Enregistrée en brouillon. Elle reçoit son numéro définitif à la validation.'
            : 'Saisissez la facture reçue de votre fournisseur : sa TVA sera déductible.'
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Panel title={partyLabel}>
        <div className="p-4 space-y-4">
          {parties !== null && parties.length === 0 ? (
            <Alert tone="info">
              Aucun {isSale ? 'client' : 'fournisseur'} enregistré.{' '}
              <Link
                href={`/entreprise/${entityId}/tiers?onglet=${isSale ? 'customers' : 'suppliers'}&nouveau=1`}
                className="font-medium underline"
              >
                En créer un
              </Link>
            </Alert>
          ) : (
            <Field label={partyLabel}>
              <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">
                  {parties === null ? 'Chargement…' : '— Choisir —'}
                </option>
                {parties?.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                    {party.niu ? ` · ${party.niu}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {supplierWithoutNiu && (
            <Alert tone="warning">
              Ce fournisseur n’a pas de NIU : la TVA de cette facture ne sera pas
              déductible (LPF art. L 101). Ajoutez son NIU sur sa fiche s’il figure
              sur la facture.
            </Alert>
          )}

          {isIgs && (
            <Alert tone="info">
              Votre entreprise relève de l’impôt général synthétique (IGS) : elle ne
              facture pas de TVA (CGI art. 132). Laissez les lignes en « Exonéré ».
            </Alert>
          )}

          {missingNiu && (
            <Alert tone="warning">
              Ce client est assujetti à la TVA mais n’a pas de NIU. La
              validation sera refusée tant qu’il manque.
            </Alert>
          )}

          <div className={`grid gap-4 ${isSale ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            <Field label="Date de facture">
              <Input
                type="date"
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
                required
              />
            </Field>
            <Field label="Échéance de paiement" hint="Facultatif">
              <Input
                type="date"
                value={dueAt}
                min={issuedAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
            {!isSale && (
              <Field label="N° de la facture fournisseur" hint="Facultatif">
                <Input
                  value={supplierReference}
                  maxLength={60}
                  onChange={(e) => setSupplierReference(e.target.value)}
                />
              </Field>
            )}
          </div>

          {!isSale && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={vatNonDeductible}
                  onChange={(e) => setVatNonDeductible(e.target.checked)}
                />
                <span>
                  TVA non déductible : hébergement, restauration, réception,
                  spectacle, location de véhicule de tourisme (CGI art. 144)
                </span>
              </label>
              <p className="text-xs text-inksoft">
                Un achat de 100 000 FCFA ou plus réglé en espèces perd aussi son
                droit à déduction (CGI art. 143). Préférez un virement ou le Mobile
                Money.
              </p>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Lignes"
        action={
          <Button
            variant="ghost"
            className="h-8 px-3"
            onClick={() =>
              setLines((prev) => [...prev, emptyLine(isIgs ? 'EXEMPT' : 'STANDARD')])
            }
          >
            Ajouter une ligne
          </Button>
        }
      >
        <p className="px-4 pt-3 text-xs text-inksoft">
          Nature : pour un <strong>service</strong>, la TVA est déclarée le mois où
          vous êtes payé ; pour un <strong>bien</strong>, le mois de la facture (CGI
          art. 134).
        </p>
        <ul className="divide-y divide-line">
          {lines.map((line, index) => {
            const result = totals.lines[index];
            return (
              <li key={line.key} className="p-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      placeholder="Désignation"
                      aria-label={`Désignation de la ligne ${index + 1}`}
                      value={line.label}
                      maxLength={255}
                      onChange={(e) =>
                        updateLine(line.key, { label: e.target.value })
                      }
                    />
                  </div>
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      className="h-10 px-3 text-critical"
                      onClick={() =>
                        setLines((prev) => prev.filter((l) => l.key !== line.key))
                      }
                      aria-label={`Retirer la ligne ${index + 1}`}
                    >
                      Retirer
                    </Button>
                  )}
                </div>

                {products.length > 0 && (
                  <Select
                    value=""
                    aria-label="Reprendre un article du catalogue"
                    onChange={(e) => applyProduct(line.key, e.target.value)}
                  >
                    <option value="">Reprendre un article du catalogue…</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.label} · {formatMoney(product.unitPrice)}
                      </option>
                    ))}
                  </Select>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <Field label="Nature">
                    <Select
                      value={line.isService ? 'SERVICE' : 'GOODS'}
                      onChange={(e) =>
                        updateLine(line.key, { isService: e.target.value === 'SERVICE' })
                      }
                    >
                      <option value="GOODS">Bien</option>
                      <option value="SERVICE">Service</option>
                    </Select>
                  </Field>

                  <Field label="Quantité">
                    <Input
                      inputMode="decimal"
                      value={line.rawQuantity}
                      onChange={(e) =>
                        updateLine(line.key, {
                          rawQuantity: e.target.value,
                          quantity: parseQuantity(e.target.value),
                        })
                      }
                    />
                  </Field>

                  <Field label="Prix unitaire HT">
                    <Input
                      inputMode="numeric"
                      placeholder="0"
                      value={line.rawUnitPrice}
                      onChange={(e) =>
                        updateLine(line.key, {
                          rawUnitPrice: e.target.value,
                          unitPrice: parseAmount(e.target.value),
                        })
                      }
                    />
                  </Field>

                  <Field label="Remise %">
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      value={line.rawDiscount}
                      onChange={(e) =>
                        updateLine(line.key, {
                          rawDiscount: e.target.value,
                          discountPct: parsePercent(e.target.value),
                        })
                      }
                    />
                  </Field>

                  <Field label="TVA">
                    <Select
                      value={line.stateBorne ? 'STATE' : line.vatRate}
                      onChange={(e) =>
                        updateLine(
                          line.key,
                          e.target.value === 'STATE'
                            ? { vatRate: 'STANDARD', stateBorne: true }
                            : { vatRate: e.target.value as VatRateKey, stateBorne: false },
                        )
                      }
                    >
                      {Object.entries(vatRateLabel).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                      {isSale && !isIgs && (
                        <option value="STATE">TVA 19,25 % prise en charge État</option>
                      )}
                    </Select>
                  </Field>

                  <div className="col-span-2 sm:col-span-1">
                    <span className="block text-sm font-medium mb-1.5">
                      Total HT
                    </span>
                    <div className="h-10 flex items-center justify-end px-3 bg-surface rounded-[4px] text-sm font-medium tabular">
                      {formatMoney(result?.exclVat ?? 0)}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Mentions">
        <div className="p-4 space-y-4">
          <Field label="Note visible sur le document" hint="Facultatif">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </Field>
          {isSale && (
            <Field
              label="Conditions de paiement"
              hint="Ex. : paiement à 30 jours par virement ou Mobile Money"
            >
              <Textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </Field>
          )}
        </div>
      </Panel>

      {/* Barre de totaux — reste visible pendant la saisie */}
      <div className="fixed bottom-0 left-0 right-0 bg-paper border-t border-line z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-4 sm:gap-6 text-sm tabular">
            <span>
              <span className="text-inksoft">HT </span>
              {formatMoney(totals.subtotalExclVat)}
            </span>
            <span>
              <span className="text-inksoft">TVA </span>
              {formatMoney(totals.vatAmount)}
            </span>
            <span className="font-semibold">
              <span className="text-inksoft font-normal">TTC </span>
              {formatMoney(totals.totalInclVat)}
            </span>
          </div>

          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
              {isEdit ? 'Enregistrer' : 'Enregistrer en brouillon'}
            </Button>
            {canValidate && (
              <Button onClick={() => save(true)} disabled={saving || missingNiu}>
                {saving ? 'Enregistrement…' : 'Enregistrer et valider'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
