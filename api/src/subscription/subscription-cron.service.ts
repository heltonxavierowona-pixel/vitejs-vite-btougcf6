import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DeclarationStatus,
  PaymentProvider,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { gracePeriodDays, PLANS } from './plans';
import { NeeroBillingService } from './neero-billing.service';
import { NotifierService } from './notifier.service';
import { BRAND } from '../config/brand';
import { ManualPaymentService } from './manual-payment.service';
import { SubscriptionService } from './subscription.service';
import { daysUntilDue, vatDueDate } from '../tax/deadline.util';

/**
 * ============================================================
 *  TÂCHES PLANIFIÉES
 * ============================================================
 *
 *  Deux cycles distincts :
 *
 *  1. RELANCE D'ABONNEMENT — indispensable puisque le Mobile
 *     Money ne prélève pas automatiquement. Sans ce cycle, le
 *     renouvellement repose sur la bonne volonté du client.
 *
 *  2. RAPPEL D'ÉCHÉANCE FISCALE — la valeur perçue du produit.
 *     C'est le message du 10 du mois qui fait qu'on garde
 *     l'abonnement.
 *
 *  Les relances d'abonnement partent par e-mail (NotifierService).
 *  Les rappels fiscaux restent à brancher (dispatchTaxReminder).
 * ============================================================
 */
@Injectable()
export class SubscriptionCronService {
  private readonly logger = new Logger(SubscriptionCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly manualPayments: ManualPaymentService,
    private readonly neeroBilling: NeeroBillingService,
    private readonly notifier: NotifierService,
  ) {}

  // ----------------------------------------------------------
  //  1. Cycle de relance d'abonnement — tous les jours à 8h
  // ----------------------------------------------------------

  /**
   * Sur un serveur permanent (Docker), les tâches tournent ici.
   * Sur Vercel (fonctions à la demande), aucun minuteur ne survit :
   * c'est Vercel Cron qui appelle /api/cron/* (voir CronController).
   */
  private get internalSchedulerEnabled() {
    return !process.env.VERCEL;
  }

  @Cron('0 8 * * *', { timeZone: 'Africa/Douala' })
  async scheduledDunning() {
    if (this.internalSchedulerEnabled) await this.runDunning();
  }

  /** Webhooks Neero perdus : rattrapage toutes les 15 minutes. */
  @Cron('*/15 * * * *')
  async scheduledPaymentsReconcile() {
    if (this.internalSchedulerEnabled) await this.neeroBilling.reconcilePending();
  }

  @Cron('0 7 * * *', { timeZone: 'Africa/Douala' })
  async scheduledTaxReminders() {
    if (this.internalSchedulerEnabled) await this.runTaxReminders();
  }

  async runDunning() {
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 86_400_000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000);

    // Les abonnements par carte (Stripe) se renouvellent tout seuls :
    // pas de relance, et on ne les déclare impayés que si aucune
    // confirmation n'est arrivée 3 jours après l'échéance (webhook
    // perdu, par exemple).
    const notStripe: Prisma.SubscriptionWhereInput = {
      OR: [{ provider: null }, { provider: { not: PaymentProvider.STRIPE } }],
    };

    // --- Paiement manuel : la demande de renouvellement est créée
    //     AVANT les relances, qui donnent ainsi le bon message au
    //     client ; l'administrateur reçoit la liste à traiter ---
    let renewals = 0;
    if (!this.subscriptions.onlinePaymentsEnabled) {
      renewals = await this.manualPayments.createRenewalRequests(now);
      await this.manualPayments.remindAdminOfPending();
      await this.manualPayments.remindPlanLinksRenewal();
    }

    // --- Neero : rattrapage des webhooks perdus (sur Vercel, seul
    //     passage garanti), puis liens de paiement à J-5 et J-1 ---
    if (this.neeroBilling.enabled) {
      await this.neeroBilling.reconcilePending(now);
      renewals += await this.neeroBilling.sendRenewalLinks(now);
    }

