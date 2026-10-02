'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { canEdit, canWrite, useAuth } from '@/lib/auth-context';
import { computeTotals, type VatRateKey } from '@/lib/vat';
import {
  amountToInput,
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  fromDateInput,
  invoiceStatusLabel,
  parseAmount,
  paymentMethodLabel,
  toDateInput,
  vatRateLabel,
} from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Modal,
  Panel,
  Select,
  errorMessage,
} from '@/components/ui';

interface InvoiceDetail {
  id: string;
  number: string | null;
  status: string;
  type: 'INVOICE' | 'CREDIT_NOTE' | 'PROFORMA';
  direction: 'SALE' | 'PURCHASE';
  issuedAt: string;
  dueAt: string | null;
  partyName: string | null;
  partyNiu: string | null;
  supplierReference: string | null;
  subtotalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  paidAmount: number;
  creditedAmount: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  customer?: { name: string; niu: string | null; withholdsVat?: boolean } | null;
  supplier?: { name: string; niu: string | null } | null;
  originalInvoice: { id: string; number: string | null } | null;
  lines: Array<{
    id: string;
    label: string;
    quantity: number;
    unitPrice: number;
    discountPct: number;
    vatRate: string;
    lineExclVat: number;
    lineVat: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    paidAt: string;
    reference: string | null;
    vatWithheld?: number;
  }>;
  creditNotes: Array<{ id: string; number: string; totalInclVat: number }>;
}

type Dialog = 'validate' | 'credit' | 'payment' | 'delete' | null;

