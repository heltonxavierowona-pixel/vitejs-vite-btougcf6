/**
 * ============================================================
 *  MOTEUR DE CALCUL TVA — fonctions pures
 * ============================================================
 *
 *  Aucune dépendance NestJS, aucun accès base de données.
 *  Tout est testable unitairement et réutilisable côté front.
 *
 *  PRINCIPE CENTRAL :
 *  La TVA se calcule LIGNE PAR LIGNE puis se somme.
 *  Appliquer le taux au total global donne un résultat
 *  différent — et c'est le total des lignes qui fait foi.
 * ============================================================
 */

import {
  BP_SCALE,
  DISCOUNT_SCALE,
  FCFA,
  OFFICIAL_ROUNDING_MODE,
  QUANTITY_SCALE,
  RoundingMode,
  VAT_CREDIT_AUTO_CARRY_FORWARD,
  VAT_RATES_BP,
  VAT_WITHHOLDING_BP,
} from './tax.constants';

// ------------------------------------------------------------
//  Types
// ------------------------------------------------------------

export type VatRateKey = keyof typeof VAT_RATES_BP;

export interface LineInput {
  /** Prix unitaire HT, en centimes de FCFA. */
  unitPrice: number;
  /** Quantité en millièmes (1,5 => 1500). */
  quantity: number;
  /** Remise en centièmes de % (12,5 % => 1250). */
  discountPct?: number;
  vatRate: VatRateKey;
}

export interface LineResult {
  /** Base HT après remise, en centimes. */
  exclVat: number;
  /** Montant de TVA, en centimes. */
  vat: number;
  /** Total TTC, en centimes. */
  inclVat: number;
  /** Taux appliqué, en points de base. */
  rateBp: number;
}

export interface InvoiceTotals {
  lines: LineResult[];
  /** Total HT arrondi au franc entier, exprimé en centimes. */
  subtotalExclVat: number;
  /** Total TVA arrondi au franc entier, exprimé en centimes. */
  vatAmount: number;
  /** Total TTC arrondi au franc entier, exprimé en centimes. */
  totalInclVat: number;
  /** Ventilation de la base et de la TVA par taux. */
  breakdown: Array<{ rate: VatRateKey; base: number; vat: number }>;
}

// ------------------------------------------------------------
//  Arrondis
// ------------------------------------------------------------

/**
 * Arrondit un nombre entier de centimes au FRANC ENTIER.
 * Le FCFA n'ayant pas de sous-unité, tout montant officiel
 * (total de facture, montant déclaré) doit passer par ici.
 */
export function roundToFranc(
  amountInCents: number,
  mode: RoundingMode = OFFICIAL_ROUNDING_MODE,
): number {
  assertInteger(amountInCents, 'amountInCents');

  // Calcul exclusivement entier : aucun flottant intermédiaire,
  // donc aucune erreur de représentation (0,1 + 0,2 ≠ 0,3).
  const francs = Math.floor(amountInCents / FCFA);
  const remainder = amountInCents - francs * FCFA; // 0..99, même si négatif

  let rounded: number;
  switch (mode) {
    case 'DOWN':
      rounded = francs;
      break;
    case 'HALF_EVEN':
      if (remainder > FCFA / 2) rounded = francs + 1;
      else if (remainder < FCFA / 2) rounded = francs;
      else rounded = francs % 2 === 0 ? francs : francs + 1;
      break;
    case 'HALF_UP':
    default:
      rounded = remainder >= FCFA / 2 ? francs + 1 : francs;
      break;
  }

  return rounded * FCFA;
}

/**
 * Division entière arrondie au plus proche (0,5 vers le haut),
 * en BigInt pour rester exacte quelle que soit la taille du
 * produit prix × quantité × remise (qui dépasse vite 2^53).
 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Applique un taux (en points de base) à un montant en centimes,
 * arrondi au centime. Base de tous les calculs de pourcentage.
 */
