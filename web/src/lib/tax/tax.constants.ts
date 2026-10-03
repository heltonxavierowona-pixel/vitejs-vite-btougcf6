/**
 * ============================================================
 *  CONSTANTES FISCALES — CAMEROUN
 * ============================================================
 *
 *  Valeurs alignées sur le Code général des impôts, édition 2026
 *  (articles cités à chaque constante). Une relecture par un
 *  expert-comptable reste recommandée.
 *  Elles sont volontairement centralisées ici : aucune valeur
 *  fiscale ne doit être écrite en dur ailleurs dans le code.
 *
 *  UNITÉS :
 *   - Montants  : centimes de FCFA (Int).  1 FCFA = 100.
 *   - Taux      : points de base (bp).     19,25 % = 1925.
 *   - Quantités : millièmes.               1,5 = 1500.
 *   - Remises   : centièmes de %.          12,5 % = 1250.
 * ============================================================
 */

/** 1 FCFA exprimé en unité de stockage interne. */
export const FCFA = 100;

/** Taux de TVA en points de base (1 bp = 0,01 %). */
export const VAT_RATES_BP = {
  // Taux général 17,5 % (CGI art. 142) + centimes additionnels
  // communaux (10 % de la TVA) = 19,25 %.
  STANDARD: 1925, // 19,25 %
  ZERO: 0,
  EXEMPT: 0,
} as const;

/**
 * Retenue à la source de la TVA (CGI art. 149-2) : l'État, les
 * collectivités, les établissements et entreprises publics et les
 * entreprises privées listées chaque année par arrêté retiennent la
 * TVA lors du règlement des factures, quel que soit le régime du
 * fournisseur. Le fournisseur la déduit sur présentation de
 * l'attestation générée par le système de la DGI.
 */
export const VAT_WITHHOLDING_BP = 1925;

/** Jour limite de dépôt de la déclaration TVA (CGI art. 152-2 : « dans les 15 jours » du mois suivant). */
export const VAT_DECLARATION_DUE_DAY = 15;

/**
 * Le délai glisse-t-il au jour ouvré suivant si le 15 tombe un
 * samedi, dimanche ou jour férié ? L'art. 152 ne prévoit aucun
 * glissement : on ne compte pas dessus.
 */
export const DUE_DATE_ROLLS_TO_NEXT_BUSINESS_DAY = false;

/**
 * Pénalité de retard des impôts à versement spontané, dont la TVA
 * (LPF art. L 106) : 10 % par mois de retard, tout mois commencé
 * comptant pour un mois entier, plafonnée à 30 % du principal.
 */
export const LATE_PENALTY_MONTHLY_BP = 1000;
export const LATE_PENALTY_CAP_BP = 3000;

/**
 * Amende pour déclaration non souscrite après mise en demeure
 * (LPF art. L 97-2) : 50 000 FCFA (centres de fiscalité locale des
 * particuliers), 100 000 (moyennes entreprises), 200 000 (grandes
 * entreprises). On affiche le montant le plus bas, à titre indicatif.
 */
export const NIL_DECLARATION_PENALTY = 50_000 * FCFA;

/**
 * Déclaration néant ou créditrice déposée APRÈS mise en demeure
 * (LPF art. L 99-1) : amende forfaitaire d'un million.
 */
export const NIL_AFTER_NOTICE_PENALTY = 1_000_000 * FCFA;

/** Seuil de chiffre d'affaires d'assujettissement obligatoire à la TVA. */
export const VAT_MANDATORY_THRESHOLD = 50_000_000 * FCFA;

/**
 * Arrondi des montants au franc entier : arrondi commercial.
 * Pour la liquidation, la base imposable est en outre arrondie au
 * millier de FCFA inférieur (CGI art. 141), voir
 * TAXABLE_BASE_ROUNDING.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
export const OFFICIAL_ROUNDING_MODE: RoundingMode = 'HALF_UP';

/** Base imposable arrondie au millier de FCFA inférieur (CGI art. 141). */
export const TAXABLE_BASE_ROUNDING = 1000 * FCFA;

/**
 * Crédit de TVA reportable sur les périodes suivantes, sans
 * limitation de délai (CGI art. 149-3). Pour le commerce général,
 * un report au-delà de 3 mois exige une validation préalable de
 * l'administration : voir CREDIT_VALIDATION_MONTHS.
 */
export const VAT_CREDIT_AUTO_CARRY_FORWARD = true;
export const CREDIT_VALIDATION_MONTHS = 3;

/**
 * TVA non déductible sur un achat d'au moins 100 000 FCFA payé en
 * espèces (CGI art. 143-1-d).
 */
export const CASH_DEDUCTION_LIMIT = 100_000 * FCFA;

/** Nombre de décimales internes sur les quantités et remises. */
export const QUANTITY_SCALE = 1000; // millièmes
export const DISCOUNT_SCALE = 10_000; // 100 % = 10000
export const BP_SCALE = 10_000; // 100 % = 10000 bp
