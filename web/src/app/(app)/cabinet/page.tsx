'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api, type CabinetDashboard, type PortfolioRow } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth-context';
import {
  declarationStatusLabel,
  formatMoney,
} from '@/lib/format';
import {
  Alert,
  Button,
  Empty,
  Loading,
  PageHeader,
  Panel,
  UrgencyBadge,
  errorMessage,
} from '@/components/ui';
import { DeadlineCounter, Stat } from '@/components/deadline';

type Filter = 'ALL' | 'PENDING' | 'BLOCKED' | 'DONE';

/**
 * ============================================================
 *  DASHBOARD CABINET
 * ============================================================
 *
 *  Une seule question : qui risque une pénalité cette semaine ?
 *
 *  Le portefeuille arrive déjà trié par urgence depuis l'API.
 *  Pas de graphique, pas de chiffre d'affaires agrégé — en
 *  période de clôture, on cherche ce qui va exploser le 15.
 * ============================================================
 */
export default function CabinetDashboardPage() {
  const { current } = useAuth();
  const [data, setData] = useState<CabinetDashboard | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const result = await api.get<CabinetDashboard>(
        `/organizations/${current.organizationId}/dashboard/cabinet`,
      );
      setData(result);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <Loading label="Chargement du portefeuille…" />;
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }

  if (!data) return null;

  const rows = filterRows(data.portfolio, filter);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <PageHeader
        title="Portefeuille"
        subtitle={`${data.summary.total} dossier${data.summary.total > 1 ? 's' : ''} suivi${
          data.summary.total > 1 ? 's' : ''
        }`}
        action={
          current && isAdmin(current.role) ? (
            <Link href="/cabinet/dossiers/nouveau">
              <Button>Ajouter un dossier</Button>
            </Link>
          ) : undefined
        }
      />

      <DeadlineCounter
        periodLabel={data.periodLabel}
        dueDate={data.dueDate}
        daysLeft={data.daysLeft}
        urgency={data.urgency}
      >
        <p className="text-sm">
          <span className="font-medium tabular">
            {data.summary.pending} dossier
            {data.summary.pending > 1 ? 's' : ''}
          </span>{' '}
          sur {data.summary.total} reste
          {data.summary.pending > 1 ? 'nt' : ''} à déposer.
        </p>
      </DeadlineCounter>

      {/* Bandeau de synthèse */}
      <div className="bg-paper border border-line rounded-[5px] grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-line">
        <Stat label="Déposées" value={data.summary.submitted} tone="SAFE" />
        <Stat label="À traiter" value={data.summary.pending} />
        <Stat
          label="En retard"
          value={data.summary.late}
          tone={data.summary.late > 0 ? 'LATE' : undefined}
        />
        <Stat
          label="TVA du portefeuille"
          value={formatMoney(data.summary.totalVatDue)}
        />
      </div>

      {data.summary.late > 0 && data.estimatedPenalties > 0 && (
        <Alert tone="error">
          Majorations de retard estimées sur le portefeuille :{' '}
          <span className="font-semibold tabular">
            {formatMoney(data.estimatedPenalties)}
          </span>
          . Estimation indicative (25 % de la TVA due) ; seul le calcul de la
          DGI fait foi.
        </Alert>
      )}

      {data.summary.blocked > 0 && (
        <Alert tone="warning">
          {data.summary.blocked} dossier
          {data.summary.blocked > 1 ? 's ont' : ' a'} des factures en brouillon.
          Une facture non validée n’entre pas dans la déclaration.
        </Alert>
      )}

      {/* Portefeuille */}
      <Panel
        title="Portefeuille"
        action={
          <div className="flex gap-1">
            {(
              [
                ['ALL', 'Tous'],
                ['PENDING', 'À traiter'],
                ['BLOCKED', 'Bloqués'],
                ['DONE', 'Déposés'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 h-7 rounded-[3px] text-xs font-medium transition-colors ${
                  filter === key
                    ? 'bg-primarysoft text-primary'
                    : 'text-inksoft hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            title={
              filter === 'ALL'
                ? 'Aucun dossier dans votre portefeuille.'
                : 'Aucun dossier dans cette vue.'
            }
            action={
              filter === 'ALL' && current && isAdmin(current.role) ? (
                <Link href="/cabinet/dossiers/nouveau">
                  <Button>Ajouter un dossier</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Tableau — écrans larges */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-inksoft border-b border-line">
                  <th className="font-medium px-4 py-2.5">Entreprise</th>
                  <th className="font-medium px-4 py-2.5">Statut</th>
                  <th className="font-medium px-4 py-2.5 text-right">TVA</th>
                  <th className="font-medium px-4 py-2.5">Collaborateur</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.entityId} className="hover:bg-surface">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{row.legalName}</span>
                      <span className="block text-xs text-inksoft tabular">
                        {row.niu}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <UrgencyBadge urgency={row.urgency}>
                        {declarationStatusLabel[row.status] ?? row.status}
                      </UrgencyBadge>
                      {row.pendingDrafts > 0 && (
                        <span className="block mt-1 text-xs text-soon">
                          {row.pendingDrafts} brouillon
                          {row.pendingDrafts > 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {row.vatDue > 0
                        ? formatMoney(row.vatDue)
                        : row.carryForward > 0
                          ? `Crédit ${formatMoney(row.carryForward)}`
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-inksoft">
                      {row.assignedTo.length
                        ? row.assignedTo.map((u) => u.name).join(', ')
                        : 'Non affecté'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/entreprise/${row.entityId}`}
                        className="text-primary font-medium"
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Liste — mobile */}
            <ul className="md:hidden divide-y divide-line">
              {rows.map((row) => (
                <li key={row.entityId}>
                  <Link
                    href={`/entreprise/${row.entityId}`}
                    className="block px-4 py-3.5 hover:bg-surface"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block font-medium truncate">
                          {row.legalName}
                        </span>
                        <span className="block text-xs text-inksoft tabular">
                          {row.niu}
                        </span>
                      </div>
                      <UrgencyBadge urgency={row.urgency}>
                        {declarationStatusLabel[row.status] ?? row.status}
                      </UrgencyBadge>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="tabular">
                        {row.vatDue > 0 ? formatMoney(row.vatDue) : '—'}
                      </span>
                      {row.pendingDrafts > 0 && (
                        <span className="text-xs text-soon">
                          {row.pendingDrafts} brouillon
                          {row.pendingDrafts > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {/* Charge par collaborateur */}
      {data.workload.length > 0 && (
        <Panel title="Charge par collaborateur">
          <ul className="divide-y divide-line">
            {data.workload.map((person) => {
              const remaining = person.total - person.done;
              return (
                <li
                  key={person.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span>{person.name}</span>
                  <span className="tabular text-inksoft">
                    {remaining > 0
                      ? `${remaining} dossier${remaining > 1 ? 's' : ''} à traiter`
                      : 'À jour'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function filterRows(rows: PortfolioRow[], filter: Filter): PortfolioRow[] {
  const isDone = (row: PortfolioRow) =>
    row.status === 'SUBMITTED' || row.status === 'PAID';

  switch (filter) {
    case 'PENDING':
      return rows.filter((row) => !isDone(row));
    case 'BLOCKED':
      return rows.filter((row) => row.pendingDrafts > 0 && !isDone(row));
    case 'DONE':
      return rows.filter(isDone);
    default:
      return rows;
  }
}
