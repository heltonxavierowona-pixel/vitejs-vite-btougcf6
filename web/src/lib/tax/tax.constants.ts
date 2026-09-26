/**
 * ============================================================
 *  CONSTANTES FISCALES — CAMEROUN
 * ============================================================
 *
 *  ⚠️  TOUTES les valeurs de ce fichier doivent être validées
 *  par un expert-comptable avant mise en production.
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
  STANDARD: 1925, // 19,25 %
  ZERO: 0,
  EXEMPT: 0,
} as const;

/**
 * Retenue à la source de TVA appliquée lorsqu'un assujetti règle
 * un fournisseur NON assujetti. Le montant est reversé directement
 * à la DGI par l'acheteur.
 * ⚠️ Périmètre exact d'application à faire confirmer.
 */
export const VAT_WITHHOLDING_BP = 1925;

/** Jour limite de dépôt de la déclaration TVA (mois suivant la période). */
export const VAT_DECLARATION_DUE_DAY = 15;

/**
 * Le délai glisse-t-il au jour ouvré suivant si le 15 tombe un
 * samedi, dimanche ou jour férié ?
 * ⚠️ À CONFIRMER auprès du centre des impôts.
 * Valeur prudente par défaut : false (on ne compte pas sur le glissement).
 */
export const DUE_DATE_ROLLS_TO_NEXT_BUSINESS_DAY = false;

/** Amende forfaitaire pour omission de déclaration « néant ». */
export const NIL_DECLARATION_PENALTY = 50_000 * FCFA;

/** Majorations de retard (points de base). */
export const LATE_PENALTY_BP = {
  DEFAULT: 2500, // 25 % — défaut de déclaration dans les délais
  BAD_FAITH: 5000, // 50 % — mauvaise foi caractérisée
} as const;

/** Seuil de chiffre d'affaires d'assujettissement obligatoire à la TVA. */
export const VAT_MANDATORY_THRESHOLD = 50_000_000 * FCFA;

/**
 * Mode d'arrondi appliqué au passage au franc entier.
 * ⚠️ La règle officiellement exigée par la DGI doit être confirmée.
 * Par défaut : arrondi commercial (0,5 vers le haut).
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
export const OFFICIAL_ROUNDING_MODE: RoundingMode = 'HALF_UP';

/**
 * Le crédit de TVA non imputé est-il automatiquement reportable
 * sur la période suivante ?
 * ⚠️ Modalités exactes (plafond, durée de report, demande de
 * remboursement) à faire valider.
 */
export const VAT_CREDIT_AUTO_CARRY_FORWARD = true;

/** Nombre de décimales internes sur les quantités et remises. */
export const QUANTITY_SCALE = 1000; // millièmes
export const DISCOUNT_SCALE = 10_000; // 100 % = 10000
export const BP_SCALE = 10_000; // 100 % = 10000 bp