export function applyRateBp(amountInCents: number, rateBp: number): number {
  assertInteger(amountInCents, 'amountInCents');
  assertInteger(rateBp, 'rateBp');
  const negative = amountInCents < 0;
  const result = Number(
    divRoundHalfUp(
      BigInt(Math.abs(amountInCents)) * BigInt(rateBp),
      BigInt(BP_SCALE),
    ),
  );
  return negative ? -result : result;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} doit être un entier (reçu : ${value})`);
  }
}

// ------------------------------------------------------------
//  Calcul d'une ligne
// ------------------------------------------------------------

export function computeLine(line: LineInput): LineResult {
  const rateBp = VAT_RATES_BP[line.vatRate];
  if (rateBp === undefined) {
    throw new RangeError(`Taux de TVA inconnu : ${line.vatRate}`);
  }

  const discount = line.discountPct ?? 0;
  assertInteger(line.unitPrice, 'unitPrice');
  assertInteger(line.quantity, 'quantity');
  assertInteger(discount, 'discountPct');
  if (line.unitPrice < 0 || line.quantity < 0) {
    throw new RangeError('Le prix et la quantité doivent être positifs');
  }
  if (discount < 0 || discount > DISCOUNT_SCALE) {
    throw new RangeError('La remise doit être comprise entre 0 et 100 %');
  }

  // Base HT = prix × quantité × (1 − remise), en un seul arrondi
  // final au centime : arrondir à chaque étape cumulerait les
  // erreurs.
  const exclVat = Number(
    divRoundHalfUp(
      BigInt(line.unitPrice) *
        BigInt(line.quantity) *
        BigInt(DISCOUNT_SCALE - discount),
      BigInt(QUANTITY_SCALE) * BigInt(DISCOUNT_SCALE),
    ),
  );

  const vat = Number(
    divRoundHalfUp(BigInt(exclVat) * BigInt(rateBp), BigInt(BP_SCALE)),
  );

  return {
    exclVat,
    vat,
    inclVat: exclVat + vat,
    rateBp,
  };
}

// ------------------------------------------------------------
//  Totaux d'une facture
// ------------------------------------------------------------

export function computeInvoiceTotals(lines: LineInput[]): InvoiceTotals {
  const results = lines.map(computeLine);

  // Ventilation par taux — requise sur la facture normalisée
  const byRate = new Map<VatRateKey, { base: number; vat: number }>();
  lines.forEach((line, i) => {
    const current = byRate.get(line.vatRate) ?? { base: 0, vat: 0 };
    current.base += results[i].exclVat;
    current.vat += results[i].vat;
    byRate.set(line.vatRate, current);
  });

  const rawExclVat = results.reduce((sum, r) => sum + r.exclVat, 0);
  const rawVat = results.reduce((sum, r) => sum + r.vat, 0);

  // Arrondi au franc entier UNIQUEMENT sur les totaux officiels
  const subtotalExclVat = roundToFranc(rawExclVat);
  const vatAmount = roundToFranc(rawVat);

  return {
    lines: results,
    subtotalExclVat,
    vatAmount,
    // Cohérence garantie : le TTC est la somme des deux arrondis,
    // jamais un troisième arrondi indépendant.
    totalInclVat: subtotalExclVat + vatAmount,
    breakdown: [...byRate.entries()].map(([rate, v]) => ({
      rate,
      base: roundToFranc(v.base),
      vat: roundToFranc(v.vat),
    })),
  };
}

// ------------------------------------------------------------
//  Extraction de TVA depuis un montant TTC
// ------------------------------------------------------------

/**
 * Retrouve la base HT et la TVA à partir d'un montant TTC.
 * Utile pour la saisie rapide de factures d'achat, où seul
 * le TTC est connu.
 */
export function extractVatFromInclusive(
  totalInclVat: number,
  vatRate: VatRateKey,
): { exclVat: number; vat: number } {
  const rateBp = VAT_RATES_BP[vatRate];
  if (rateBp === 0) return { exclVat: totalInclVat, vat: 0 };

  assertInteger(totalInclVat, 'totalInclVat');
  const exclVat = Number(
    divRoundHalfUp(
      BigInt(totalInclVat) * BigInt(BP_SCALE),
      BigInt(BP_SCALE + rateBp),
    ),
  );
  return { exclVat, vat: totalInclVat - exclVat };
}

// ------------------------------------------------------------
//  Retenue à la source
// ------------------------------------------------------------

/**
 * Retenue de TVA à opérer par un acheteur tenu à la retenue à la
 * source (CGI art. 149-2) sur la facture d'un fournisseur. Montant
 * reversé directement à la DGI par l'acheteur.
 */
export function computeWithholding(params: {
  invoiceAmount: number;
  buyerIsVatSubject: boolean;
  supplierIsVatSubject: boolean;
}): number {
  const { invoiceAmount, buyerIsVatSubject, supplierIsVatSubject } = params;
  if (!buyerIsVatSubject || supplierIsVatSubject) return 0;
  return roundToFranc(applyRateBp(invoiceAmount, VAT_WITHHOLDING_BP));
}

// ------------------------------------------------------------
//  Liquidation de la déclaration mensuelle
// ------------------------------------------------------------

export interface DeclarationInput {
  /** TVA collectée sur les ventes de la période (centimes). */
  vatCollected: number;
  /** TVA déductible sur les achats de la période (centimes). */
  vatDeductible: number;
  /** Crédit de TVA reporté de la période précédente (centimes). */
  previousCredit?: number;
  /** TVA retenue à la source par les clients (CGI art. 149-2). */
  vatWithheld?: number;
}

export interface DeclarationResult {
  vatCollected: number;
  vatDeductible: number;
  vatCredit: number;
  vatWithheld: number;
  /** Net à payer à la DGI. Toujours >= 0. */
  vatDue: number;
  /** Crédit reportable sur la période suivante. Toujours >= 0. */
  carryForward: number;
  /** true si aucune opération : déclaration « néant » obligatoire. */
  isNil: boolean;
}

export function computeDeclaration(
  input: DeclarationInput,
): DeclarationResult {
  const vatCollected = input.vatCollected;
  const vatDeductible = input.vatDeductible;
  const vatCredit = input.previousCredit ?? 0;
  const vatWithheld = input.vatWithheld ?? 0;

  // TVA due = collectée − déductible − retenue à la source − crédit antérieur
  const net = vatCollected - vatDeductible - vatWithheld - vatCredit;

  const vatDue = net > 0 ? roundToFranc(net) : 0;
  const carryForward =
    net < 0 && VAT_CREDIT_AUTO_CARRY_FORWARD ? roundToFranc(-net) : 0;

  return {
    vatCollected: roundToFranc(vatCollected),
    vatDeductible: roundToFranc(vatDeductible),
    vatCredit: roundToFranc(vatCredit),
    vatWithheld: roundToFranc(vatWithheld),
    vatDue,
    carryForward,
    // Une déclaration sans aucune opération reste OBLIGATOIRE.
    isNil: vatCollected === 0 && vatDeductible === 0 && vatWithheld === 0,
  };
}
