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
  vatDue: number;
  carryForward: number;
  turnoverExclVat: number;
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
          Des factures ont été validées ou annulées depuis le dernier calcul.{' '}
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
          Échéance dépassée : majoration estimée à{' '}
          <span className="font-semibold tabular">
            {formatMoney(declaration.estimatedPenalty)}
          </span>{' '}
          (25 % de la TVA due, estimation indicative). Déposez au plus vite.
        </Alert>
      )}

      {isNil && !submitted && (
        <Alert tone="warning">
          Aucune opération sur la période. La déclaration « néant » reste
          obligatoire : son omission est sanctionnée d’une amende forfaitaire
          de 50 000 FCFA.
        </Alert>
      )}

      {/* Liquidation */}
      <Panel title="Liquidation">
        <dl className="divide-y divide-line text-sm">
          <Row label="Chiffre d’affaires HT" value={declaration.turnoverExclVat} />
          <Row label="TVA collectée sur ventes" value={declaration.vatCollected} />
          <Row
            label="TVA déductible sur achats"
            value={declaration.vatDeductible}
          />
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
