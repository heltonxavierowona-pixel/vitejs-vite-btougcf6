import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PaymentProvider,
  PaymentRequestStatus,
  PaymentStatus,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BRAND } from '../config/brand';
import { NotifierService } from '../subscription/notifier.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PLANS, UNLIMITED } from '../subscription/plans';

const DAY = 86_400_000;

/** Segments de clients, utilisés par la liste et par les envois d'e-mails. */
export type ClientSegment =
  | 'all'
  | 'trialing'
  | 'active'
  | 'expiring'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'free';

/** Plafond d'un envoi groupé : Gmail limite à ~500 e-mails par jour. */
export const MAX_BROADCAST = 100;

/**
 * ============================================================
 *  TABLEAU DE BORD DE L'ADMINISTRATRICE DE LA PLATEFORME
 * ============================================================
 *  Chiffres clés, clients, gestes commerciaux, exports et e-mails.
 *  Réservé aux adresses de PLATFORM_ADMIN_EMAILS (voir le contrôleur).
 * ============================================================
 */
@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly notifier: NotifierService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------
  //  Chiffres clés
  // ----------------------------------------------------------

  async stats(now = new Date()) {
    const monthStart = startOfMonthDouala(now);
    const lastMonthStart = startOfMonthDouala(now, -1);
    const in7Days = new Date(now.getTime() + 7 * DAY);
    const notDeleted = { organization: { deletedAt: null } };

    const [
      organizations,
      newThisMonth,
      byStatus,
      paying,
      expiringSoon,
      trialsEndingSoon,
      revenueThisMonth,
      revenueLastMonth,
      pendingRequests,
    ] = await Promise.all([
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organization.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      this.prisma.subscription.groupBy({ by: ['status'], where: notDeleted, _count: true }),
      this.prisma.subscription.aggregate({
        where: { ...notDeleted, status: SubscriptionStatus.ACTIVE, priceAmount: { gt: 0 } },
        _count: true,
        _sum: { priceAmount: true },
      }),
      this.prisma.subscription.count({
        where: {
          ...notDeleted,
          status: SubscriptionStatus.ACTIVE,
          priceAmount: { gt: 0 },
          currentPeriodEnd: { gt: now, lte: in7Days },
        },
      }),
      this.prisma.subscription.count({
        where: { ...notDeleted, status: SubscriptionStatus.TRIALING, currentPeriodEnd: { gt: now, lte: in7Days } },
      }),
      this.revenueBetween(monthStart, now),
      this.revenueBetween(lastMonthStart, monthStart),
      this.prisma.paymentRequest.count({
        where: { status: { in: [PaymentRequestStatus.AWAITING_LINK, PaymentRequestStatus.REFERENCE_SUBMITTED] } },
      }),
    ]);

    const count = (status: SubscriptionStatus) =>
      byStatus.find((row) => row.status === status)?._count ?? 0;

    return {
      organizations,
      newThisMonth,
      subscriptions: {
        trialing: count(SubscriptionStatus.TRIALING),
        active: count(SubscriptionStatus.ACTIVE),
        paying: paying._count,
        pastDue: count(SubscriptionStatus.PAST_DUE),
        suspended: count(SubscriptionStatus.SUSPENDED),
        cancelled: count(SubscriptionStatus.CANCELLED),
      },
      /** Revenu mensuel récurrent : somme des formules payantes actives. */
      mrr: paying._sum.priceAmount ?? 0,
      revenueThisMonth,
      revenueLastMonth,
      expiringSoon,
      trialsEndingSoon,
      pendingRequests,
    };
  }

  /** Encaissements des N derniers mois (fuseau de Douala), mois vides compris. */
  async revenueByMonth(months = 12, now = new Date()) {
    const span = Math.min(Math.max(Math.trunc(months) || 12, 1), 36);
    const from = startOfMonthDouala(now, -(span - 1));

    const rows = await this.prisma.$queryRaw<{ month: string; amount: bigint; count: bigint }[]>`
      SELECT to_char(date_trunc('month', "paidAt" AT TIME ZONE 'Africa/Douala'), 'YYYY-MM') AS month,
             COALESCE(SUM(amount), 0)::bigint AS amount,
             COUNT(*)::bigint AS count
      FROM payments
      WHERE status = 'SUCCEEDED' AND "paidAt" >= ${from}
      GROUP BY 1
      ORDER BY 1`;
    const byMonth = new Map(rows.map((row) => [row.month, row]));

    const result: { month: string; amount: number; count: number }[] = [];
    for (let i = 0; i < span; i += 1) {
      const key = monthKeyDouala(startOfMonthDouala(now, i - (span - 1)));
      const row = byMonth.get(key);
      result.push({ month: key, amount: Number(row?.amount ?? 0), count: Number(row?.count ?? 0) });
    }
    return result;
  }

  private async revenueBetween(from: Date, to: Date) {
    const sum = await this.prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCEEDED, paidAt: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    return sum._sum.amount ?? 0;
  }

  // ----------------------------------------------------------
  //  Clients
  // ----------------------------------------------------------

  async listClients(query: { search?: string; segment?: ClientSegment; page?: number; pageSize?: number }) {
    const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const where = this.clientWhere(query.segment ?? 'all', query.search);

    const [total, organizations] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.clientInclude(),
      }),
    ]);

    return { total, page, pageSize, items: organizations.map((org) => this.toClientRow(org)) };
  }

  async clientDetail(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      include: {
        ...this.clientInclude(),
        memberships: {
          where: { deletedAt: null },
          include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, lastLoginAt: true } } },
        },
        entities: {
          where: { deletedAt: null },
          select: { id: true, legalName: true, niu: true, city: true, isActive: true },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 50 },
        paymentRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!org) throw new NotFoundException('Client introuvable');

    return {
      ...this.toClientRow(org),
      members: org.memberships.map((m) => ({
        role: m.role,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        phone: m.user.phone,
        lastLoginAt: m.user.lastLoginAt,
      })),
      entities: org.entities,
      payments: org.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        amount: p.amount,
        txRef: p.txRef,
        providerTxId: p.providerTxId,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        failureReason: p.failureReason,
        note: (p.providerRaw as { reason?: string } | null)?.reason ?? null,
      })),
      paymentRequests: org.paymentRequests.map((r) => ({
        id: r.id,
        plan: r.plan,
        planLabel: PLANS[r.plan].label,
        amount: r.amount,
        status: r.status,
        kind: r.kind,
        transactionRef: r.transactionRef,
        createdAt: r.createdAt,
      })),
      availablePlans: Object.values(PLANS)
        .filter((plan) => plan.audience === org.type)
        .map((plan) => ({ code: plan.code, label: plan.label, priceMonthly: plan.priceMonthly })),
    };
  }

  // ----------------------------------------------------------
  //  Gestes commerciaux
  // ----------------------------------------------------------

  /**
   * Prolonge l'abonnement (geste commercial ou paiement reçu hors
   * ligne). Un montant encaissé est enregistré comme paiement.
   */
  async extend(
    organizationId: string,
    admin: { id: string; email: string },
    input: { months?: number; days?: number; amount?: number; reason: string },
  ) {
    const months = Math.trunc(input.months ?? 0);
    const days = Math.trunc(input.days ?? 0);
    if (months <= 0 && days <= 0) throw new BadRequestException('Indiquez une durée (mois ou jours).');

    const subscription = await this.requireSubscription(organizationId);
    const now = new Date();
    const start = subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    end.setDate(end.getDate() + days);

    const paid = !!input.amount && input.amount > 0;
    // Geste commercial sur un essai : l'essai continue. Paiement reçu :
    // le client devient abonné payant.
    const trial = subscription.status === SubscriptionStatus.TRIALING && !paid;
    const wasTrial = subscription.status === SubscriptionStatus.TRIALING;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodEnd: end,
          // Un essai prolongé reste un essai ; sinon l'accès est rétabli.
          status: trial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
          ...(trial && { trialEndsAt: end }),
          ...(!trial && (subscription.currentPeriodEnd <= now || wasTrial) && { currentPeriodStart: now }),
          ...(paid && { provider: PaymentProvider.MANUAL }),
          gracePeriodEnd: null,
          cancelledAt: null,
          cancelAtPeriodEnd: false,
          remindersSent: 0,
          lastReminderAt: null,
        },
      });
      if (input.amount && input.amount > 0) {
        await tx.payment.create({
          data: {
            organizationId,
            subscriptionId: subscription.id,
            provider: PaymentProvider.MANUAL,
            status: PaymentStatus.SUCCEEDED,
            amount: Math.round(input.amount) * 100,
            currency: 'XAF',
            txRef: `ADM-${organizationId.slice(0, 8)}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
            providerRaw: { source: 'admin', reason: input.reason, by: admin.email, planCode: subscription.plan },
            paidAt: now,
            periodStart: start,
            periodEnd: end,
          },
        });
      }
      return result;
    });

    await this.audit.log({ organizationId, userId: admin.id }, AuditAction.UPDATE, 'Subscription', subscription.id, {
      before: { currentPeriodEnd: subscription.currentPeriodEnd, status: subscription.status },
      after: { currentPeriodEnd: end, status: updated.status, reason: input.reason, amount: input.amount ?? 0 },
    });
    return updated;
  }

  /** Change de formule sans toucher à la période en cours. */
  async changePlan(organizationId: string, admin: { id: string }, planCode: PlanCode) {
    const { plan } = await this.subscriptions.assertPlanAllowed(organizationId, planCode);
    const subscription = await this.requireSubscription(organizationId);
    if (subscription.stripeSubscriptionId && subscription.status !== SubscriptionStatus.CANCELLED) {
      throw new BadRequestException(
        'Ce client paie par carte (Stripe) : le changement de formule doit passer par Stripe.',
      );
    }

    const free = plan.priceMonthly === 0;
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 10);

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: planCode,
        maxEntities: plan.maxEntities,
        maxUsers: plan.maxUsers,
        priceAmount: plan.priceMonthly,
        ...(free && {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: farFuture,
          gracePeriodEnd: null,
          provider: null,
        }),
      },
    });
    await this.audit.log({ organizationId, userId: admin.id }, AuditAction.UPDATE, 'Subscription', subscription.id, {
      before: { plan: subscription.plan },
      after: { plan: planCode },
    });
    return updated;
  }

  async suspend(organizationId: string, admin: { id: string }, reason: string) {
    const subscription = await this.requireSubscription(organizationId);
    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      throw new BadRequestException('Ce compte est déjà suspendu.');
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.SUSPENDED },
    });
    await this.audit.log({ organizationId, userId: admin.id }, AuditAction.UPDATE, 'Subscription', subscription.id, {
      before: { status: subscription.status },
      after: { status: SubscriptionStatus.SUSPENDED, reason },
    });
    return updated;
  }

  async reactivate(organizationId: string, admin: { id: string }) {
    const subscription = await this.requireSubscription(organizationId);
    if (subscription.status !== SubscriptionStatus.SUSPENDED && subscription.status !== SubscriptionStatus.PAST_DUE) {
      throw new BadRequestException('Ce compte n’est pas suspendu.');
    }
    if (subscription.currentPeriodEnd <= new Date()) {
      throw new BadRequestException(
        'La période payée est terminée : prolongez l’abonnement (le compte sera réactivé du même coup).',
      );
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: subscription.trialEndsAt && subscription.trialEndsAt >= subscription.currentPeriodEnd
          ? SubscriptionStatus.TRIALING
          : SubscriptionStatus.ACTIVE,
        gracePeriodEnd: null,
      },
    });
    await this.audit.log({ organizationId, userId: admin.id }, AuditAction.UPDATE, 'Subscription', subscription.id, {
      before: { status: subscription.status },
      after: { status: updated.status },
    });
    return updated;
  }

  // ----------------------------------------------------------
  //  Exports (CSV lisible par Excel)
  // ----------------------------------------------------------

  async exportClientsCsv() {
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: this.clientInclude(),
    });
    const rows = organizations.map((org) => this.toClientRow(org));
    return toCsv(
      ['Client', 'Type', 'Contact', 'E-mail', 'Téléphone', 'Formule', 'Statut', 'Échéance', 'Prix mensuel (FCFA)', 'Dossiers', 'Inscrit le', 'Dernier paiement'],
      rows.map((row) => [
        row.name,
        row.type === 'CABINET' ? 'Cabinet' : 'Entreprise',
        row.owner?.name ?? '',
        row.email,
        row.phone,
        row.subscription?.planLabel ?? '',
        row.subscription ? STATUS_LABEL[row.subscription.status] : 'Sans abonnement',
        row.subscription ? isoDate(row.subscription.currentPeriodEnd) : '',
        row.subscription ? String(Math.round(row.subscription.priceAmount / 100)) : '',
        String(row.entityCount),
        isoDate(row.createdAt),
        row.lastPaymentAt ? isoDate(row.lastPaymentAt) : '',
      ]),
    );
  }

  async exportPaymentsCsv(from?: Date, to?: Date) {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCEEDED,
        ...(from || to ? { paidAt: { ...(from && { gte: from }), ...(to && { lt: to }) } } : {}),
      },
      orderBy: { paidAt: 'asc' },
      include: { organization: { select: { name: true, billingEmail: true } } },
    });
    return toCsv(
      ['Date', 'Client', 'E-mail', 'Montant (FCFA)', 'Moyen', 'Référence', 'Référence opérateur', 'Formule', 'Motif'],
      payments.map((p) => {
        const raw = (p.providerRaw ?? {}) as { planCode?: PlanCode; reason?: string };
        return [
          p.paidAt ? isoDate(p.paidAt) : '',
          p.organization.name,
          p.organization.billingEmail,
          String(Math.round(p.amount / 100)),
          PROVIDER_LABEL[p.provider],
          p.txRef,
          p.providerTxId ?? '',
          raw.planCode ? PLANS[raw.planCode]?.label ?? raw.planCode : '',
          raw.reason ?? '',
        ];
      }),
    );
  }

  // ----------------------------------------------------------
  //  E-mails
  // ----------------------------------------------------------

  /** Destinataires d'un envoi : un client, ou un segment. */
  async recipients(target: { organizationId?: string; segment?: ClientSegment }) {
    const where = target.organizationId
      ? { id: target.organizationId, deletedAt: null }
      : this.clientWhere(target.segment ?? 'all');
    const organizations = await this.prisma.organization.findMany({
      where,
      take: MAX_BROADCAST + 1,
      orderBy: { createdAt: 'asc' },
      include: { memberships: { where: { role: 'OWNER', deletedAt: null }, include: { user: { select: { email: true } } } } },
    });
    const list = organizations
      .map((org) => ({ organizationId: org.id, name: org.name, email: org.billingEmail || org.memberships[0]?.user.email || '' }))
      .filter((r) => r.email);
    return { recipients: list.slice(0, MAX_BROADCAST), truncated: list.length > MAX_BROADCAST };
  }

  async sendEmail(target: { organizationId?: string; segment?: ClientSegment }, subject: string, message: string) {
    const { recipients, truncated } = await this.recipients(target);
    if (!recipients.length) throw new BadRequestException('Aucun destinataire pour cet envoi.');
    if (truncated) {
      throw new BadRequestException(
        `Plus de ${MAX_BROADCAST} destinataires : choisissez un groupe plus restreint (limite d’envoi Gmail).`,
      );
    }
    if (!this.notifier.emailConfigured) throw new BadRequestException('L’envoi d’e-mails n’est pas configuré.');

    let sent = 0;
    const failed: string[] = [];
    // Un e-mail par client : personne ne voit l'adresse des autres.
    for (const recipient of recipients) {
      const ok = await this.notifier.sendEmail(recipient.email, subject, message);
      if (ok) sent += 1;
      else failed.push(recipient.email);
    }
    return { sent, failed, total: recipients.length, lastError: failed.length ? this.notifier.lastEmailError : null };
  }

  /**
   * Relance les clients en essai qui ne se sont pas encore abonnés.
   * Un client déjà relancé dans les dernières 24 h n'est pas relancé.
   */
  async remindTrials(organizationIds?: string[], now = new Date()) {
    const trials = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        organization: {
          deletedAt: null,
          paymentRequests: { none: { status: { in: [PaymentRequestStatus.AWAITING_LINK, PaymentRequestStatus.LINK_SENT, PaymentRequestStatus.REFERENCE_SUBMITTED] } } },
        },
        ...(organizationIds?.length && { organizationId: { in: organizationIds } }),
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(now.getTime() - DAY) } }],
      },
      include: { organization: true },
      take: MAX_BROADCAST,
    });

    const app = (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    let sent = 0;
    for (const trial of trials) {
      const daysLeft = Math.ceil((trial.currentPeriodEnd.getTime() - now.getTime()) / DAY);
      const ok = await this.notifier.sendEmail(
        await this.subscriptions.clientEmail(trial.organizationId, trial.organization.billingEmail),
        `${BRAND.name} — votre essai ${daysLeft > 0 ? `se termine dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}` : 'est terminé'}`,
        [
          'Bonjour,',
          '',
          daysLeft > 0
            ? `Votre essai gratuit de ${BRAND.name} se termine le ${frDate(trial.currentPeriodEnd)}.`
            : `Votre essai gratuit de ${BRAND.name} est terminé depuis le ${frDate(trial.currentPeriodEnd)}.`,
          'Pour continuer à facturer et préparer vos déclarations de TVA sans interruption, choisissez votre formule :',
          `${app}/abonnement`,
          '',
          'Une question ? Répondez simplement à cet e-mail.',
        ].join('\n'),
      );
      if (ok) {
        sent += 1;
        await this.prisma.subscription.update({ where: { id: trial.id }, data: { lastReminderAt: now } });
      }
    }
    return { sent, eligible: trials.length, lastError: sent < trials.length ? this.notifier.lastEmailError : null };
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private async requireSubscription(organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, organization: { deletedAt: null } },
    });
    if (!subscription) throw new NotFoundException('Ce client n’a pas d’abonnement.');
    return subscription;
  }

  private clientWhere(segment: ClientSegment, search?: string): Prisma.OrganizationWhereInput {
    const now = new Date();
    const bySegment: Record<ClientSegment, Prisma.SubscriptionWhereInput | null> = {
      all: null,
      trialing: { status: SubscriptionStatus.TRIALING },
      active: { status: SubscriptionStatus.ACTIVE, priceAmount: { gt: 0 } },
      expiring: {
        status: SubscriptionStatus.ACTIVE,
        priceAmount: { gt: 0 },
        currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 7 * DAY) },
      },
      past_due: { status: SubscriptionStatus.PAST_DUE },
      suspended: { status: SubscriptionStatus.SUSPENDED },
      cancelled: { status: SubscriptionStatus.CANCELLED },
      free: { status: SubscriptionStatus.ACTIVE, priceAmount: 0 },
    };
    const term = search?.trim();
    return {
      deletedAt: null,
      ...(bySegment[segment] && { subscription: bySegment[segment]! }),
      ...(term && {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { billingEmail: { contains: term, mode: 'insensitive' } },
          { billingPhone: { contains: term } },
          { memberships: { some: { user: { email: { contains: term, mode: 'insensitive' } } } } },
          { entities: { some: { OR: [{ niu: { contains: term, mode: 'insensitive' } }, { legalName: { contains: term, mode: 'insensitive' } }] } } },
        ],
      }),
    };
  }

  private clientInclude() {
    return {
      subscription: true,
      memberships: {
        where: { role: 'OWNER' as const, deletedAt: null },
        take: 1,
        include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      },
      payments: {
        where: { status: PaymentStatus.SUCCEEDED },
        orderBy: { paidAt: 'desc' as const },
        take: 1,
        select: { status: true, paidAt: true },
      },
      _count: { select: { entities: { where: { deletedAt: null } } } },
    } satisfies Prisma.OrganizationInclude;
  }

  private toClientRow(
    org: Omit<Prisma.OrganizationGetPayload<{ include: ReturnType<AdminDashboardService['clientInclude']> }>, 'payments'> & {
      payments: { status: PaymentStatus; paidAt: Date | null }[];
    },
  ) {
    const owner = org.memberships[0]?.user;
    const sub = org.subscription;
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      email: org.billingEmail || owner?.email || '',
      phone: org.billingPhone || owner?.phone || '',
      createdAt: org.createdAt,
      entityCount: org._count.entities,
      owner: owner ? { name: `${owner.firstName} ${owner.lastName}`, email: owner.email } : null,
      subscription: sub
        ? {
            plan: sub.plan,
            planLabel: PLANS[sub.plan].label,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            gracePeriodEnd: sub.gracePeriodEnd,
            priceAmount: sub.priceAmount,
            provider: sub.provider,
            maxEntities: sub.maxEntities === UNLIMITED ? null : sub.maxEntities,
            lastReminderAt: sub.lastReminderAt,
          }
        : null,
      lastPaymentAt: org.payments.find((p) => p.status === PaymentStatus.SUCCEEDED)?.paidAt ?? null,
    };
  }
}

// ------------------------------------------------------------

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Essai',
  ACTIVE: 'Actif',
  PAST_DUE: 'Impayé',
  SUSPENDED: 'Suspendu',
  CANCELLED: 'Résilié',
};

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  NEERO: 'Neero',
  NOTCHPAY: 'Notch Pay',
  STRIPE: 'Carte (Stripe)',
  FLUTTERWAVE: 'Flutterwave',
  MANUAL: 'Manuel',
};

/** CSV pour Excel en français : séparateur « ; » et BOM UTF-8 (accents). */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (value: string) => {
    // Neutralise les formules (=, +, -, @) : injection de formules Excel.
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

/**
 * Premier jour du mois à minuit, heure de Douala (UTC+1, sans heure
 * d'été), décalé de `offset` mois.
 */
export function startOfMonthDouala(date: Date, offset = 0): Date {
  const local = new Date(date.getTime() + 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1) - 3_600_000);
}

export function monthKeyDouala(date: Date): string {
  const local = new Date(date.getTime() + 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoDate(date: Date): string {
  return new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);
}

function frDate(value: Date): string {
  return value.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' });
}