function InvoiceDetailView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { entityId, invoiceId } = useParams<{
    entityId: string;
    invoiceId: string;
  }>();
  const { current } = useAuth();
  const role = current?.role;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get('refus'));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const base = `/entities/${entityId}/invoices/${invoiceId}`;

  const load = useCallback(async () => {
    try {
      setInvoice(await api.get<InvoiceDetail>(base));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Facture introuvable'));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Exécute une action ; recharge la fiche si elle a réussi. */
  async function run(action: () => Promise<unknown>, reload = true) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      if (reload) await load();
    } catch (err) {
      setError(errorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !invoice) {
    return (
      <div className="p-6">
        <Alert tone="error">{loadError}</Alert>
      </div>
    );
  }

  if (!invoice) return <Loading />;

  const isDraft = invoice.status === 'DRAFT';
  const isCancelled = invoice.status === 'CANCELLED';
  const isCreditNote = invoice.type === 'CREDIT_NOTE';
  const isSale = invoice.direction === 'SALE';
  const party = invoice.customer ?? invoice.supplier;
  const creditable = invoice.totalInclVat - invoice.creditedAmount;

  const title = isCreditNote
    ? isSale
      ? 'Avoir'
      : 'Avoir fournisseur'
    : isSale
      ? 'Facture'
      : 'Facture d’achat';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {title}{' '}
            <span className="tabular">{invoice.number ?? '(brouillon)'}</span>
          </h1>
          <p className="mt-1 text-sm text-inksoft">
            {invoice.partyName ?? party?.name ?? '—'} ·{' '}
            {formatDate(invoice.issuedAt)} ·{' '}
            {invoiceStatusLabel[invoice.status] ?? invoice.status}
          </p>
          {invoice.supplierReference && (
            <p className="text-sm text-inksoft">
              Réf. fournisseur : {invoice.supplierReference}
            </p>
          )}
          {invoice.originalInvoice && (
            <p className="text-sm text-inksoft">
              Corrige la facture{' '}
              <Link
                href={`/entreprise/${entityId}/factures/${invoice.originalInvoice.id}`}
                className="text-primary font-medium tabular"
              >
                {invoice.originalInvoice.number}
              </Link>
            </p>
          )}
        </div>

        <Button
          variant="secondary"
          onClick={() =>
            api
              .openPdf(`${base}/pdf`)
              .catch((err) => setError(errorMessage(err, 'PDF indisponible')))
          }
        >
          Ouvrir le PDF
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {isDraft && (
        <Alert tone="warning">
          Ce brouillon n’entre pas dans votre déclaration de TVA. Validez-le
          pour qu’il soit pris en compte.
        </Alert>
      )}

      {isCancelled && (
        <Alert tone="error">
          Cette facture est entièrement annulée par avoir.
        </Alert>
      )}

      {/* Mentions obligatoires (CGI art. 150) et droit à déduction (LPF L 101) */}
      {!isCancelled && !(invoice.partyNiu ?? party?.niu) && (
        <Alert tone="warning">
          {isSale
            ? 'Le NIU du client n’apparaît pas sur cette facture. Il fait partie des mentions obligatoires (CGI art. 150) : s’il en a un, ajoutez-le sur sa fiche avant de valider. Une facture incomplète est passible d’une amende (LPF art. L 102).'
            : 'Cette facture d’achat ne porte pas le NIU du fournisseur : sa TVA n’est pas déductible (LPF art. L 101).'}
        </Alert>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <>
            {canEdit(role) && (
              <Button onClick={() => setDialog('validate')}>
                Valider la facture
              </Button>
            )}
            {canWrite(role) && (
              <Link href={`/entreprise/${entityId}/factures/${invoiceId}/modifier`}>
                <Button variant="secondary">Modifier</Button>
              </Link>
            )}
            {canEdit(role) && (
              <Button
                variant="ghost"
                className="text-critical"
                onClick={() => setDialog('delete')}
              >
                Supprimer
              </Button>
            )}
          </>
        )}

        {!isDraft && !isCancelled && !isCreditNote && (
          <>
            {invoice.balanceDue > 0 && canWrite(role) && (
              <Button onClick={() => setDialog('payment')}>
                {isSale ? 'Enregistrer un encaissement' : 'Enregistrer un paiement'}
              </Button>
            )}
            {canEdit(role) && creditable > 0 && (
              <Button variant="secondary" onClick={() => setDialog('credit')}>
                Émettre un avoir
              </Button>
            )}
          </>
        )}
      </div>

      {/* Lignes */}
      <Panel title="Détail">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-xs text-inksoft border-b border-line">
                <th className="font-medium px-4 py-2.5">Désignation</th>
                <th className="font-medium px-4 py-2.5 text-right">Qté</th>
                <th className="font-medium px-4 py-2.5 text-right">P.U. HT</th>
                <th className="font-medium px-4 py-2.5 text-right">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3">
                    <span className="block">{line.label}</span>
                    <span className="block text-xs text-inksoft">
                      {vatRateLabel[line.vatRate] ?? line.vatRate}
                      {line.discountPct > 0 &&
                        ` · remise ${formatPercent(line.discountPct)}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {formatQuantity(line.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {formatMoney(line.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {formatMoney(line.lineExclVat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line px-4 py-3 space-y-1.5 text-sm">
          <Line label="Total HT" value={invoice.subtotalExclVat} />
          <Line label="TVA" value={invoice.vatAmount} />
          <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-line">
            <span>Total TTC</span>
            <span className="tabular">{formatMoney(invoice.totalInclVat)}</span>
          </div>
          {invoice.creditedAmount > 0 && (
            <Line label="Avoirs émis" value={-invoice.creditedAmount} />
          )}
          {invoice.paidAmount > 0 && (
            <Line
              label={isSale ? 'Encaissé' : 'Payé'}
              value={-invoice.paidAmount}
            />
          )}
          {!isDraft && !isCreditNote && !isCancelled && (
            <div className="flex justify-between pt-1.5 font-medium">
              <span>Reste dû</span>
              <span className="tabular">{formatMoney(invoice.balanceDue)}</span>
            </div>
          )}
        </div>
      </Panel>

      {(invoice.terms || invoice.notes) && (
        <Panel title="Mentions">
          <div className="p-4 space-y-2 text-sm whitespace-pre-line">
            {invoice.terms && <p>{invoice.terms}</p>}
            {invoice.notes && <p className="text-inksoft">{invoice.notes}</p>}
          </div>
        </Panel>
      )}

      {/* Règlements */}
      {invoice.payments.length > 0 && (
        <Panel title={isSale ? 'Encaissements' : 'Paiements'}>
          <ul className="divide-y divide-line">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  {formatDate(payment.paidAt)} ·{' '}
                  {paymentMethodLabel[payment.method] ?? payment.method}
                  {payment.reference && (
                    <span className="text-inksoft"> · {payment.reference}</span>
                  )}
                </span>
                <span className="tabular font-medium shrink-0">
                  {formatMoney(payment.amount)}
                  {!!payment.vatWithheld && (
                    <span className="block text-xs text-inksoft">
                      + TVA retenue {formatMoney(payment.vatWithheld)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Avoirs liés */}
      {invoice.creditNotes.length > 0 && (
        <Panel title="Avoirs émis">
          <ul className="divide-y divide-line">
            {invoice.creditNotes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/entreprise/${entityId}/factures/${note.id}`}
                  className="flex justify-between px-4 py-3 text-sm hover:bg-surface"
                >
                  <span className="tabular">{note.number}</span>
                  <span className="tabular">−{formatMoney(note.totalInclVat)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---- Dialogues ---- */}
      {dialog === 'validate' && (
        <Modal title="Valider cette facture" onClose={() => setDialog(null)}>
          <p className="text-sm">
            La facture recevra son numéro définitif et ne pourra plus être
            modifiée. Pour la corriger ensuite, il faudra émettre un avoir.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Annuler
            </Button>
            <Button
              disabled={busy}
              onClick={() => run(() => api.post(`${base}/validate`))}
            >
              {busy ? 'Validation…' : 'Valider définitivement'}
            </Button>
          </div>
        </Modal>
      )}

      {dialog === 'delete' && (
        <Modal title="Supprimer ce brouillon" onClose={() => setDialog(null)}>
          <p className="text-sm">
            Le brouillon sera supprimé. Aucun numéro ne lui ayant été attribué,
            la numérotation n’est pas affectée.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.delete(base);
                  router.push(`/entreprise/${entityId}/factures`);
                }, false)
              }
            >
              {busy ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        </Modal>
      )}

      {dialog === 'payment' && (
        <PaymentDialog
          remaining={invoice.balanceDue}
          withholdableVat={
            isSale && invoice.customer?.withholdsVat
              ? Math.max(
                  0,
                  invoice.vatAmount -
                    invoice.payments.reduce((sum, p) => sum + (p.vatWithheld ?? 0), 0),
                )
              : 0
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(body) => run(() => api.post(`${base}/payments`, body))}
        />
      )}

      {dialog === 'credit' && (
        <CreditNoteDialog
          creditable={creditable}
          alreadyCredited={invoice.creditedAmount > 0}
          minDate={toDateInput(invoice.issuedAt)}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            run(async () => {
              const note = await api.post<{ id: string }>(`${base}/credit-note`, body);
              router.push(`/entreprise/${entityId}/factures/${note.id}`);
            }, false)
          }
        />
      )}
    </div>
  );
}

