/**
 * ============================================================
 *  ÉCHÉANCES FISCALES
 * ============================================================
 *
 *  La déclaration de TVA d'une période doit être déposée au
 *  plus tard le 15 du mois suivant.
 *  Exemple : TVA d'avril 2026 → dépôt avant le 15 mai 2026.
 *
 *  ⚠️ Le glissement au jour ouvré suivant lorsque le 15 tombe
 *  un week-end ou un jour férié n'est PAS confirmé.
 *  Il est désactivé par défaut (comportement prudent).
 * ============================================================
 */

import {
  DUE_DATE_ROLLS_TO_NEXT_BUSINESS_DAY,
  LATE_PENALTY_BP,
  VAT_DECLARATION_DUE_DAY,
} from './tax.constants';
import { applyRateBp, roundToFranc } from './vat-calculator';

export interface Period {
  year: number;
  /** 1 = janvier … 12 = décembre */
  month: number;
}

/**
 * Jours fériés fixes au Cameroun.
 * ⚠️ Liste incomplète : les fêtes mobiles (Pâques, Ascension,
 * Aïd el-Fitr, Aïd el-Kébir) doivent être ajoutées année par
 * année ou calculées séparément.
 */
const FIXED_HOLIDAYS_MMDD = [
  '01-01', // Jour de l'An
  '02-11', // Fête de la Jeunesse
  '05-01', // Fête du Travail
  '05-20', // Fête Nationale
  '08-15', // Assomption
  '12-25', // Noël
];

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isFixedHoliday(date: Date): boolean {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return FIXED_HOLIDAYS_MMDD.includes(`${mm}-${dd}`);
}

function nextBusinessDay(date: Date): Date {
  const result = new Date(date);
  while (isWeekend(result) || isFixedHoliday(result)) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

/**
 * Date limite de dépôt de la déclaration TVA pour une période.
 * Retournée en UTC, à 23:59:59 du jour d'échéance.
 */
export function vatDueDate(period: Period): Date {
  // Mois suivant la période déclarée
  const year = period.month === 12 ? period.year + 1 : period.year;
  const month = period.month === 12 ? 1 : period.month + 1;

  let due = new Date(
    Date.UTC(year, month - 1, VAT_DECLARATION_DUE_DAY, 23, 59, 59),
  );

  if (DUE_DATE_ROLLS_TO_NEXT_BUSINESS_DAY) {
    due = nextBusinessDay(due);
    due.setUTCHours(23, 59, 59, 0);
  }

  return due;
}

/** Nombre de jours restants avant l'échéance (négatif si dépassée). */
export function daysUntilDue(dueDate: Date, now: Date = new Date()): number {
  const ms = dueDate.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export type UrgencyLevel = 'SAFE' | 'SOON' | 'URGENT' | 'CRITICAL' | 'LATE';

/**
 * Niveau d'urgence utilisé par le dashboard cabinet pour trier
 * le portefeuille. C'est l'information principale de l'écran :
 * « qui risque une pénalité cette semaine ? »
 */
export function urgencyLevel(daysLeft: number): UrgencyLevel {
  if (daysLeft < 0) return 'LATE';
  if (daysLeft <= 2) return 'CRITICAL';
  if (daysLeft <= 5) return 'URGENT';
  if (daysLeft <= 10) return 'SOON';
  return 'SAFE';
}

/**
 * Estimation de la majoration de retard.
 * Purement indicative : le calcul officiel relève de la DGI.
 */
export function estimateLatePenalty(
  vatDue: number,
  badFaith = false,
): number {
  const bp = badFaith ? LATE_PENALTY_BP.BAD_FAITH : LATE_PENALTY_BP.DEFAULT;
  return roundToFranc(applyRateBp(vatDue, bp));
}

/** Période précédant celle fournie — utile pour le report de crédit. */
export function previousPeriod(period: Period): Period {
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 };
}

/** Libellé lisible d'une période : "Avril 2026". */
export function formatPeriod(period: Period, locale = 'fr-FR'): string {
  const date = new Date(Date.UTC(period.year, period.month - 1, 1));
  const label = date.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
