'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api } from '@/lib/api';
import { canEdit, useAuth } from '@/lib/auth-context';
import {
  declarationStatusLabel,
  formatDate,
  formatDateLong,
  formatMoney,
  formatPeriod,
  fromDateInput,
  toDateInput,
  urgencyLabel,
  urgencyStyles,
  type Urgency,
} from '@/lib/format';
import { Alert, Button, Field, Input, Loading, Modal, Panel, errorMessage } from '@/components/ui';

const exclusionLabel: Record<string, string> = {
  NO_NIU: 'Facture sans NIU du fournisseur (LPF art. L 101)',
  CASH: 'Payée en espèces, 100 000 FCFA ou plus (CGI art. 143)',
  EXCLUDED_EXPENSE: 'Dépense exclue par nature (CGI art. 144)',
};

interface Declaration {
  id: string;
  type: string;
  status: string;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  dueDate: string;
  daysLeft: number;
  urgency: Urgency;
  vatCollected: number;
  vatDeductible: number;
  vatCredit: number;
  vatWithheld: number;
  vatExcluded: number;
  vatDue: number;
  carryForward: number;
  turnoverExclVat: number;
  taxableBase: number;
  creditMonths: number;
  creditNeedsValidation: boolean;
  salesWithoutDgiReference: number;
  purchasesWithoutDgiReference: number;
  excludedPurchases: Array<{
    id: string;
    number: string | null;
    partyName: string | null;
    vatAmount: number;
    reasons: Array<'NO_NIU' | 'CASH' | 'EXCLUDED_EXPENSE'>;
  }>;
  submittedAt: string | null;
  receiptRef: string | null;
  paidAt: string | null;
  pendingDrafts: number;
  isStale: boolean;
  estimatedPenalty: number;
  invoices: Array<{
    id: string;
    number: string | null;
    direction: 'SALE' | 'PURCHASE';
    type: string;
    partyName: string | null;
    issuedAt: string;
    subtotalExclVat: number;
    vatAmount: number;
  }>;
}

/**
 * ============================================================
 *  DÉCLARATION TVA
 * ============================================================
 *
 *  Le cœur de valeur : un mois de factures devient une
 *  déclaration prête à déposer.
 *
 *  ⚠️ Le dépôt reste MANUEL. L'utilisateur dépose sur le
 *  portail de la DGI puis saisit ici la référence de l'accusé.
 *  L'interface doit le dire clairement plutôt que de laisser
 *  croire à un envoi automatique.
 * ============================================================
 */
