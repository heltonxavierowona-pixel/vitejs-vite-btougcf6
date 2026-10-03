'use client';

import {
  formatDateLong,
  formatMoney,
  urgencyLabel,
  urgencyStyles,
  type Urgency,
} from '@/lib/format';

/**
 * ============================================================
 *  COMPTE À REBOURS
 * ============================================================
 *
 *  L'élément dominant des deux dashboards. Il répond à la
 *  seule question qui compte avant le 15 : combien de temps
 *  reste-t-il, et combien ça coûte si on le rate.
 *
 *  La bordure épaisse à gauche porte l'urgence : c'est le
 *  premier signal perçu, avant même la lecture.
 * ============================================================
 */
export function DeadlineCounter({
  periodLabel,
  dueDate,
  daysLeft,
  urgency,
  vatDue,
  status,
  children,
}: {
  periodLabel: string;
  dueDate: string;
  daysLeft: number;
  urgency: Urgency;
  vatDue?: number;
  status?: string;
  children?: React.ReactNode;
}) {
  const style = urgencyStyles[urgency];
  const done = status === 'SUBMITTED' || status === 'PAID';

  return (
    <section
      className={`bg-paper border border-line border-l-4 rounded-[5px] p-5 ${
        done ? 'border-l-safe' : style.borderLeft
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-sm text-inksoft">
            Déclaration TVA — {periodLabel}
          </h2>

          {done ? (
            <p className="mt-1 text-2xl font-semibold text-safe">
              Déposée
            </p>
          ) : (
            <p
              className={`mt-1 text-2xl font-semibold tabular ${style.text}`}
            >
              {urgencyLabel(daysLeft)}
            </p>
          )}

          <p className="mt-1 text-sm text-inksoft">
            Dépôt au plus tard le {formatDateLong(dueDate)}
          </p>
        </div>

        {vatDue !== undefined && vatDue > 0 && (
          <div className="text-right">
            <span className="block text-sm text-inksoft">TVA à payer</span>
            <span className="block text-xl font-semibold tabular">
              {formatMoney(vatDue)}
            </span>
          </div>
        )}
      </div>

      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/** Chiffre isolé d'un bandeau de synthèse. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: Urgency;
}) {
  return (
    <div className="px-4 py-3">
      <span className="block text-xs text-inksoft">{label}</span>
      <span
        className={`block mt-0.5 text-xl font-semibold tabular ${
          tone ? urgencyStyles[tone].text : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
