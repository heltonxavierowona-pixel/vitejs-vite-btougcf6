/**
 * ============================================================
 *  INTERFACE DE PASSERELLE DE PAIEMENT
 * ============================================================
 *
 *  Le métier (abonnements) ne parle qu'à cette interface : changer
 *  de fournisseur revient à écrire une nouvelle implémentation,
 *  sans toucher au reste. Module conçu pour être recopié tel quel
 *  dans les autres projets NUMERA.
 *
 *  Montants : francs CFA entiers (XAF n'a pas de sous-unité).
 * ============================================================
 */

/** Statuts internes, communs à tous les fournisseurs. */
export type NormalizedPaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'canceled';

export interface CheckoutParams {
  /** Montant en francs CFA entiers, toujours calculé côté serveur. */
  amount: number;
  currency: 'XAF';
  customer: { name: string; email?: string; phone?: string };
  /** Nos identifiants internes, renvoyés par le fournisseur dans les webhooks. */
  metadata: Record<string, string>;
  successUrl: string;
  failureUrl: string;
  cancelUrl: string;
  displayInfo?: { name: string; imageUrl?: string };
}

export interface CheckoutResult {
  transactionIntentId: string;
  paymentUrl: string;
}

export interface TransactionStatus {
  transactionIntentId: string;
  status: NormalizedPaymentStatus;
  /** Statut tel que renvoyé par le fournisseur (journalisation). */
  providerStatus: string;
  /** Francs CFA entiers ; null si le fournisseur ne le renvoie pas. */
  amount: number | null;
  currency: string | null;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export interface PaymentWebhookEvent {
  eventId: string;
  type: string;
  transactionIntentId: string | null;
  /** Statut annoncé par le webhook : indicatif, toujours revérifié. */
  status: NormalizedPaymentStatus | null;
  operatorId: string | null;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  /** Nom court enregistré en base (ex. « neero »). */
  readonly name: string;
  readonly isConfigured: boolean;

  /** Crée la demande d'encaissement et la page de paiement hébergée. */
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  /** Statut réel, relu chez le fournisseur. */
  getTransactionStatus(transactionIntentId: string): Promise<TransactionStatus>;
  cancelTransaction(transactionIntentId: string): Promise<void>;
  /** Signature et fraîcheur du webhook, sur le corps BRUT. */
  verifyWebhook(rawBody: Buffer | string, headers: WebhookHeaders): boolean;
  parseWebhookEvent(rawBody: Buffer | string): PaymentWebhookEvent;
}

/** Erreur d'appel au fournisseur, sans donnée sensible dans le message. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
