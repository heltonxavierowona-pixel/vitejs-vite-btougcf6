import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentProvider,
  PaymentStatus,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GRACE_PERIOD_DAYS, PLANS } from './plans';
import {
  Stripe,
  StripeService,
  stripePeriodEnd,
  stripeXafToCents,
} from './stripe.service';

const FRONTEND = () => process.env.FRONTEND_URL ?? 'http://localhost:3001';

/**
 * ============================================================
 *  ABONNEMENTS PAYÉS PAR CARTE (STRIPE)
 * ============================================================
 *
 *  Cycle de vie :
 *   1. checkout()        → session Checkout, paiement « en attente »
 *   2. checkout.session.completed (webhook) ou retour navigateur
 *                        → abonnement activé, lien Stripe mémorisé
 *   3. invoice.paid      → chaque mois, période prolongée
 *   4. invoice.payment_failed → impayé + période de grâce
 *   5. customer.subscription.updated / deleted → résiliation
 *
 *  RÈGLES :
 *   - On ne croit jamais le navigateur : l'état vient de Stripe
 *     (webhook signé, ou relecture de la session par l'API).
 *   - Tout est idempotent : Stripe peut réémettre un événement,
 *     et le webhook et le retour navigateur arrivent souvent en
 *     même temps.
 *   - Un événement d'un ancien abonnement (remplacé lors d'un
 *     changement de formule) ne modifie jamais l'abonnement actuel.
 * ============================================================
 */
@Injectable()
export class StripeBillingService {
  private readonly logger = new Logger(StripeBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  get isEnabled() {
    return this.stripe.isEnabled;
  }

  // ----------------------------------------------------------
  //  1. Session de paiement
  // ----------------------------------------------------------

  async checkout(
    organization: { id: string; billingEmail: string },
    planCode: PlanCode,
    userEmail: string,
    txRef: string,
    existing: { stripeCustomerId: string | null; subscriptionId?: string } | null,
  ) {
    const plan = PLANS[planCode];

    const payment = await this.prisma.payment.create({
      data: {
        organizationId: organization.id,
        subscriptionId: existing?.subscriptionId,
        provider: PaymentProvider.STRIPE,
        amount: plan.priceMonthly,
        currency: 'XAF',
        txRef,
        status: PaymentStatus.PENDING,
        providerRaw: { planCode },
      },
    });

    const session = await this.stripe.createSubscriptionCheckout({
      organizationId: organization.id,
      txRef,
      planCode,
      planLabel: plan.label,
      priceCents: plan.priceMonthly,
      customerId: existing?.stripeCustomerId,
      customerEmail: organization.billingEmail || userEmail,
      successUrl: `${FRONTEND()}/abonnement/retour?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${FRONTEND()}/abonnement?paiement=annule`,
    });

    return { paymentId: payment.id, txRef, paymentUrl: session.url, plan };
  }

  // ----------------------------------------------------------
  //  2. Activation (webhook ou retour navigateur)
  // ----------------------------------------------------------

  /** Retour navigateur : relit la session chez Stripe. */
  async confirmSession(sessionId: string, organizationId: string) {
    const session = await this.stripe.retrieveCheckoutSession(sessionId);
    if (session.client_reference_id !== organizationId) {
      throw new NotFoundException('Paiement introuvable');
    }
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      return { success: false, reason: 'Le paiement n’est pas encore confirmé par Stripe.' };
    }
    await this.activateFromSession(session);
    return { success: true };
  }

  private async activateFromSession(session: Stripe.Checkout.Session) {
    const organizationId = session.client_reference_id;
    const txRef = session.metadata?.txRef;
    const planCode = session.metadata?.planCode as PlanCode | undefined;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (!organizationId || !txRef || !planCode || !PLANS[planCode] || !subscriptionId) {
      this.logger.warn(`Session Stripe ${session.id} incomplète : ignorée`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({ where: { txRef } });
    if (!payment || payment.organizationId !== organizationId) {
      this.logger.warn(`Session Stripe ${session.id} sans paiement correspondant`);
      return;
    }

    const stripeSubscription = await this.stripe.retrieveSubscription(subscriptionId);
    const plan = PLANS[planCode];

    const previous = await this.prisma.$transaction(async (tx) => {
      // Verrou : un seul des deux chemins (webhook / navigateur)
      // active l'abonnement.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.SUCCEEDED } },
        data: {
          status: PaymentStatus.SUCCEEDED,
          providerTxId: session.id,
          paidAt: new Date(),
          amount: session.amount_total
            ? stripeXafToCents(session.amount_total)
            : payment.amount,
          providerRaw: { planCode, sessionId: session.id, subscriptionId },
        },
      });
      if (claimed.count === 0) return null;

      const existing = await tx.subscription.findUnique({ where: { organizationId } });
      const data = {
        plan: planCode,
        status: SubscriptionStatus.ACTIVE,
        provider: PaymentProvider.STRIPE,
        stripeCustomerId: customerId ?? existing?.stripeCustomerId ?? null,
        stripeSubscriptionId: subscriptionId,
        cancelAtPeriodEnd: false,
        maxEntities: plan.maxEntities,
        maxUsers: plan.maxUsers,
        priceAmount: plan.priceMonthly,
        currentPeriodStart: new Date(),
        currentPeriodEnd: stripePeriodEnd(stripeSubscription),
        gracePeriodEnd: null,
        trialEndsAt: null,
        remindersSent: 0,
        lastReminderAt: null,
        cancelledAt: null,
      };

      if (existing) {
        await tx.subscription.update({ where: { id: existing.id }, data });
        await tx.payment.update({
          where: { id: payment.id },
          data: { subscriptionId: existing.id },
        });
      } else {
        const created = await tx.subscription.create({
          data: { organizationId, ...data },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: { subscriptionId: created.id },
        });
      }

      return existing?.stripeSubscriptionId ?? null;
    });

    // Changement de formule : l'ancien abonnement par carte est
    // arrêté, le temps non consommé est crédité au client.
    if (previous && previous !== subscriptionId) {
      await this.stripe
        .cancelNow(previous)
        .catch((error: Error) =>
          this.logger.error(`Arrêt de l'ancien abonnement ${previous} impossible`, error.message),
        );
    }
  }