export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoiceDetailView />
    </Suspense>
  );
}

// ------------------------------------------------------------

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-inksoft">{label}</span>
      <span className="tabular">
        {value < 0 ? `−${formatMoney(-value)}` : formatMoney(value)}
      </span>
    </div>
  );
}

function PaymentDialog({
  remaining,
  withholdableVat,
  busy,
  onClose,
  onSubmit,
}: {
  remaining: number;
  /** TVA encore retenable à la source par ce client (CGI art. 149-2). */
  withholdableVat: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const defaultWithheld = Math.min(withholdableVat, remaining);
  const [rawWithheld, setRawWithheld] = useState(
    defaultWithheld > 0 ? amountToInput(defaultWithheld) : '',
  );
  const [raw, setRaw] = useState(amountToInput(remaining - defaultWithheld));
  const [method, setMethod] = useState('MOBILE_MONEY_MTN');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(toDateInput(new Date()));

  const amount = parseAmount(raw);
  const vatWithheld = withholdableVat > 0 ? parseAmount(rawWithheld) : 0;
  const tooMuch = amount + vatWithheld > remaining;
  const invalid =
    amount <= 0 || tooMuch || vatWithheld > withholdableVat;

  return (
    <Modal title="Enregistrer un règlement" onClose={onClose}>
      <Field
        label="Montant reçu (FCFA)"
        hint={`Reste dû : ${formatMoney(remaining)}`}
        error={tooMuch ? 'Supérieur au reste dû' : undefined}
      >
        <Input inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </Field>

      {withholdableVat > 0 && (
        <Field
          label="TVA retenue à la source par le client (FCFA)"
          hint="Ce client reverse lui-même la TVA aux impôts (CGI art. 149-2). Gardez son attestation : elle vous permet de déduire ce montant."
          error={vatWithheld > withholdableVat ? 'Supérieure à la TVA de la facture' : undefined}
        >
          <Input
            inputMode="numeric"
            value={rawWithheld}
            onChange={(e) => setRawWithheld(e.target.value)}
          />
        </Field>
      )}

      <Field label="Moyen de paiement">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(paymentMethodLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Référence" hint="N° de transaction, de chèque… (facultatif)">
        <Input
          value={reference}
          maxLength={120}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>

      <Field label="Date">
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </Field>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={busy || invalid || !paidAt}
          onClick={() =>
            onSubmit({
              amount,
              ...(vatWithheld > 0 && { vatWithheld }),
              method,
              reference: reference.trim() || undefined,
              paidAt: fromDateInput(paidAt),
            })
          }
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Avoir total (reprend toutes les lignes) ou partiel (un montant
 * HT et un taux). Le serveur refuse tout dépassement du montant
 * restant de la facture.
 */
function CreditNoteDialog({
  creditable,
  alreadyCredited,
  minDate,
  busy,
  onClose,
  onSubmit,
}: {
  creditable: number;
  alreadyCredited: boolean;
  minDate: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [mode, setMode] = useState<'full' | 'partial'>(
    alreadyCredited ? 'partial' : 'full',
  );
  const [issuedAt, setIssuedAt] = useState(toDateInput(new Date()));
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('Avoir commercial');
  const [rawAmount, setRawAmount] = useState('');
  const [vatRate, setVatRate] = useState<VatRateKey>('STANDARD');

  const amount = parseAmount(rawAmount);
  const preview = computeTotals([{ unitPrice: amount, quantity: 1000, vatRate }]);
  const tooHigh = mode === 'partial' && preview.totalInclVat > creditable;

  return (
    <Modal title="Émettre un avoir" onClose={onClose} wide>
      {!alreadyCredited && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['full', 'Avoir total'],
              ['partial', 'Avoir partiel'],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`h-10 rounded-[4px] border text-sm font-medium ${
                mode === key
                  ? 'border-primary bg-primarysoft text-primary'
                  : 'border-line text-inksoft'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <p className="text-sm">
        {mode === 'full'
          ? 'L’avoir total reprend toutes les lignes et annule la facture. Il est définitif dès sa création.'
          : `Montant restant pouvant être crédité : ${formatMoney(creditable)} TTC.`}
      </p>

      {mode === 'partial' && (
        <>
          <Field label="Désignation">
            <Input value={label} maxLength={255} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant HT (FCFA)">
              <Input
                inputMode="numeric"
                value={rawAmount}
                onChange={(e) => setRawAmount(e.target.value)}
              />
            </Field>
            <Field label="TVA">
              <Select value={vatRate} onChange={(e) => setVatRate(e.target.value as VatRateKey)}>
                {Object.entries(vatRateLabel).map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {amount > 0 && (
            <p className={`text-sm tabular ${tooHigh ? 'text-critical' : 'text-inksoft'}`}>
              Avoir TTC : {formatMoney(preview.totalInclVat)}
              {tooHigh && ' — dépasse le montant restant'}
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date de l’avoir">
          <Input
            type="date"
            value={issuedAt}
            min={minDate}
            onChange={(e) => setIssuedAt(e.target.value)}
          />
        </Field>
        <Field label="Motif" hint="Facultatif">
          <Input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={
            busy ||
            !issuedAt ||
            (mode === 'partial' && (amount <= 0 || !label.trim() || tooHigh))
          }
          onClick={() =>
            onSubmit({
              issuedAt: fromDateInput(issuedAt),
              isFull: mode === 'full',
              reason: reason.trim() || undefined,
              ...(mode === 'partial' && {
                lines: [
                  { label: label.trim(), quantity: 1000, unitPrice: amount, vatRate },
                ],
              }),
            })
          }
        >
          {busy ? 'Création…' : 'Émettre l’avoir'}
        </Button>
      </div>
    </Modal>
  );
}
