import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';

import { BRAND } from '../config/brand';

/**
 * ============================================================
 *  PASSERELLE STRIPE — paiement par carte, renouvellement auto
 * ============================================================
 *
 *  Complète Flutterwave (Mobile Money) : une carte bancaire se
 *  prélève chaque mois sans action du client, là où le Mobile
 *  Money impose une relance.
 *
 *  - Paiement sur la page hébergée Stripe Checkout : aucune
 *    donnée de carte ne transite par nos serveurs.
 *  - Prix créés à la volée (price_data) : aucun produit à
 *    préparer dans le tableau de bord Stripe.
 *  - Montants facturés en XAF. Le XAF est une devise « sans
 *    décimale » chez Stripe : 10 000 FCFA s'envoient 10000 (et
 *    non 1000000). Stripe convertit vers la devise de versement
 *    du compte (EUR pour un compte européen).
 *
 *  Aucun autre fichier n'importe le SDK Stripe.
 * ============================================================
 */

/** Centimes de FCFA (unité interne) → unité Stripe pour XAF. */
export function centsToStripeXaf(cents: number): number {
  return Math.round(cents / 100);
}

/** Unité Stripe pour XAF → centimes de FCFA (unité interne). */
export function stripeXafToCents(amount: number): number {
  return amount * 100;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  /** Stripe est-il configuré sur ce serveur ? */
  get isEnabled(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  private get stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'Le paiement par carte n’est pas configuré sur ce serveur.',
      );
    }
    if (!this.client) {
      this.client = new Stripe(key, {
        appInfo: { name: BRAND.name },
        maxNetworkRetries: 2,
        timeout: 20_000,
        // Serveur Stripe simulé pour les tests locaux uniquement.
        ...(process.env.NODE_ENV !== 'production' && process.env.STRIPE_API_HOST
          ? {
              host: process.env.STRIPE_API_HOST,
              port: Number(process.env.STRIPE_API_PORT ?? 443),
              protocol: (process.env.STRIPE_API_PROTOCOL ?? 'https') as
                | 'http'
                | 'https',
            }
          : {}),
      });
      if (key.startsWith('sk_live_')) {
        this.logger.log('Stripe configuré en mode réel (live)');
      }
    }
    return this.client;
  }

  /**
   * Crée une session Checkout pour un abonnement mensuel.
   * Le client est redirigé vers la page Stripe ; le retour se fait
   * sur `successUrl` (avec {CHECKOUT_SESSION_ID}) ou `cancelUrl`.
   */
  async createSubscriptionCheckout(params: {
    organizationId: string;
    txRef: string;
    planCode: string;
    planLabel: string;
    priceCents: number;
    customerId?: string | null;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }> {
    const metadata = {
      organizationId: params.organizationId,
      planCode: params.planCode,
      txRef: params.txRef,
    };

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        locale: 'fr',
        client_reference_id: params.organizationId,
        ...(params.customerId
          ? { customer: params.customerId }
          : { customer_email: params.customerEmail }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'xaf',
              unit_amount: centsToStripeXaf(params.priceCents),
              recurring: { interval: 'month' },
              product_data: { name: `${BRAND.name} — ${params.planLabel}` },
            },
          },
        ],
        metadata,
        // Recopiées sur l'abonnement : chaque facture mensuelle
        // (webhook invoice.paid) retrouve ainsi son organisation.
        subscription_data: { metadata },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      // Un double clic ne crée pas deux sessions.
      { idempotencyKey: `checkout-${params.txRef}` },
    );

    if (!session.url) throw new Error('Stripe n’a pas renvoyé d’URL de paiement');
    return { id: session.id, url: session.url };
  }

  retrieveCheckoutSession(sessionId: string) {
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }

  retrieveSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  /** Résiliation à la fin de la période déjà payée. */
  cancelAtPeriodEnd(subscriptionId: string, cancel = true) {
    return this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancel,
    });
  }

  /**
   * Arrêt immédiat, au prorata : utilisé lors d'un changement de
   * formule, quand le nouvel abonnement remplace l'ancien. Le
   * temps non consommé est crédité sur le solde du client Stripe
   * et vient en déduction de sa prochaine facture.
   */
  cancelNow(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId, { prorate: true });
  }

  /** Portail client : carte bancaire, factures, résiliation. */
  async createPortalSession(customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      locale: 'fr',
    });
    return session.url;
  }

  /**
   * Vérifie la signature d'un webhook et renvoie l'événement.
   * Lève une erreur si la signature ou le corps est invalide.
   */
  constructEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET non configuré');
    if (!signature) throw new Error('Signature Stripe absente');
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}

/**
 * Fin de la période en cours d'un abonnement Stripe.
 * Depuis l'API 2025-03-31, elle est portée par chaque élément de
 * l'abonnement et non plus par l'abonnement lui-même.
 */
export function stripePeriodEnd(subscription: Stripe.Subscription): Date {
  const legacy = (subscription as unknown as { current_period_end?: number })
    .current_period_end;
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');
  const seconds = ends.length ? Math.min(...ends) : legacy;
  if (!seconds) throw new Error('Période Stripe introuvable');
  return new Date(seconds * 1000);
}

export type { Stripe };