  // ----------------------------------------------------------
  //  3–5. Webhooks
  // ----------------------------------------------------------

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const event = this.stripe.constructEvent(rawBody, signature);

    // Déduplication : Stripe peut réémettre le même événement.
    const known = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'STRIPE', externalId: event.id } },
    });
    if (known?.processedAt) return { received: true, duplicate: true };

    const record =
      known ??
      (await this.prisma.webhookEvent.create({
        data: {
          provider: 'STRIPE',
          eventType: event.type,
          externalId: event.id,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      }));

    try {
      await this.dispatch(event);
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: null },
      });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      // Erreur renvoyée : Stripe retentera l'envoi plus tard.
      throw error;
    }

    return { received: true };
  }

  private async dispatch(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.payment_status === 'paid') {
          await this.activateFromSession(session);
        }
        return;
      }
      case 'invoice.paid':
        return this.onInvoicePaid(event.data.object);
      case 'invoice.payment_failed':
        return this.onInvoiceFailed(event.data.object);
      case 'customer.subscription.updated':
        return this.onSubscriptionUpdated(event.data.object);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event.data.object);
      default:
        return; // Événement non utilisé : accusé de réception seulement.
    }
  }

  /** Renouvellement mensuel réussi : on prolonge la période. */
  private async onInvoicePaid(invoice: Stripe.Invoice) {
    const subscriptionId = this.invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const local = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    // Première facture : l'abonnement local est lié par
    // checkout.session.completed, qui peut arriver après.
    if (!local) return;

    const stripeSubscription = await this.stripe.retrieveSubscription(subscriptionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: local.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: stripePeriodEnd(stripeSubscription),
          gracePeriodEnd: null,
          remindersSent: 0,
          lastReminderAt: null,
        },
      });

      // La première facture est déjà enregistrée (paiement du
      // Checkout) ; seuls les renouvellements créent une ligne.
      if (invoice.billing_reason !== 'subscription_create' && invoice.amount_paid > 0) {
        await tx.payment.upsert({
          where: { txRef: `STRIPE-${invoice.id}` },
          create: {
            organizationId: local.organizationId,
            subscriptionId: local.id,
            provider: PaymentProvider.STRIPE,
            status: PaymentStatus.SUCCEEDED,
            amount: stripeXafToCents(invoice.amount_paid),
            currency: invoice.currency.toUpperCase(),
            txRef: `STRIPE-${invoice.id}`,
            providerTxId: invoice.id,
            method: 'OTHER',
            paidAt: new Date(),
            providerRaw: { invoiceId: invoice.id, billingReason: invoice.billing_reason },
          },
          update: {},
        });
      }
    });
  }

  /** Échec du prélèvement : impayé, avec période de grâce. */
  private async onInvoiceFailed(invoice: Stripe.Invoice) {
    const subscriptionId = this.invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const local = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!local || local.status === SubscriptionStatus.PAST_DUE) return;

    const graceEnd = new Date();
    graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: { status: SubscriptionStatus.PAST_DUE, gracePeriodEnd: graceEnd },
    });
  }

  /** Résiliation programmée, reprise, changement d'échéance. */
  private async onSubscriptionUpdated(subscription: Stripe.Subscription) {
    const local = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!local) return;

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: stripePeriodEnd(subscription),
        ...(subscription.status === 'active' &&
          local.status === SubscriptionStatus.PAST_DUE && {
            status: SubscriptionStatus.ACTIVE,
            gracePeriodEnd: null,
          }),
      },
    });
  }

  /** Abonnement terminé chez Stripe (résilié ou impayé définitif). */
  private async onSubscriptionDeleted(subscription: Stripe.Subscription) {
    const local = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    // Ancien abonnement remplacé par un changement de formule :
    // il n'est plus lié, on n'y touche pas.
    if (!local) return;

    const endedAt = subscription.ended_at
      ? new Date(subscription.ended_at * 1000)
      : new Date();

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: local.cancelledAt ?? new Date(),
        cancelAtPeriodEnd: false,
        // La lecture reste ouverte, la saisie se ferme à cette date.
        currentPeriodEnd: endedAt,
        stripeSubscriptionId: null,
      },
    });
  }

  private invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const details = invoice.parent?.subscription_details;
    if (!details) return null;
    return typeof details.subscription === 'string'
      ? details.subscription
      : details.subscription.id;
  }

  // ----------------------------------------------------------
  //  Gestion par le client
  // ----------------------------------------------------------

  async portal(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription?.stripeCustomerId) {
      throw new BadRequestException('Aucun abonnement par carte à gérer.');
    }
    const url = await this.stripe.createPortalSession(
      subscription.stripeCustomerId,
      `${FRONTEND()}/abonnement`,
    );
    return { url };
  }

  /** Résiliation (ou reprise) à la fin de la période payée. */
  async setCancelAtPeriodEnd(stripeSubscriptionId: string, cancel: boolean) {
    const updated = await this.stripe.cancelAtPeriodEnd(stripeSubscriptionId, cancel);
    return this.prisma.subscription.update({
      where: { stripeSubscriptionId },
      data: {
        cancelAtPeriodEnd: updated.cancel_at_period_end,
        cancelledAt: cancel ? new Date() : null,
      },
    });
  }
}
