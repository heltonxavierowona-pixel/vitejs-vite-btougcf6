import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentStatus,
  PlanCode,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NeeroProvider } from '../payments/neero/neero.provider';
import { PaymentWebhookEvent } from '../payments/payment-provider';
import { BRAND } from '../config/brand';
import { PLANS } from './plans';
import { NotifierService } from './notifier.service';
import { SubscriptionService } from './subscription.service';

/** Relance d'un paiement « pending » resté sans webhook. */
const RECONCILE_AFTER_MINUTES = 10;

/**
 * ============================================================
 *  ENCAISSEMENT NEERO — webhooks, rattrapage, renouvellements
 * ============================================================
 *
 *  Règle : rien n'est activé sur la foi du navigateur ou du seul
 *  webhook. Chaque chemin finit dans SubscriptionService
 *  .confirmPayment, qui relit la transaction chez Neero (statut,
 *  montant, devise) et n'ouvre la période qu'une fois.
 * ============================================================
 */
@Injectable()
export class NeeroBillingService {
  private readonly logger = new Logger(NeeroBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neero: NeeroProvider,
    private readonly subscriptions: SubscriptionService,
    private readonly notifier: NotifierService,
  ) {}

  get enabled(): boolean {
    return this.subscriptions.onlinePaymentsEnabled && this.neero.isConfigured;
  }

  // ----------------------------------------------------------
  //  Webhook
  // ----------------------------------------------------------

