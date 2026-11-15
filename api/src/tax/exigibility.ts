/**
 * ============================================================
 *  EXIGIBILITÉ ET DROIT À DÉDUCTION — fonctions pures
 * ============================================================
 *
 *  CGI art. 134 : pour les livraisons de biens, la TVA est
 *  exigible à la livraison ; pour les prestations de services,
 *  à l'ENCAISSEMENT du prix (acomptes et avances compris).
 *
 *  CGI art. 143-1-d et 144, LPF art. L 101 : certaines TVA
 *  d'achats n'ouvrent pas droit à déduction.
 * ============================================================
 */

import { CASH_DEDUCTION_LIMIT } from './tax.constants';

export interface ServiceInvoice {
  /** TTC de la facture, en centimes. */
  totalInclVat: number;
  /** Part TTC des lignes de services, en centimes. */
  serviceInclVat: number;
  /** TVA des lignes de services, en centimes. */
  serviceVat: number;
  /** Règlements (encaissement + TVA retenue à la source). */
  settlements: Array<{ at: Date; amount: number }>;
  /** Avoirs rattachés : part TTC de leurs lignes de services. */
  credits: Array<{ at: Date; serviceInclVat: number }>;
}

/**
 * TVA sur services devenue exigible AVANT l'instant `t` (cumul).
 *
 * Les encaissements sont répartis entre biens et services au
 * prorata du TTC. Les avoirs réduisent le montant de services
 * restant à encaisser : un avoir sur une facture déjà payée fait
 * baisser le cumul (la TVA déclarée en trop est récupérée,
 * art. 146), un avoir sur une facture impayée ne change rien
 * puisque rien n'était encore exigible.
 */
export function serviceVatExigibleBefore(
  invoice: ServiceInvoice,
  t: Date,
): number {
  const { totalInclVat, serviceInclVat, serviceVat } = invoice;
  if (serviceVat === 0 || serviceInclVat <= 0 || totalInclVat <= 0) return 0;

  const paid = invoice.settlements
    .filter((s) => s.at < t)
    .reduce((sum, s) => sum + s.amount, 0);
  const credited = invoice.credits
    .filter((c) => c.at < t)
    .reduce((sum, c) => sum + c.serviceInclVat, 0);

  // Part services réellement encaissée, plafonnée à ce qui reste
  // facturé après avoirs.
  const servicePaid = mulDiv(paid, serviceInclVat, totalInclVat);
  const serviceOwed = Math.max(0, serviceInclVat - credited);
  const base = Math.min(servicePaid, serviceOwed);

  return mulDiv(base, serviceVat, serviceInclVat);
}

/** TVA sur services exigible sur la période [start, end[. */
export function serviceVatForPeriod(
  invoice: ServiceInvoice,
  start: Date,
  end: Date,
): number {
  return (
    serviceVatExigibleBefore(invoice, end) -
    serviceVatExigibleBefore(invoice, start)
  );
}

export type NonDeductibleReason =
  /** Facture sans NIU du fournisseur (LPF art. L 101). */
  | 'NO_NIU'
  /** Achat d'au moins 100 000 FCFA payé en espèces (CGI art. 143-1-d). */
  | 'CASH'
  /** Dépense exclue par nature (CGI art. 144). */
  | 'EXCLUDED_EXPENSE';

export function nonDeductibleReasons(purchase: {
  partyNiu: string | null;
  totalInclVat: number;
  vatNonDeductible: boolean;
  paymentMethods: string[];
}): NonDeductibleReason[] {
  const reasons: NonDeductibleReason[] = [];
  if (!purchase.partyNiu) reasons.push('NO_NIU');
  if (
    purchase.totalInclVat >= CASH_DEDUCTION_LIMIT &&
    purchase.paymentMethods.includes('CASH')
  ) {
    reasons.push('CASH');
  }
  if (purchase.vatNonDeductible) reasons.push('EXCLUDED_EXPENSE');
  return reasons;
}

/** a × b / c arrondi au plus proche, en BigInt (pas de dépassement). */
function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return 0;
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const negative = n < 0n !== d < 0n;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  const q = (abs(n) * 2n + abs(d)) / (abs(d) * 2n);
  return Number(negative ? -q : q);
}
