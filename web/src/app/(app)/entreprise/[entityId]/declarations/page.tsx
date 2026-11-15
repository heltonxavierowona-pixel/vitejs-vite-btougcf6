'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api, type Urgency } from '@/lib/api';
import {
  declarationStatusLabel,
  formatDateLong,
  formatMoney,
  formatPeriod,
} from '@/lib/format';
import { Alert, Loading, PageHeader, Panel, UrgencyBadge, errorMessage } from '@/components/ui';

interface DeclarationRow {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  vatDue: number;
  carryForward: number;
  dueDate: string;
  urgency: Urgency;
  receiptRef: string | null;
}

/** Nombre de mois affichés, du plus récent au plus ancien. */
const MONTHS_SHOWN = 12;

/**
 * Historique des déclarations : les 12 derniers mois échus, qu'une
 * déclaration existe ou non. Un mois sans déclaration apparaît
 * « À faire » — la déclaration néant reste obligatoire.
 */
export default function DeclarationListPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const [rows, setRows] = useState<DeclarationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DeclarationRow[]>(`/entities/${entityId}/declarations`)
      .then(setRows)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible')));
  }, [entityId]);

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!rows) return <Loading />;

  const byPeriod = new Map(rows.map((r) => [`${r.periodYear}-${r.periodMonth}`, r]));
  const now = new Date();
  const periods = Array.from({ length: MONTHS_SHOWN }, (_, i) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader
        title="Déclarations TVA"
        subtitle="À déposer avant le 15 du mois suivant la période, même sans opération."
      />

      <Panel>
        <ul className="divide-y divide-line">
          {periods.map(({ year, month }) => {
            const row = byPeriod.get(`${year}-${month}`);
            const status = row?.status ?? 'PENDING';
            const dueDate =
              row?.dueDate ?? new Date(Date.UTC(year, month, 15, 23, 59, 59)).toISOString();
            const overdue = !row && new Date(dueDate) < now;
            const urgency: Urgency = row?.urgency ?? (overdue ? 'LATE' : 'SOON');
            return (
              <li key={`${year}-${month}`}>
                <Link
                  href={`/entreprise/${entityId}/declarations/${year}/${month}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <span className="block text-sm font-medium">{formatPeriod(year, month)}</span>
                    <span className="block text-xs text-inksoft">
                      {row?.receiptRef
                        ? `Accusé ${row.receiptRef}`
                        : `Échéance le ${formatDateLong(dueDate)}`}
                    </span>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <UrgencyBadge urgency={urgency}>
                      {overdue ? 'Non déclarée' : declarationStatusLabel[status] ?? status}
                    </UrgencyBadge>
                    {row && (
                      <span className="block text-xs text-inksoft tabular">
                        {row.vatDue > 0
                          ? `${formatMoney(row.vatDue)} à payer`
                          : row.carryForward > 0
                            ? `Crédit ${formatMoney(row.carryForward)}`
                            : 'Néant'}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
