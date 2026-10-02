'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api, type EntityDashboard } from '@/lib/api';
import { canWrite, useAuth } from '@/lib/auth-context';
import {
  declarationStatusLabel,
  formatDate,
  formatMoney,
  invoiceStatusLabel,
} from '@/lib/format';
import { Alert, Button, Empty, Loading, Panel, errorMessage } from '@/components/ui';
import { DeadlineCounter } from '@/components/deadline';

/**
 * ============================================================
 *  DASHBOARD ENTREPRISE
 * ============================================================
 *
 *  Une autre question que le dashboard cabinet : « où j'en
 *  suis ? » et non « qui va exploser le 15 ? ».
 *
 *  AUCUNE liste d'entreprises ici — une PME n'a qu'elle-même.
 *  C'est le même socle de données, une présentation entièrement
 *  différente.
 * ============================================================
 */
export default function EntityDashboardPage() {
  const params = useParams<{ entityId: string }>();
  const entityId = params.entityId;
  const { current } = useAuth();
  const writable = canWrite(current?.role);

  const [data, setData] = useState<EntityDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<EntityDashboard>(
        `/entities/${entityId}/dashboard`,
      );
      setData(result);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <Loading />;

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }

  if (!data) return null;

  const { nextDeadline, receivables } = data;
  const declarationDone =
    nextDeadline.status === 'SUBMITTED' || nextDeadline.status === 'PAID';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      {data.vatApplicable ? (
        <DeadlineCounter
          periodLabel={data.periodLabel}
          dueDate={nextDeadline.dueDate}
          daysLeft={nextDeadline.daysLeft}
          urgency={nextDeadline.urgency}
          vatDue={nextDeadline.vatDue}
          status={nextDeadline.status}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/entreprise/${entityId}/declarations/${data.period.year}/${data.period.month}`}
            >
              <Button variant={declarationDone ? 'secondary' : 'primary'}>
                {declarationDone
                  ? 'Voir la déclaration'
                  : 'Préparer la déclaration'}
              </Button>
            </Link>
            <span className="text-sm text-inksoft">
              {declarationStatusLabel[nextDeadline.status] ??
                nextDeadline.status}
            </span>
          </div>
        </DeadlineCounter>
      ) : (
        <Alert tone="info">
          Votre entreprise relève de l’impôt général synthétique (IGS) : elle ne
          facture pas de TVA et n’a pas de déclaration de TVA mensuelle (CGI art.
          132). Si votre chiffre d’affaires vous fait passer au régime du réel,
          modifiez le régime dans les paramètres.
        </Alert>
      )}

      {/* Blocage le plus fréquent : un brouillon n'existe pas
          fiscalement tant qu'il n'est pas validé. */}
      {data.pendingDrafts > 0 && (
        <Alert tone="warning">
          {data.pendingDrafts} facture
          {data.pendingDrafts > 1 ? 's sont' : ' est'} en brouillon et
          n’entre{data.pendingDrafts > 1 ? 'nt' : ''} pas dans votre
          déclaration.{' '}
          <Link
            href={`/entreprise/${entityId}/factures?statut=DRAFT`}
            className="font-medium underline"
          >
            Les valider
          </Link>
        </Alert>
      )}

      {/* Actions principales */}
      <div className="flex flex-wrap gap-3">
        {writable && (
          <>
            <Link href={`/entreprise/${entityId}/factures/nouvelle`}>
              <Button>Nouvelle facture</Button>
            </Link>
            <Link href={`/entreprise/${entityId}/factures/nouvelle?sens=achat`}>
              <Button variant="secondary">Saisir un achat</Button>
            </Link>
          </>
        )}
        <Link href={`/entreprise/${entityId}/factures`}>
          <Button variant="secondary">Toutes les factures</Button>
        </Link>
      </div>

      {/* Impayés */}
      <Panel
        title="Ce qu’on vous doit"
        action={
          <span className="text-sm font-semibold tabular">
            {formatMoney(receivables.totalOutstanding)}
          </span>
        }
      >
        {receivables.items.length === 0 ? (
          <Empty title="Aucune facture en attente de règlement." />
        ) : (
          <>
            {receivables.overdueCount > 0 && (
              <div className="px-4 py-2.5 bg-urgentbg text-urgent text-sm border-b border-line">
                {receivables.overdueCount} facture
                {receivables.overdueCount > 1 ? 's' : ''} en retard —{' '}
                <span className="tabular font-medium">
                  {formatMoney(receivables.overdueAmount)}
                </span>
              </div>
            )}

            <ul className="divide-y divide-line">
              {receivables.items.map((invoice) => {
                const remaining = invoice.balanceDue;
                const overdue =
                  invoice.dueAt && new Date(invoice.dueAt) < new Date();

                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/entreprise/${entityId}/factures/${invoice.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <span className="block text-sm font-medium truncate">
                          {invoice.partyName ?? 'Client'}
                        </span>
                        <span className="block text-xs text-inksoft tabular">
                          {invoice.number}
                          {invoice.dueAt &&
                            ` · échéance ${formatDate(invoice.dueAt)}`}
                        </span>
                      </div>
                      <span
                        className={`text-sm font-medium tabular shrink-0 ${
                          overdue ? 'text-urgent' : ''
                        }`}
                      >
                        {formatMoney(remaining)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {/* Activité récente */}
      <Panel
        title="Dernières factures"
        action={
          <Link
            href={`/entreprise/${entityId}/factures`}
            className="text-sm text-primary font-medium"
          >
            Tout voir
          </Link>
        }
      >
        {data.recentInvoices.length === 0 ? (
          <Empty
            title="Vous n’avez pas encore émis de facture."
            action={
              writable ? (
                <Link href={`/entreprise/${entityId}/factures/nouvelle`}>
                  <Button>Créer la première</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.recentInvoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/entreprise/${entityId}/factures/${invoice.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <span className="block text-sm truncate">
                      {invoice.partyName ?? '—'}
                    </span>
                    <span className="block text-xs text-inksoft tabular">
                      {invoice.number ?? 'Brouillon'} ·{' '}
                      {formatDate(invoice.issuedAt)} ·{' '}
                      {invoice.type === 'CREDIT_NOTE'
                        ? 'Avoir'
                        : invoice.direction === 'SALE'
                          ? 'Vente'
                          : 'Achat'}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-sm font-medium tabular">
                      {invoice.type === 'CREDIT_NOTE' && '−'}
                      {formatMoney(invoice.totalInclVat)}
                    </span>
                    <span className="block text-xs text-inksoft">
                      {invoiceStatusLabel[invoice.status] ?? invoice.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
