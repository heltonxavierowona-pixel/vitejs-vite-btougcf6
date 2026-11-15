/**
 * Configuration Neero, lue dans les variables d'environnement.
 *
 * Chaque projet NUMERA a son propre opérateur, sa propre balance et
 * donc ses propres valeurs. Les points que la documentation ne
 * confirme pas encore (en-tête d'authentification, types, chemins)
 * sont réglables ici sans toucher au code : voir « À vérifier en
 * Sandbox » dans docs/NEERO.md.
 */
export interface NeeroConfig {
  env: 'sandbox' | 'production';
  baseUrl: string;
  secretKey: string;
  webhookSecret: string;
  operatorId: string;
  merchantKey: string;
  storeId: string;
  balanceId: string;
  destinationPaymentMethodId: string;
  appPublicUrl: string;
  project: string;

  // --- À confirmer en Sandbox ---
  authHeader: string;
  /** Préfixe de la clé (« Bearer »), vide pour envoyer la clé seule. */
  authScheme: string;
  cashInPaymentType: string;
  merchantMethodType: string;
  paths: {
    paymentMethods: string;
    cashIn: string;
    sessions: string;
    /** {id} est remplacé par l'identifiant de la transaction. */
    transaction: string;
    cancel: string;
  };
  /** Champ de la réponse Create Session qui contient l'URL de paiement. */
  sessionUrlField: string;
  /** Modèle d'URL si la session ne renvoie qu'un identifiant ({id}). */
  checkoutUrlTemplate: string;
  /** Âge maximal d'un webhook, en secondes (0 : pas de contrôle). */
  webhookToleranceSeconds: number;
}

const PRODUCTION_BASE_URL = 'https://api.neero.tech/payment-gateway';

export function readNeeroConfig(env: NodeJS.ProcessEnv = process.env): NeeroConfig {
  const mode = env.NEERO_ENV === 'production' ? 'production' : 'sandbox';
  const tolerance = Number(env.NEERO_WEBHOOK_TOLERANCE_SECONDS ?? 300);

  return {
    env: mode,
    // Pas de valeur par défaut en Sandbox : l'URL doit être copiée
    // depuis la documentation plutôt que devinée.
    baseUrl: (env.NEERO_BASE_URL || (mode === 'production' ? PRODUCTION_BASE_URL : '')).replace(/\/$/, ''),
    secretKey: env.NEERO_SECRET_KEY ?? '',
    webhookSecret: env.NEERO_WEBHOOK_SECRET ?? '',
    operatorId: env.NEERO_OPERATOR_ID ?? '',
    merchantKey: env.NEERO_MERCHANT_KEY ?? '',
    storeId: env.NEERO_STORE_ID ?? '',
    balanceId: env.NEERO_BALANCE_ID ?? '',
    destinationPaymentMethodId: env.NEERO_DESTINATION_PAYMENT_METHOD_ID ?? '',
    appPublicUrl: (env.APP_PUBLIC_URL || env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, ''),
    project: env.NEERO_PROJECT || 'numera-facturation',

    authHeader: env.NEERO_AUTH_HEADER || 'Authorization',
    authScheme: env.NEERO_AUTH_SCHEME ?? 'Bearer',
    cashInPaymentType: env.NEERO_CASH_IN_PAYMENT_TYPE || 'TRANSFER_TO_NEERO_PERSON',
    merchantMethodType: env.NEERO_MERCHANT_METHOD_TYPE || '',
    paths: {
      paymentMethods: env.NEERO_PATH_PAYMENT_METHODS || '/api/v1/payment-methods',
      cashIn: env.NEERO_PATH_CASH_IN || '/api/v1/transaction-intents/cash-in',
      sessions: env.NEERO_PATH_SESSIONS || '/api/v1/sessions',
      transaction: env.NEERO_PATH_TRANSACTION || '/api/v1/transaction-intents/{id}',
      cancel: env.NEERO_PATH_CANCEL || '/api/v1/transaction-intents/{id}/cancel',
    },
    sessionUrlField: env.NEERO_SESSION_URL_FIELD || '',
    checkoutUrlTemplate: env.NEERO_CHECKOUT_URL_TEMPLATE || '',
    webhookToleranceSeconds: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 300,
  };
}

/** Prêt à encaisser : les valeurs sans lesquelles aucun paiement n'aboutit. */
export function isNeeroConfigured(config: NeeroConfig): boolean {
  return !!(config.baseUrl && config.secretKey && config.destinationPaymentMethodId);
}
