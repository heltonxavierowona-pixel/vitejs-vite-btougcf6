import { OrganizationType, PlanCode } from '@prisma/client';

/**
 * ============================================================
 *  PLANS D'ABONNEMENT
 * ============================================================
 *
 *  Un seul produit, deux grilles tarifaires — c'est la
 *  commercialisation qui diffère, pas le logiciel.
 *
 *  Montants en centimes de FCFA.
 *  ⚠️ Prix indicatifs : à ajuster après les premiers entretiens
 *  clients. Ne pas figer avant d'avoir testé la disposition à
 *  payer réelle.
 * ============================================================
 */

export interface PlanDefinition {
  code: PlanCode;
  audience: OrganizationType;
  label: string;
  /** Prix mensuel en centimes de FCFA. */
  priceMonthly: number;
  maxEntities: number;
  maxUsers: number;
  trialDays: number;
  features: string[];
}

/** Valeur sentinelle pour « illimité ». */
export const UNLIMITED = 9999;

export const PLANS: Record<PlanCode, PlanDefinition> = {
  FREE: {
    code: PlanCode.FREE,
    audience: OrganizationType.ENTREPRISE,
    label: 'Découverte',
    priceMonthly: 0,
    maxEntities: 1,
    maxUsers: 1,
    trialDays: 0,
    features: ['10 factures par mois', 'Déclaration TVA', 'Export PDF'],
  },

  PME_STARTER: {
    code: PlanCode.PME_STARTER,
    audience: OrganizationType.ENTREPRISE,
    label: 'PME Essentiel',
    priceMonthly: 10_000 * 100,
    maxEntities: 1,
    maxUsers: 2,
    trialDays: 14,
    features: [
      'Factures illimitées',
      'Déclaration TVA mensuelle',
      'Rappels d’échéance',
      'Suivi des impayés',
    ],
  },

  PME_PRO: {
    code: PlanCode.PME_PRO,
    audience: OrganizationType.ENTREPRISE,
    label: 'PME Pro',
    priceMonthly: 25_000 * 100,
    maxEntities: 1,
    maxUsers: 6,
    trialDays: 14,
    features: [
      'Tout le plan Essentiel',
      'Multi-utilisateurs',
      'Journal d’audit complet',
      'Support prioritaire',
    ],
  },

  CABINET_S: {
    code: PlanCode.CABINET_S,
    audience: OrganizationType.CABINET,
    label: 'Cabinet — jusqu’à 10 dossiers',
    priceMonthly: 50_000 * 100,
    maxEntities: 10,
    maxUsers: 3,
    trialDays: 30,
    features: [
      'Tableau de bord portefeuille',
      'Suivi des échéances par client',
      'Affectation aux collaborateurs',
    ],
  },

  CABINET_M: {
    code: PlanCode.CABINET_M,
    audience: OrganizationType.CABINET,
    label: 'Cabinet — jusqu’à 30 dossiers',
    priceMonthly: 120_000 * 100,
    maxEntities: 30,
    maxUsers: 10,
    trialDays: 30,
    features: [
      'Tout le plan précédent',
      'Charge par collaborateur',
      'Export de masse',
    ],
  },

  CABINET_L: {
    code: PlanCode.CABINET_L,
    audience: OrganizationType.CABINET,
    label: 'Cabinet — dossiers illimités',
    priceMonthly: 250_000 * 100,
    maxEntities: UNLIMITED,
    maxUsers: UNLIMITED,
    trialDays: 30,
    features: [
      'Dossiers illimités',
      'Utilisateurs illimités',
      'Accompagnement dédié',
    ],
  },
};

/** Plan d'essai ouvert automatiquement à l'inscription. */
export const DEFAULT_TRIAL_PLAN: Record<OrganizationType, PlanCode> = {
  ENTREPRISE: PlanCode.PME_STARTER,
  CABINET: PlanCode.CABINET_S,
};

/** Quota de factures de vente validées par mois sur le plan gratuit. */
export const FREE_PLAN_MONTHLY_INVOICES = 10;

export function plansFor(audience: OrganizationType): PlanDefinition[] {
  return Object.values(PLANS).filter((p) => p.audience === audience);
}

/**
 * Calendrier de relance après échéance.
 *
 * Le Mobile Money ne permet pas le prélèvement automatique : on
 * ne peut pas débiter silencieusement. Le renouvellement repose
 * donc sur une action du client, et le produit doit la
 * provoquer — sinon on passe ses fins de mois à courir après
 * les paiements.
 */
export const DUNNING_SCHEDULE_DAYS = [-3, 0, 3, 7, 14] as const;

/** Jours de grâce après échéance avant suspension de l'accès. */
export const GRACE_PERIOD_DAYS = 15;

/**
 * Délai de grâce après l'échéance, réglable par GRACE_PERIOD_DAYS.
 * 15 jours par défaut : c'est la durée annoncée dans les CGV.
 */
export function gracePeriodDays(): number {
  const days = Number(process.env.GRACE_PERIOD_DAYS);
  return Number.isInteger(days) && days >= 0 ? days : GRACE_PERIOD_DAYS;
}