  async handleWebhook(event: PaymentWebhookEvent) {
    // Un autre opérateur Neero (autre projet NUMERA) : pas pour nous.
    const operatorId = this.neero.config.operatorId;
    if (operatorId && event.operatorId && event.operatorId !== operatorId) {
      this.logger.warn(`Webhook Neero ${event.eventId} d’un autre opérateur (${event.operatorId}) ignoré`);
      return { ignored: true, reason: 'operator' };
    }
    if (!event.type.startsWith('transactionIntent.')) return { ignored: true, reason: 'type' };

    const paymentId = typeof event.metadata.paymentId === 'string' ? event.metadata.paymentId : undefined;
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: PaymentProvider.NEERO,
        OR: [
          ...(event.transactionIntentId ? [{ providerTxId: event.transactionIntentId }] : []),
          ...(paymentId ? [{ id: paymentId }] : []),
        ],
      },
    });
    if (!payment) return { ignored: true, reason: 'payment' };

    return this.subscriptions.confirmPayment(payment.txRef, payment.providerTxId ?? '');
  }

  // ----------------------------------------------------------
  //  Filet de sécurité : webhooks perdus
  // ----------------------------------------------------------

  /**
   * Relit chez Neero les paiements en attente depuis plus de
   * 10 minutes ; au-delà du délai d'expiration, la transaction est
   * annulée chez Neero et marquée expirée.
   */
  async reconcilePending(now = new Date()) {
    if (!this.neero.isConfigured) return { checked: 0, expired: 0 };
    const expiryHours = Number(process.env.NEERO_PENDING_EXPIRY_HOURS ?? 24) || 24;

    const pending = await this.prisma.payment.findMany({
      where: {
        provider: PaymentProvider.NEERO,
        status: PaymentStatus.PENDING,
        providerTxId: { not: null },
        createdAt: { lte: new Date(now.getTime() - RECONCILE_AFTER_MINUTES * 60_000) },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let expired = 0;
    for (const payment of pending) {
      try {
        const result = await this.subscriptions.confirmPayment(payment.txRef, payment.providerTxId ?? '');
        if (result.success) continue;

        const stale = payment.createdAt.getTime() < now.getTime() - expiryHours * 3_600_000;
        const still = await this.prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
        if (stale && still?.status === PaymentStatus.PENDING) {
          await this.neero.cancelTransaction(payment.providerTxId!).catch((error) =>
            this.logger.warn(`Annulation Neero de ${payment.txRef} impossible : ${error instanceof Error ? error.message : error}`),
          );
          const closed = await this.prisma.payment.updateMany({
            where: { id: payment.id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.EXPIRED, failureReason: `Non payé sous ${expiryHours} h` },
          });
          expired += closed.count;
        }
      } catch (error) {
        this.logger.error(`Rattrapage de ${payment.txRef} impossible : ${error instanceof Error ? error.message : error}`);
      }
    }
    if (pending.length) this.logger.log(`Rattrapage Neero : ${pending.length} vérifié(s), ${expired} expiré(s)`);
    return { checked: pending.length, expired };
  }

  // ----------------------------------------------------------
  //  Renouvellements : lien envoyé à J-5 et J-1
  // ----------------------------------------------------------

  async sendRenewalLinks(now = new Date()) {
    if (!this.enabled) return 0;
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        priceAmount: { gt: 0 },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 5 * 86_400_000) },
        OR: [{ provider: null }, { provider: { not: PaymentProvider.STRIPE } }],
      },
      include: { organization: true },
    });

    let sent = 0;
    for (const subscription of subscriptions) {
      const daysLeft = Math.ceil((subscription.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000);
      const stage = daysLeft === 5 ? 'J-5' : daysLeft === 1 ? 'J-1' : null;
      if (!stage) continue;

      // Une seule relance par étape et par échéance, même si la tâche repasse.
      const already = await this.prisma.payment.findFirst({
        where: {
          organizationId: subscription.organizationId,
          provider: PaymentProvider.NEERO,
          createdAt: { gte: new Date(now.getTime() - 3 * 86_400_000) },
          providerRaw: { path: ['renewalStage'], equals: stage },
        },
      });
      if (already) continue;

      try {
        const { paymentUrl } = await this.subscriptions.checkoutNeero(
          { ...subscription.organization, subscription: { id: subscription.id } },
          subscription.plan,
          '',
          { renewalStage: stage },
        );
        await this.notifier.sendEmail(
          await this.subscriptions.clientEmail(subscription.organizationId, subscription.organization.billingEmail),
          `${BRAND.name} — renouvellement de votre abonnement`,
          [
            'Bonjour,',
            '',
            `Votre formule ${PLANS[subscription.plan].label} arrive à échéance le ${frDate(subscription.currentPeriodEnd)}.`,
            `Renouvelez-la en payant ${fcfa(PLANS[subscription.plan].priceMonthly)} (MTN, Orange) avec ce lien sécurisé :`,
            paymentUrl,
            '',
            'Votre accès est prolongé d’un mois dès la confirmation du paiement.',
          ].join('\n'),
        );
        sent += 1;
      } catch (error) {
        this.logger.error(
          `Lien de renouvellement ${stage} non créé pour ${subscription.organization.name} : ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return sent;
  }

  /** Relance après l'échéance : renvoi vers la page Abonnement. */
  async remindClient(
    subscription: { organizationId: string; plan: PlanCode; gracePeriodEnd: Date | null; organization: { billingEmail: string } },
  ) {
    const app = this.neero.config.appPublicUrl;
    await this.notifier.sendEmail(
      await this.subscriptions.clientEmail(subscription.organizationId, subscription.organization.billingEmail),
      `${BRAND.name} — abonnement à renouveler`,
      [
        'Bonjour,',
        '',
        `Votre abonnement ${PLANS[subscription.plan].label} n’est pas encore renouvelé.` +
          (subscription.gracePeriodEnd
            ? ` Sans paiement avant le ${frDate(subscription.gracePeriodEnd)}, la saisie sera bloquée (vos données resteront consultables).`
            : ''),
        `Renouvelez en quelques secondes depuis la page Abonnement : ${app}/abonnement`,
      ].join('\n'),
    );
  }
}

function fcfa(centimes: number): string {
  return `${Math.round(centimes / 100).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
}

function frDate(value: Date): string {
  return value.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' });
}

