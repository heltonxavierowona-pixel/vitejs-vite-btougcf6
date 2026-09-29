import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DeclarationStatus,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GRACE_PERIOD_DAYS } from './plans';
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
 *  ⚠️ L'envoi réel (WhatsApp, SMS, e-mail) n'est pas implémenté :
 *  il dépend du fournisseur retenu. Les méthodes dispatch*
 *  sont des points d'accroche.
 * ============================================================
 */
@Injectable()
export class SubscriptionCronService {
  private readonly logger = new Logger(SubscriptionCronService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    for (const subscription of expiringSoon) {
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
      graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          gracePeriodEnd: graceEnd,
          remindersSent: 1,
          lastReminderAt: now,
        },
      });

      await this.dispatchRenewalReminder(subscription, 'DUE');
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
    const toSuspend = await this.prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        gracePeriodEnd: { lte: now },
      },
      data: { status: SubscriptionStatus.SUSPENDED },
    });

    this.logger.log(
      `Relances : ${expiringSoon.length} à venir, ${justExpired.length} échues, ` +
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

  /**
   * ⚠️ NON IMPLÉMENTÉ.
   * Canal à choisir : WhatsApp Business API, SMS, ou e-mail.
   * Sur ce marché, WhatsApp est le plus lu — mais il impose
   * des modèles de message préapprouvés.
   */
  private async dispatchRenewalReminder(
    subscription: any,
    stage: 'BEFORE' | 'DUE' | 'OVERDUE',
  ) {
    this.logger.debug(
      `[TODO] Relance ${stage} — ${subscription.organization.name}`,
    );
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
