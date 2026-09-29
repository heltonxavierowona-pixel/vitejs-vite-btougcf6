/**
 * Grille tarifaire affichée sur le site public.
 *
 * ⚠️ Copie de api/src/subscription/plans.ts (seule source de vérité
 * des prix facturés). Un test de l'API (`pricing-parity.spec.ts`)
 * échoue si les deux divergent : le prix affiché doit toujours
 * être le prix payé.
 *
 * Montants en centimes de FCFA.
 */
export const PUBLIC_PLANS = [
  {
    code: 'FREE',
    audience: 'ENTREPRISE',
    label: 'Découverte',
    priceMonthly: 0,
    trialDays: 0,
    features: ['10 factures par mois', 'Déclaration TVA', 'Export PDF'],
  },
  {
    code: 'PME_STARTER',
    audience: 'ENTREPRISE',
    label: 'PME Essentiel',
    priceMonthly: 10_000 * 100,
    trialDays: 14,
    features: [
      'Factures illimitées',
      'Déclaration TVA mensuelle',
      'Rappels d’échéance',
      'Suivi des impayés',
    ],
  },
  {
    code: 'PME_PRO',
    audience: 'ENTREPRISE',
    label: 'PME Pro',
    priceMonthly: 25_000 * 100,
    trialDays: 14,
    features: [
      'Tout le plan Essentiel',
      'Multi-utilisateurs',
      'Journal d’audit complet',
      'Support prioritaire',
    ],
  },
  {
    code: 'CABINET_S',
    audience: 'CABINET',
    label: 'Cabinet — jusqu’à 10 dossiers',
    priceMonthly: 50_000 * 100,
    trialDays: 30,
    features: [
      'Tableau de bord portefeuille',
      'Suivi des échéances par client',
      'Affectation aux collaborateurs',
    ],
  },
  {
    code: 'CABINET_M',
    audience: 'CABINET',
    label: 'Cabinet — jusqu’à 30 dossiers',
    priceMonthly: 120_000 * 100,
    trialDays: 30,
    features: [
      'Tout le plan précédent',
      'Charge par collaborateur',
      'Export de masse',
    ],
  },
  {
    code: 'CABINET_L',
    audience: 'CABINET',
    label: 'Cabinet — dossiers illimités',
    priceMonthly: 250_000 * 100,
    trialDays: 30,
    features: [
      'Dossiers illimités',
      'Utilisateurs illimités',
      'Accompagnement dédié',
    ],
  },
] as const;