    // --- a) Échéance proche : prévenir avant expiration ---
    const expiringSoon = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { gt: now, lte: in3Days },
        priceAmount: { gt: 0 },
        ...notStripe,
      },
      include: { organization: true },
    });

    // Avec Neero, les liens de J-5 et J-1 tiennent lieu de rappel.
    for (const subscription of this.neeroBilling.enabled ? [] : expiringSoon) {
      await this.dispatchRenewalReminder(subscription, 'BEFORE');
    }

    // --- b) Échéance dépassée : passer en impayé + grâce ---
    const justExpired = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        priceAmount: { gt: 0 },
        OR: [
          { currentPeriodEnd: { lte: now }, ...notStripe },
          { currentPeriodEnd: { lte: threeDaysAgo }, provider: PaymentProvider.STRIPE },
        ],
      },
      include: { organization: true },
    });

    for (const subscription of justExpired) {
      const graceEnd = new Date(now);
      graceEnd.setDate(graceEnd.getDate() + gracePeriodDays());

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          gracePeriodEnd: graceEnd,
          remindersSent: 1,
          lastReminderAt: now,
        },
      });

      await this.dispatchRenewalReminder(
        { ...subscription, status: SubscriptionStatus.PAST_DUE, gracePeriodEnd: graceEnd },
        'DUE',
      );
    }

    // --- c) Impayés : relancer tous les 3 jours ---
    const pastDue = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        gracePeriodEnd: { gt: now },
      },
      include: { organization: true },
    });

    for (const subscription of pastDue) {
      const since = subscription.lastReminderAt
        ? (now.getTime() - subscription.lastReminderAt.getTime()) / 86_400_000
        : 99;

      if (since >= 3) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            remindersSent: subscription.remindersSent + 1,
            lastReminderAt: now,
          },
        });
        await this.dispatchRenewalReminder(subscription, 'OVERDUE');
      }
    }

    // --- d) Grâce écoulée : suspendre ---
    const suspended = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.PAST_DUE, gracePeriodEnd: { lte: now } },
      include: { organization: true },
    });
    const toSuspend = await this.prisma.subscription.updateMany({
      where: {
        id: { in: suspended.map((subscription) => subscription.id) },
        status: SubscriptionStatus.PAST_DUE,
      },
      data: { status: SubscriptionStatus.SUSPENDED },
    });
    for (const subscription of suspended) {
      await this.notifySuspension(subscription);
    }

    this.logger.log(
      `Relances : ${renewals} renouvellement(s) créé(s), ${expiringSoon.length} à venir, ${justExpired.length} échues, ` +
        `${pastDue.length} impayées, ${toSuspend.count} suspendues`,
    );
  }

  // ----------------------------------------------------------
  //  2. Rappels d'échéance fiscale — tous les jours à 7h
  // ----------------------------------------------------------

  async runTaxReminders() {
    const now = new Date();
    const period = this.currentDeclarablePeriod(now);
    const dueDate = vatDueDate(period);
    const daysLeft = daysUntilDue(dueDate, now);

    // On alerte à J-5, J-2 et le jour même.
    if (![5, 2, 0].includes(daysLeft)) return;

    const entities = await this.prisma.entity.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        isVatSubject: true,
        organization: {
          subscription: {
            status: {
              in: [
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.PAST_DUE,
              ],
            },
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        declarations: {
          where: { periodYear: period.year, periodMonth: period.month },
          select: { status: true },
        },
        _count: {
          select: { invoices: { where: { status: 'DRAFT', deletedAt: null } } },
        },
      },
    });

    let sent = 0;

    for (const entity of entities) {
      const status = entity.declarations[0]?.status;
      const done =
        status === DeclarationStatus.SUBMITTED ||
        status === DeclarationStatus.PAID;

      if (done) continue;

      await this.dispatchTaxReminder({
        entityId: entity.id,
        entityName: entity.legalName,
        organizationId: entity.organization.id,
        daysLeft,
        pendingDrafts: entity._count.invoices,
      });
      sent += 1;
    }

    this.logger.log(`Rappels TVA J-${daysLeft} : ${sent} envoyés`);
  }

  // ----------------------------------------------------------
  //  Points d'accroche — à brancher sur le canal retenu
  // ----------------------------------------------------------

  /** Prévient le client que la saisie est bloquée. */
  private async notifySuspension(subscription: {
    organizationId: string;
    plan: PlanCode;
    organization: { billingEmail: string };
  }) {
    try {
      await this.notifier.sendEmail(
        await this.subscriptions.clientEmail(subscription.organizationId, subscription.organization.billingEmail),
        `${BRAND.name} — abonnement suspendu`,
        [
          'Bonjour,',
          '',
          `Votre abonnement ${PLANS[subscription.plan].label} n’a pas été renouvelé : la saisie est suspendue.`,
          'Vos factures et déclarations restent consultables.',
          `Renouvelez depuis la page Abonnement pour tout réactiver immédiatement : ${(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '')}/abonnement`,
        ].join('\n'),
      );
    } catch (error) {
      this.logger.error(`Avis de suspension non envoyé : ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Relance du client par e-mail, avec son lien de paiement s'il existe. */
  private async dispatchRenewalReminder(
    subscription: Parameters<ManualPaymentService['remindClient']>[0],
    stage: 'BEFORE' | 'DUE' | 'OVERDUE',
  ) {
    try {
      if (this.neeroBilling.enabled && stage !== 'BEFORE') {
        await this.neeroBilling.remindClient(subscription);
        return;
      }
      await this.manualPayments.remindClient(subscription, stage);
    } catch (error) {
      // Une relance ratée ne doit pas interrompre les suivantes.
      this.logger.error(
        `Relance ${stage} non envoyée — ${subscription.organizationId} : ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** ⚠️ NON IMPLÉMENTÉ — même remarque. */
  private async dispatchTaxReminder(payload: {
    entityId: string;
    entityName: string;
    organizationId: string;
    daysLeft: number;
    pendingDrafts: number;
  }) {
    this.logger.debug(
      `[TODO] Rappel TVA J-${payload.daysLeft} — ${payload.entityName}` +
        (payload.pendingDrafts
          ? ` (${payload.pendingDrafts} brouillon(s) non validé(s))`
          : ''),
    );
  }

  private currentDeclarablePeriod(now: Date) {
    const month = now.getUTCMonth();
    return month === 0
      ? { year: now.getUTCFullYear() - 1, month: 12 }
      : { year: now.getUTCFullYear(), month };
  }
}