export default function DeclarationPage() {
  const params = useParams<{
    entityId: string;
    year: string;
    month: string;
  }>();
  const { entityId, year, month } = params;
  const { current } = useAuth();
  const editor = canEdit(current?.role);

  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  const [notPrepared, setNotPrepared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'submit' | 'paid' | null>(null);

  const path = `/entities/${entityId}/declarations/${year}/${month}`;

  const fetchDeclaration = useCallback(async () => {
    setDeclaration(await api.get<Declaration>(path));
    setNotPrepared(false);
    setError(null);
  }, [path]);

  const compute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${path}/compute`);
      await fetchDeclaration();
    } catch (err) {
      setError(errorMessage(err, 'Calcul impossible'));
    } finally {
      setBusy(false);
    }
  }, [path, fetchDeclaration]);

  useEffect(() => {
    void (async () => {
      try {
        // Existe-t-elle déjà ? (évite une requête en erreur 404)
        const list = await api.get<Array<{ periodMonth: number }>>(
          `/entities/${entityId}/declarations?year=${Number(year)}`,
        );
        if (list.some((d) => d.periodMonth === Number(month))) {
          await fetchDeclaration();
        } else if (editor) {
          // Pas encore préparée : un comptable la génère à la volée,
          // les autres rôles voient simplement qu'elle reste à faire.
          await compute();
        } else {
          setNotPrepared(true);
        }
      } catch (err) {
        setError(errorMessage(err, 'Chargement impossible'));
      }
    })();
  }, [entityId, year, month, fetchDeclaration, compute, editor]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await fetchDeclaration();
      setDialog(null);
    } catch (err) {
      setError(errorMessage(err, 'Enregistrement impossible'));
    } finally {
      setBusy(false);
    }
  }

  const periodLabel = formatPeriod(Number(year), Number(month));

  if (notPrepared) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">
          Déclaration TVA — {periodLabel}
        </h1>
        <Alert tone="info">
          Cette déclaration n’a pas encore été préparée par un comptable du dossier.
        </Alert>
      </div>
    );
  }

  if (error && !declaration) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }

  if (!declaration) return <Loading label="Calcul en cours…" />;

  const submitted =
    declaration.status === 'SUBMITTED' || declaration.status === 'PAID';
  const isNil = declaration.type === 'VAT_NIL';
  const style = urgencyStyles[declaration.urgency];

  const sales = declaration.invoices.filter((i) => i.direction === 'SALE');
  const purchases = declaration.invoices.filter(
    (i) => i.direction === 'PURCHASE',
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Déclaration TVA — {declaration.periodLabel}
        </h1>
        <p className={`mt-1 text-sm ${submitted ? 'text-safe' : style.text}`}>
          {submitted
            ? `Déposée le ${formatDate(declaration.submittedAt!)}`
            : `${urgencyLabel(declaration.daysLeft)} · dépôt au plus tard le ${formatDateLong(declaration.dueDate)}`}
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {declaration.isStale && !submitted && (
        <Alert tone="warning">
          Des factures ou des encaissements ont changé depuis le dernier calcul.{' '}
          {editor ? 'Recalculez avant de déposer.' : 'Un comptable doit la recalculer.'}
        </Alert>
      )}

      {declaration.pendingDrafts > 0 && !submitted && (
        <Alert tone="warning">
          {declaration.pendingDrafts} brouillon
          {declaration.pendingDrafts > 1 ? 's datés' : ' daté'} de ce mois
          {declaration.pendingDrafts > 1 ? ' ne sont' : ' n’est'} pas pris en
          compte.{' '}
          <Link
            href={`/entreprise/${entityId}/factures?statut=DRAFT`}
            className="font-medium underline"
          >
            Voir les brouillons
          </Link>
        </Alert>
      )}

      {declaration.estimatedPenalty > 0 && (
        <Alert tone="error">
          Échéance dépassée : pénalité estimée à{' '}
          <span className="font-semibold tabular">
            {formatMoney(declaration.estimatedPenalty)}
          </span>{' '}
          (10 % de la TVA due par mois de retard commencé, plafonnée à 30 % :
          LPF art. L 106 ; estimation indicative). Déposez au plus vite.
        </Alert>
      )}

      {isNil && !submitted && (
        <Alert tone="warning">
          Aucune opération sur la période. La déclaration « néant » reste
          obligatoire (CGI art. 152-5). Après mise en demeure, l’absence de
          déclaration coûte 50 000 à 200 000 FCFA selon votre centre des impôts
          (LPF art. L 97), et une déclaration néant ou créditrice déposée
          seulement après mise en demeure, 1 000 000 FCFA (LPF art. L 99).
        </Alert>
      )}

      {/* Liquidation */}
      <Panel title="Liquidation">
        <dl className="divide-y divide-line text-sm">
          <Row label="Chiffre d’affaires HT" value={declaration.turnoverExclVat} />
          {declaration.taxableBase > 0 && (
            <Row
              label="Base imposable au taux général (arrondie au millier inférieur, CGI art. 141)"
              value={declaration.taxableBase}
            />
          )}
          <Row label="TVA collectée sur ventes" value={declaration.vatCollected} />
          <Row
            label="TVA déductible sur achats"
            value={declaration.vatDeductible}
          />
          {declaration.vatWithheld > 0 && (
            <Row
              label="TVA retenue à la source par vos clients (attestations à joindre)"
              value={declaration.vatWithheld}
            />
          )}
          {declaration.vatCredit > 0 && (
            <Row
              label="Crédit antérieur reporté"
              value={declaration.vatCredit}
            />
          )}
        </dl>

        <div className="border-t border-line px-4 py-4 flex items-baseline justify-between">
          {declaration.vatDue > 0 ? (
            <>
              <span className="font-semibold">TVA nette à payer</span>
              <span className="text-xl font-semibold tabular">
                {formatMoney(declaration.vatDue)}
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold">Crédit reportable</span>
              <span className="text-xl font-semibold tabular text-safe">
                {formatMoney(declaration.carryForward)}
              </span>
            </>
          )}
        </div>
      </Panel>

      <p className="text-xs text-inksoft">
        TVA collectée : ventes de biens selon la date de facture, prestations de
        services selon la date d’encaissement (CGI art. 134).
      </p>

      {declaration.vatExcluded > 0 && (
        <Panel title="TVA d’achats non déductible">
          <p className="px-4 pt-3 text-sm text-inksoft">
            {formatMoney(declaration.vatExcluded)} de TVA payée sur vos achats ne peut
            pas être déduite ce mois-ci.
          </p>
          <ul className="divide-y divide-line text-sm">
            {declaration.excludedPurchases.map((p) => (
              <li key={p.id} className="px-4 py-3 flex justify-between gap-3">
                <span className="min-w-0">
                  <Link
                    href={`/entreprise/${entityId}/factures/${p.id}`}
                    className="text-primary font-medium tabular"
                  >
                    {p.number}
                  </Link>{' '}
                  {p.partyName}
                  <span className="block text-xs text-inksoft">
                    {p.reasons.map((r) => exclusionLabel[r]).join(' · ')}
                  </span>
                </span>
                <span className="tabular shrink-0">{formatMoney(p.vatAmount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(declaration.salesWithoutDgiReference > 0 ||
        declaration.purchasesWithoutDgiReference > 0) && (
        <Alert tone="warning">
          {[
            declaration.salesWithoutDgiReference > 0 &&
              `${declaration.salesWithoutDgiReference} facture(s) de vente`,
            declaration.purchasesWithoutDgiReference > 0 &&
              `${declaration.purchasesWithoutDgiReference} facture(s) d’achat`,
          ]
            .filter(Boolean)
            .join(' et ')}{' '}
          de la période n’ont pas de référence DGI. Toute facture doit passer par le
          système de facturation électronique de la DGI : sinon la TVA et la charge ne
          sont pas déductibles (CGI art. 8 bis et 143) et l’émetteur risque une amende
          égale au montant des factures (LPF art. L 8 bis). Saisissez les références
          depuis chaque facture.{' '}
          <Link
            href={`/entreprise/${entityId}/factures`}
            className="font-medium underline"
          >
            Voir les factures
          </Link>
        </Alert>
      )}

      {declaration.creditNeedsValidation && (
        <Alert tone="warning">
          Vous reportez un crédit de TVA depuis {declaration.creditMonths} mois. Pour
          une activité de commerce général, un report au-delà de 3 mois n’est admis
          qu’après validation par les services des impôts (CGI art. 149-3).
          Rapprochez-vous de votre centre des impôts.
        </Alert>
      )}

      <Panel title="Exporter les factures du mois">
        <div className="p-4 space-y-3 text-sm">
          <p className="text-inksoft">
            Pour les reporter sur la plateforme de la DGI ou les transmettre à votre
            comptable sans ressaisie.
          </p>
          {(['SALE', 'PURCHASE'] as const).map((direction) => (
            <div key={direction} className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-medium">
                {direction === 'SALE' ? 'Ventes' : 'Achats'}
              </span>
              {(['xlsx', 'csv', 'xml'] as const).map((format) => (
                <Button
                  key={format}
                  variant="secondary"
                  className="h-8 px-3"
                  onClick={() =>
                    api
                      .download(
                        `/entities/${entityId}/exports/invoices?year=${year}&month=${month}&direction=${direction}&format=${format}`,
                        `${direction === 'SALE' ? 'ventes' : 'achats'}-${year}-${String(month).padStart(2, '0')}.${format}`,
                      )
                      .catch((err) => setError(errorMessage(err, 'Export impossible')))
                  }
                >
                  {format === 'xlsx' ? 'Excel' : format.toUpperCase()}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </Panel>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            api
              .openPdf(`/entities/${entityId}/declarations/${declaration.id}/pdf`)
              .catch((err) => setError(errorMessage(err, 'PDF indisponible')))
          }
        >
          Ouvrir le récapitulatif
        </Button>

        {!submitted && editor && (
          <>
            <Button variant="secondary" onClick={compute} disabled={busy}>
              {busy ? 'Recalcul…' : 'Recalculer'}
            </Button>
            <Button
              onClick={() => setDialog('submit')}
              disabled={busy || declaration.isStale}
            >
              Enregistrer le dépôt
            </Button>
          </>
        )}

        {declaration.status === 'SUBMITTED' && editor && declaration.vatDue > 0 && (
          <Button onClick={() => setDialog('paid')} disabled={busy}>
            Enregistrer le paiement
          </Button>
        )}
      </div>

      {!submitted && (
        <Alert tone="info">
          Le dépôt s’effectue sur le portail de la DGI. Une fois déposée,
          revenez saisir la référence de votre accusé pour clore l’échéance.
        </Alert>
      )}

      {submitted && (declaration.receiptRef || declaration.paidAt) && (
        <Alert tone="info">
          {declaration.receiptRef && (
            <>
              Accusé de dépôt :{' '}
              <span className="font-medium tabular">{declaration.receiptRef}</span>
              {declaration.paidAt && ' · '}
            </>
          )}
          {declaration.paidAt && `TVA payée le ${formatDate(declaration.paidAt)}`}
        </Alert>
      )}

      {/* Détail des opérations */}
      {declaration.invoices.length > 0 && (
        <>
          <OperationList
            title={`Ventes (${sales.length})`}
            entityId={entityId}
            items={sales}
          />
          {purchases.length > 0 && (
            <OperationList
              title={`Achats (${purchases.length})`}
              entityId={entityId}
              items={purchases}
            />
          )}
        </>
      )}

      {dialog === 'submit' && (
        <SubmitDialog
          busy={busy}
          vatDue={declaration.vatDue}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            act(() => api.post(`/entities/${entityId}/declarations/${declaration.id}/submit`, body))
          }
        />
      )}

      {dialog === 'paid' && (
        <PaidDialog
          busy={busy}
          vatDue={declaration.vatDue}
          onClose={() => setDialog(null)}
          onSubmit={(paidAt) =>
            act(() =>
              api.post(`/entities/${entityId}/declarations/${declaration.id}/paid`, { paidAt }),
            )
          }
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <dt className="text-inksoft">{label}</dt>
      <dd className="tabular">{formatMoney(value)}</dd>
    </div>
  );
}

function OperationList({
  title,
  entityId,
  items,
}: {
  title: string;
  entityId: string;
  items: Declaration['invoices'];
}) {
  return (
    <Panel title={title}>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const isCreditNote = item.type === 'CREDIT_NOTE';
          return (
            <li key={item.id}>
              <Link
                href={`/entreprise/${entityId}/factures/${item.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface"
              >
                <div className="min-w-0">
                  <span className="block truncate">
                    {item.partyName ?? '—'}
                    {isCreditNote && (
                      <span className="text-inksoft"> · avoir</span>
                    )}
                  </span>
                  <span className="block text-xs text-inksoft tabular">
                    {item.number} · {formatDate(item.issuedAt)}
                  </span>
                </div>
                <div className="text-right shrink-0 tabular">
                  <span className="block">
                    {isCreditNote && '−'}
                    {formatMoney(item.subtotalExclVat)}
                  </span>
                  <span className="block text-xs text-inksoft">
                    TVA {isCreditNote && '−'}
                    {formatMoney(item.vatAmount)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SubmitDialog({
  busy,
  vatDue,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  vatDue: number;
  onClose: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [receiptRef, setReceiptRef] = useState('');
  const [submittedAt, setSubmittedAt] = useState(toDateInput(new Date()));

  return (
    <Modal title="Enregistrer le dépôt" onClose={onClose}>
      <p className="text-sm text-inksoft">
        Déposez d’abord la déclaration sur le portail de la DGI
        {vatDue > 0 ? ` (TVA à payer : ${formatMoney(vatDue)})` : ''}, puis
        saisissez ici la référence de l’accusé. Les montants seront figés.
      </p>

      <Field label="Date de dépôt">
        <Input
          type="date"
          value={submittedAt}
          max={toDateInput(new Date())}
          onChange={(e) => setSubmittedAt(e.target.value)}
        />
      </Field>

      <Field label="Référence de l’accusé" hint="Facultatif mais recommandé">
        <Input
          value={receiptRef}
          maxLength={120}
          onChange={(e) => setReceiptRef(e.target.value)}
        />
      </Field>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={busy || !submittedAt}
          onClick={() =>
            onSubmit({
              submittedAt: fromDateInput(submittedAt),
              receiptRef: receiptRef.trim() || undefined,
            })
          }
        >
          {busy ? 'Enregistrement…' : 'Confirmer le dépôt'}
        </Button>
      </div>
    </Modal>
  );
}

function PaidDialog({
  busy,
  vatDue,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  vatDue: number;
  onClose: () => void;
  onSubmit: (paidAt: string) => void;
}) {
  const [paidAt, setPaidAt] = useState(toDateInput(new Date()));

  return (
    <Modal title="Enregistrer le paiement de la TVA" onClose={onClose}>
      <p className="text-sm text-inksoft">
        Montant réglé au Trésor : <span className="tabular font-medium">{formatMoney(vatDue)}</span>
      </p>
      <Field label="Date de paiement">
        <Input
          type="date"
          value={paidAt}
          max={toDateInput(new Date())}
          onChange={(e) => setPaidAt(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button disabled={busy || !paidAt} onClick={() => onSubmit(fromDateInput(paidAt))}>
          {busy ? 'Enregistrement…' : 'Confirmer'}
        </Button>
      </div>
    </Modal>
  );
}
