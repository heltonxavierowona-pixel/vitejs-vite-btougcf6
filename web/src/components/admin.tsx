'use client';

import { useState } from 'react';

import { formatAmount, formatMoney } from '@/lib/format';

/* ============================================================
   COMPOSANTS DU TABLEAU DE BORD ADMINISTRATEUR
   ============================================================ */

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export const statusLabel: Record<SubscriptionStatus, string> = {
  TRIALING: 'Essai',
  ACTIVE: 'Actif',
  PAST_DUE: 'Impayé',
  SUSPENDED: 'Suspendu',
  CANCELLED: 'Résilié',
};

const statusStyle: Record<SubscriptionStatus, string> = {
  TRIALING: 'bg-primarysoft text-primary',
  ACTIVE: 'bg-safebg text-safe',
  PAST_DUE: 'bg-soonbg text-soon',
  SUSPENDED: 'bg-criticalbg text-critical',
  CANCELLED: 'bg-surface text-inksoft',
};

/** Badge d'état : la couleur double un libellé, jamais seule. */
export function StatusBadge({ status }: { status: SubscriptionStatus | null | undefined }) {
  if (!status) {
    return <span className="px-2 py-0.5 rounded-[3px] text-xs font-medium bg-surface text-inksoft">Sans abonnement</span>;
  }
  return (
    <span className={`px-2 py-0.5 rounded-[3px] text-xs font-medium whitespace-nowrap ${statusStyle[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

/** Chiffre clé : un nombre, un libellé, un complément facultatif. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="bg-paper border border-line rounded-[5px] p-4 min-w-0">
      <p className="text-xs text-inksoft">{label}</p>
      <p className={`mt-1 text-xl sm:text-2xl font-semibold tabular tracking-tight break-words ${tone === 'warning' ? 'text-soon' : 'text-ink'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-inksoft">{hint}</p>}
    </div>
  );
}

export interface ClientRow {
  id: string;
  name: string;
  type: 'ENTREPRISE' | 'CABINET';
  email: string;
  phone: string;
  createdAt: string;
  entityCount: number;
  owner: { name: string; email: string } | null;
  subscription: {
    plan: string;
    planLabel: string;
    status: SubscriptionStatus;
    currentPeriodEnd: string;
    gracePeriodEnd: string | null;
    priceAmount: number;
    provider: string | null;
    lastReminderAt: string | null;
  } | null;
  lastPaymentAt: string | null;
}

export interface MonthRevenue {
  month: string; // AAAA-MM
  amount: number; // centimes
  count: number;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Libellés courts sous les barres (lisibles sur téléphone). */
const SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function monthLabel(key: string, withYear = false) {
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

/** Graduation « ronde » au-dessus du maximum (1, 2, 2,5, 5 × 10^n). */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Encaissements par mois : une seule série, barres fines ancrées sur
 * la ligne de base, sommets arrondis, info-bulle au survol ou au
 * toucher (zone de saisie plus large que la barre), tableau
 * équivalent pour les lecteurs d'écran.
 */
export function RevenueChart({ data }: { data: MonthRevenue[] }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 8, bottom: 32, left: 8 };
  const plotH = height - pad.top - pad.bottom;
  const plotW = width - pad.left - pad.right;
  const max = niceMax(Math.max(...data.map((d) => d.amount), 0));
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(28, Math.max(6, slot - 2 * 2 - slot * 0.35));
  const y = (amount: number) => pad.top + plotH - (amount / max) * plotH;
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const current = active !== null ? data[active] : null;

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 min-h-[2.5rem]">
        <figcaption className="text-sm text-inksoft">
          {current ? (
            <>
              <span className="text-ink font-semibold tabular">{formatMoney(current.amount)}</span>{' '}
              en {monthLabel(current.month, true)} · {current.count} paiement{current.count > 1 ? 's' : ''}
            </>
          ) : (
            <>
              <span className="text-ink font-semibold tabular">{formatMoney(total)}</span> encaissés sur{' '}
              {data.length} mois
            </>
          )}
        </figcaption>
        <span className="text-xs text-inksoft">Échelle : {formatAmount(max)} FCFA</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Encaissements par mois"
        onMouseLeave={() => setActive(null)}
      >
        {/* Grille discrète : moitié et sommet de l'échelle */}
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="var(--color-line)"
            strokeDasharray="3 4"
          />
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--color-line)" />

        {data.map((d, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const top = y(d.amount);
          const h = y(0) - top;
          const r = Math.min(4, h / 2, barW / 2);
          return (
            <g key={d.month}>
              {h > 0 && (
                <path
                  d={`M${cx - barW / 2},${y(0)} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${y(0)} Z`}
                  fill="var(--color-primary)"
                  opacity={active === null || active === i ? 1 : 0.35}
                />
              )}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="16" fill="var(--color-inksoft)">
                {data.length > 6 ? SHORT[Number(d.month.slice(5)) - 1] : monthLabel(d.month)}
              </text>
              {/* Zone de survol : toute la colonne */}
              <rect
                x={pad.left + slot * i}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(active === i ? null : i)}
              >
                <title>{`${monthLabel(d.month, true)} : ${formatMoney(d.amount)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      <table className="sr-only">
        <caption>Encaissements par mois</caption>
        <thead>
          <tr>
            <th scope="col">Mois</th>
            <th scope="col">Montant</th>
            <th scope="col">Paiements</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{monthLabel(d.month, true)}</td>
              <td>{formatMoney(d.amount)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
