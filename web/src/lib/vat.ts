/**
 * ============================================================
 *  CALCUL TVA CÔTÉ CLIENT
 * ============================================================
 *
 *  Les fichiers de `./tax/` sont des COPIES EXACTES de
 *  `api/src/tax/` : l'aperçu affiché pendant la saisie est donc
 *  calculé par le même code que celui du serveur, au centime
 *  près. Un test de l'API (`vat-parity.spec.ts`) échoue si les
 *  deux copies divergent.
 *
 *  ⚠️ Le serveur reste seul maître : il recalcule tout à la
 *  création et à la validation. Ce qui est affiché ici est un
 *  aperçu, jamais une source de vérité.
 *
 *  Pour modifier une règle : éditer api/src/tax/, puis lancer
 *  `npm run sync:tax` depuis web/.
 * ============================================================
 */

export {
  computeInvoiceTotals as computeTotals,
  computeLine,
  roundToFranc,
  type InvoiceTotals as Totals,
  type LineInput,
  type LineResult,
  type VatRateKey,
} from './tax/vat-calculator';
export { VAT_RATES_BP } from './tax/tax.constants';
