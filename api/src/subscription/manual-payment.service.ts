import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PaymentProvider,
  PaymentRequestKind,
  PaymentRequestStatus,
  PaymentStatus,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BRAND } from '../config/brand';
import { PLANS } from './plans';
import { SubscriptionService } from './subscription.service';
import { NotifierService, whatsappLink } from './notifier.service';

const OPEN: PaymentRequestStatus[] = [
  PaymentRequestStatus.AWAITING_LINK,
  PaymentRequestStatus.LINK_SENT,
  PaymentRequestStatus.REFERENCE_SUBMITTED,
];

const DAY = 86_400_000;
const PLAN_LINK_PREFIX = 'neero.link.';

/**
 * Durée de validité d'un lien Neero préparé (en jours). Un lien plus
 * ancien n'est plus envoyé automatiquement ; l'administratrice est
 * prévenue un jour avant pour le renouveler.
 */
export function planLinkValidityDays(): number {
  const days = Number(process.env.PLAN_LINK_VALIDITY_DAYS);
  return Number.isInteger(days) && days >= 2 ? days : 10;
}

/** Coordonnées saisies dans le formulaire de souscription. */
export interface SubscriptionContact {
  name: string;
  email: string;
  phone: string;
  project?: string;
}

/** Délai annoncé au client pour recevoir son lien. */
export const LINK_DELAY_MESSAGE =
  'Votre lien de paiement vous sera envoyé sous quelques heures.';

/**
 * ============================================================
 *  PAIEMENT MANUEL PAR LIEN NEERO
 * ============================================================
 *
 *  1. Le client choisit une formule : demande « lien à envoyer »,
 *     l'administrateur est prévenu (Telegram).
 *  2. L'administrateur génère le lien dans Neero et le colle dans
 *     l'écran admin : le client le reçoit (e-mail, WhatsApp, page
 *     Abonnement).
 *  3. Le client paie puis saisit la référence de transaction :
 *     l'administrateur est prévenu.
 *  4. L'administrateur vérifie dans Neero et valide : le mois est
 *     ouvert. Une référence ne peut servir qu'une fois.
 *
 *  Aux échéances, les relances créent la demande de
 *  renouvellement (voir createRenewalRequests).
 * ============================================================
 */
@Injectable()
export class ManualPaymentService {
  private readonly logger = new Logger(ManualPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly notifier: NotifierService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------
  //  Côté client
  // ----------------------------------------------------------

  async request(
    organizationId: string,
    planCode: PlanCode,
    user: { id: string },
    contact?: SubscriptionContact,
  ) {
    const { organization, plan } = await this.subscriptions.assertPlanAllowed(
      organizationId,
      planCode,
    );
    if (plan.priceMonthly === 0) {
      throw new BadRequestException('Cette formule est gratuite.');
    }

    const planLink = await this.planLink(planCode);
    const contactData = contact
      ? {
          contactName: contact.name,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          projectName: contact.project || null,
        }
      : {};
    const open = await this.findOpen(organizationId);
    if (open) {
      if (open.plan === planCode) {
        // Même formule : seules les coordonnées sont mises à jour.
        if (!contact) return this.requestResponse(open);
        return this.requestResponse(
          await this.prisma.paymentRequest.update({ where: { id: open.id }, data: contactData }),
        );
      }
      // Une référence saisie signifie un paiement peut-être déjà fait :
      // on ne change plus la formule sous les pieds de l'administrateur.
      if (open.status === PaymentRequestStatus.REFERENCE_SUBMITTED) {
        throw new ConflictException(
          `Votre paiement (${PLANS[open.plan].label}) est en cours de vérification. ` +
            'Vous pourrez changer de formule ensuite.',
        );
      }
      // Changement de formule : le lien de l'ancienne ne vaut plus.
      const updated = await this.prisma.paymentRequest.update({
        where: { id: open.id },
        data: {
          plan: planCode,
          amount: plan.priceMonthly,
          status: PaymentRequestStatus.AWAITING_LINK,
          paymentLink: null,
          linkSentAt: null,
          rejectionReason: null,
          ...contactData,
        },
        include: { organization: true },
      });
      if (planLink) await this.deliver(updated, planLink);
      await this.notifier.notifyAdmin('Demande modifiée', [
        `Projet : ${organization.name}`,
        `Nouvelle offre : ${plan.label} — ${money(plan.priceMonthly)}`,
        planLink ? 'Lien Neero envoyé automatiquement au client.' : `Lien à envoyer : ${adminUrl()}`,
      ]);
      return this.requestResponse(await this.reload(open.id));
    }

    let created;
    try {
      created = await this.prisma.paymentRequest.create({
        data: {
          organizationId,
          requestedById: user.id,
          plan: planCode,
          amount: plan.priceMonthly,
          kind: PaymentRequestKind.NEW,
          ...contactData,
        },
        include: { organization: true },
      });
    } catch (error) {
      // Double clic : l'index unique n'autorise qu'une demande en cours.
      if (isUniqueViolation(error)) {
        const existing = await this.findOpen(organizationId);
        if (existing) return this.requestResponse(existing);
      }
      throw error;
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    // Lien préparé pour cette formule : envoyé tout de suite, même la
    // nuit. Sinon, l'administrateur le génère et le colle à la main.
    if (planLink) {
      await this.deliver(created, planLink);
    } else {
      await this.notifier.sendEmail(
        await this.requestEmail(created),
        `${BRAND.name} — demande d’abonnement reçue`,
        [
          'Bonjour,',
          '',
          `Nous avons bien reçu votre demande d’abonnement à la formule ${plan.label} (${money(plan.priceMonthly)} par mois).`,
          LINK_DELAY_MESSAGE,
          '',
          'Vous pourrez aussi le retrouver sur la page Abonnement de votre espace.',
        ].join('\n'),
      );
    }

    const expiredLink = !planLink && (await this.hasPlanLink(planCode));
    await this.notifier.notifyAdmin('Nouvelle demande d’abonnement', [
      `Client : ${contact?.name ?? (requester ? `${requester.firstName} ${requester.lastName}` : '—')}`,
      `Projet : ${contact?.project || organization.name} (${organization.type === 'CABINET' ? 'cabinet' : 'entreprise'})`,
      `Offre : ${plan.label}`,
      `Montant : ${money(plan.priceMonthly)}`,
      `Téléphone : ${contact?.phone || organization.billingPhone || requester?.phone || '—'}`,
      `E-mail : ${contact?.email || organization.billingEmail || requester?.email || '—'}`,
      planLink
        ? `Lien Neero envoyé automatiquement. Vérifiez le paiement puis validez : ${adminUrl()}`
        : expiredLink
          ? `⚠️ Le lien Neero de cette formule a expiré : renouvelez-le, puis envoyez-le : ${adminUrl()}`
          : `Générer le lien Neero puis le coller ici : ${adminUrl()}`,
    ]);

    return this.requestResponse(await this.reload(created.id));
  }

  async submitReference(organizationId: string, rawRef: string) {
    const transactionRef = normalizeRef(rawRef);
    const open = await this.findOpen(organizationId);
    if (!open) throw new NotFoundException('Aucune demande de paiement en cours.');
    if (open.status === PaymentRequestStatus.AWAITING_LINK) {
      throw new BadRequestException(
        'Votre lien de paiement n’a pas encore été envoyé : attendez-le avant de payer.',
      );
    }

    let updated;
    try {
      const result = await this.prisma.paymentRequest.updateMany({
        where: {
          id: open.id,
          status: { in: [PaymentRequestStatus.LINK_SENT, PaymentRequestStatus.REFERENCE_SUBMITTED] },
        },
        data: {
          transactionRef,
          status: PaymentRequestStatus.REFERENCE_SUBMITTED,
          referenceSubmittedAt: new Date(),
          rejectionReason: null,
        },
      });
      if (result.count === 0) throw new ConflictException('Cette demande vient de changer, rechargez la page.');
      updated = await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: open.id } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Cette référence de transaction a déjà été utilisée.');
      }
      throw error;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    await this.notifier.notifyAdmin('Paiement à vérifier', [
      `Projet : ${organization?.name ?? organizationId}`,
      `Offre : ${PLANS[updated.plan].label} — ${money(updated.amount)}`,
      `Référence : ${transactionRef}`,
      `Vérifier dans Neero puis valider : ${adminUrl()}`,
    ]);

    return this.requestResponse(updated);
  }

  async cancelByClient(organizationId: string) {
    const open = await this.findOpen(organizationId);
    if (!open) throw new NotFoundException('Aucune demande de paiement en cours.');
    // Une référence saisie signifie que le client a peut-être déjà
    // payé : seul l'administrateur peut alors clore la demande.
    if (open.status === PaymentRequestStatus.REFERENCE_SUBMITTED) {
      throw new BadRequestException(
        'Votre paiement est en cours de vérification : la demande ne peut plus être annulée.',
      );
    }
    await this.prisma.paymentRequest.update({
      where: { id: open.id },
      data: { status: PaymentRequestStatus.CANCELLED, decidedAt: new Date() },
    });
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    await this.notifier.notifyAdmin('Demande annulée par le client', [
      `Projet : ${organization?.name ?? organizationId}`,
      `Offre : ${PLANS[open.plan].label}`,
    ]);
    return { cancelled: true };
  }

  // ----------------------------------------------------------
  //  Côté administrateur
  // ----------------------------------------------------------

  async list(scope: 'open' | 'closed') {
    const requests = await this.prisma.paymentRequest.findMany({
      where: {
        status: scope === 'open' ? { in: OPEN } : { notIn: OPEN },
      },
      orderBy: scope === 'open' ? { createdAt: 'asc' } : { updatedAt: 'desc' },
      take: scope === 'open' ? 200 : 50,
      include: {
        organization: {
          select: {
            name: true,
            type: true,
            billingEmail: true,
            billingPhone: true,
            subscription: { select: { status: true, plan: true, currentPeriodEnd: true } },
          },
        },
      },
    });

    const userIds = [...new Set(requests.map((r) => r.requestedById).filter(Boolean))] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return requests.map((request) => {
      const requester = request.requestedById ? byId.get(request.requestedById) : undefined;
      const phone = request.contactPhone || request.organization.billingPhone || requester?.phone;
      return {
        ...request,
        planLabel: PLANS[request.plan].label,
        requester: requester
          ? { name: `${requester.firstName} ${requester.lastName}`, email: requester.email }
          : null,
        whatsappUrl:
          request.paymentLink && request.status === PaymentRequestStatus.LINK_SENT
            ? whatsappLink(phone, this.linkMessage(request.organization.name, request.plan, request.amount, request.paymentLink))
            : null,
      };
    });
  }

  /** Enregistre le lien Neero et l'envoie au client. */
  async sendLink(id: string, paymentLink: string) {
    const request = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!request) throw new NotFoundException('Demande introuvable');
    if (
      request.status !== PaymentRequestStatus.AWAITING_LINK &&
      request.status !== PaymentRequestStatus.LINK_SENT
    ) {
      throw new BadRequestException('Le lien ne peut plus être modifié pour cette demande.');
    }

    return this.deliver(request, paymentLink);
  }

  // ----------------------------------------------------------
  //  Liens préparés par formule
  // ----------------------------------------------------------

  /** Formules payantes et lien Neero préparé pour chacune. */
  async planLinks() {
    const settings = await this.prisma.platformSetting.findMany({
      where: { key: { startsWith: PLAN_LINK_PREFIX } },
    });
    const byPlan = new Map(settings.map((s) => [s.key.slice(PLAN_LINK_PREFIX.length), s]));
    const validity = planLinkValidityDays();
    const now = Date.now();
    return Object.values(PLANS)
      .filter((plan) => plan.priceMonthly > 0)
      .map((plan) => {
        const setting = byPlan.get(plan.code);
        const expiresAt = setting ? new Date(setting.updatedAt.getTime() + validity * DAY) : null;
        return {
          plan: plan.code,
          label: plan.label,
          audience: plan.audience,
          amount: plan.priceMonthly,
          paymentLink: setting?.value ?? null,
          setAt: setting?.updatedAt ?? null,
          expiresAt,
          // « renew » : à renouveler (dernier jour) ; « expired » : n'est plus envoyé.
          state: !expiresAt
            ? 'missing'
            : expiresAt.getTime() <= now
              ? 'expired'
              : expiresAt.getTime() - now <= DAY
                ? 'renew'
                : 'ok',
        };
      });
  }

  async setPlanLink(planCode: PlanCode, paymentLink: string | null) {
    const plan = PLANS[planCode];
    if (!plan || plan.priceMonthly === 0) throw new BadRequestException('Formule inconnue ou gratuite.');
    const key = `${PLAN_LINK_PREFIX}${planCode}`;
    if (paymentLink) {
      await this.prisma.platformSetting.upsert({
        where: { key },
        create: { key, value: paymentLink },
        update: { value: paymentLink },
      });
    } else {
      await this.prisma.platformSetting.deleteMany({ where: { key } });
    }
    return this.planLinks();
  }

  /** Lien préparé encore valable pour cette formule, sinon null. */
  private async planLink(planCode: PlanCode): Promise<string | null> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: `${PLAN_LINK_PREFIX}${planCode}` },
    });
    if (!setting) return null;
    const expired = setting.updatedAt.getTime() + planLinkValidityDays() * DAY <= Date.now();
    return expired ? null : setting.value;
  }

  private async hasPlanLink(planCode: PlanCode) {
    return !!(await this.prisma.platformSetting.findUnique({ where: { key: `${PLAN_LINK_PREFIX}${planCode}` } }));
  }

  /**
   * Rappel quotidien : liens Neero qui expirent sous 24 h (à
   * renouveler aujourd'hui) ou déjà expirés.
   */
  async remindPlanLinksRenewal() {
    const links = await this.planLinks();
    const due = links.filter((l) => l.state === 'renew' || l.state === 'expired');
    if (!due.length) return 0;
    await this.notifier.notifyAdmin('Liens Neero à renouveler', [
      ...due.map((l) =>
        l.state === 'expired'
          ? `• ${l.label} (${money(l.amount)}) : expiré, n’est plus envoyé aux clients`
          : `• ${l.label} (${money(l.amount)}) : expire le ${date(l.expiresAt!)}`,
      ),
      `Créez les nouveaux liens dans Neero puis collez-les ici : ${adminUrl()}`,
    ]);
    return due.length;
  }

  /** Enregistre le lien sur la demande et l'envoie au client. */
  private async deliver(
    request: {
      id: string;
      organizationId: string;
      plan: PlanCode;
      amount: number;
      requestedById: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      organization: { name: string; billingEmail: string; billingPhone: string };
    },
    paymentLink: string,
  ) {
    await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: { paymentLink, linkSentAt: new Date(), status: PaymentRequestStatus.LINK_SENT },
    });

    const message = this.linkMessage(request.organization.name, request.plan, request.amount, paymentLink);
    const recipient = await this.requestEmail(request);
    const emailed = await this.notifier.sendEmail(
      recipient,
      `${BRAND.name} — votre lien de paiement`,
      message,
    );
    const phone =
      request.contactPhone || request.organization.billingPhone || (await this.requesterPhone(request.requestedById));

    return {
      emailed,
      email: recipient || null,
      whatsappUrl: whatsappLink(phone, message),
    };
  }

  /** Paiement vérifié dans Neero : ouvre le mois payé. */
  async validate(id: string, admin: { id: string; email: string }, rawRef?: string) {
    const request = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!request) throw new NotFoundException('Demande introuvable');
    if (
      request.status !== PaymentRequestStatus.LINK_SENT &&
      request.status !== PaymentRequestStatus.REFERENCE_SUBMITTED
    ) {
      throw new BadRequestException('Cette demande ne peut pas être validée.');
    }
    const transactionRef = rawRef ? normalizeRef(rawRef) : request.transactionRef;
    if (!transactionRef) {
      throw new BadRequestException('Indiquez la référence de la transaction Neero.');
    }

    let subscription;
    try {
      subscription = await this.prisma.$transaction(async (tx) => {
        // Verrou : deux clics sur « Valider » n'ouvrent qu'un mois.
        const claimed = await tx.paymentRequest.updateMany({
          where: { id, status: { in: [PaymentRequestStatus.LINK_SENT, PaymentRequestStatus.REFERENCE_SUBMITTED] } },
          data: {
            status: PaymentRequestStatus.VALIDATED,
            transactionRef,
            decidedAt: new Date(),
            rejectionReason: null,
          },
        });
        if (claimed.count === 0) throw new ConflictException('Cette demande a déjà été traitée.');

        const payment = await tx.payment.create({
          data: {
            organizationId: request.organizationId,
            provider: PaymentProvider.MANUAL,
            status: PaymentStatus.SUCCEEDED,
            amount: request.amount,
            currency: 'XAF',
            txRef: `MAN-${request.id}`,
            providerTxId: `neero:${transactionRef}`,
            providerRaw: {
              planCode: request.plan,
              source: 'neero',
              requestId: request.id,
              validatedBy: admin.email,
            },
            paidAt: new Date(),
          },
        });

        const activated = await this.subscriptions.activatePaidPeriod(
          tx,
          request.organizationId,
          request.plan,
          PaymentProvider.MANUAL,
        );
        await tx.payment.update({ where: { id: payment.id }, data: { subscriptionId: activated.id } });
        await tx.paymentRequest.update({ where: { id }, data: { paymentId: payment.id } });
        return activated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Cette référence de transaction a déjà été utilisée.');
      }
      throw error;
    }

    await this.audit.log(
      { organizationId: request.organizationId, userId: admin.id },
      AuditAction.VALIDATE,
      'PaymentRequest',
      request.id,
      { after: { plan: request.plan, amount: request.amount, transactionRef } },
    );

    const recipient = await this.requestEmail(request);
    await this.notifier.sendEmail(
      recipient,
      `${BRAND.name} — paiement confirmé`,
      [
        'Bonjour,',
        '',
        `Votre paiement (référence ${transactionRef}) est confirmé.`,
        `Votre formule ${PLANS[request.plan].label} est active jusqu’au ${date(subscription.currentPeriodEnd)}.`,
        '',
        'Merci de votre confiance.',
      ].join('\n'),
    );

    return { validated: true, subscription };
  }

  /** Référence introuvable dans Neero : le client doit la corriger. */
  async rejectReference(id: string, reason: string) {
    const request = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!request) throw new NotFoundException('Demande introuvable');
    if (request.status !== PaymentRequestStatus.REFERENCE_SUBMITTED) {
      throw new BadRequestException('Aucune référence à refuser pour cette demande.');
    }
    await this.prisma.paymentRequest.update({
      where: { id },
      data: {
        status: PaymentRequestStatus.LINK_SENT,
        transactionRef: null,
        rejectionReason: reason,
      },
    });

    const recipient = await this.requestEmail(request);
    await this.notifier.sendEmail(
      recipient,
      `${BRAND.name} — référence de paiement à vérifier`,
      [
        'Bonjour,',
        '',
        `Nous n’avons pas pu confirmer la référence ${request.transactionRef} : ${reason}`,
        'Vérifiez-la puis saisissez-la de nouveau sur la page Abonnement de votre espace.',
        request.paymentLink ? `Lien de paiement : ${request.paymentLink}` : '',
      ].join('\n'),
    );
    return { rejected: true };
  }

  async cancelByAdmin(id: string) {
    const result = await this.prisma.paymentRequest.updateMany({
      where: { id, status: { in: OPEN } },
      data: { status: PaymentRequestStatus.CANCELLED, decidedAt: new Date() },
    });
    if (result.count === 0) throw new BadRequestException('Cette demande est déjà close.');
    return { cancelled: true };
  }

  // ----------------------------------------------------------
  //  Échéances (appelé par les relances quotidiennes)
  // ----------------------------------------------------------

  /**
   * Crée la demande de renouvellement des abonnements payés qui
   * arrivent à échéance, et prévient l'administrateur.
   */
  async createRenewalRequests(now = new Date(), daysBefore = 3) {
    const limit = new Date(now.getTime() + daysBefore * 86_400_000);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        priceAmount: { gt: 0 },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { lte: limit },
        OR: [{ provider: null }, { provider: { not: PaymentProvider.STRIPE } }],
        organization: { paymentRequests: { none: { status: { in: OPEN } } } },
      },
      include: { organization: true },
    });

    const created: string[] = [];
    for (const subscription of due) {
      let renewal;
      try {
        // Coordonnées reprises de la dernière demande du client.
        const last = await this.prisma.paymentRequest.findFirst({
          where: { organizationId: subscription.organizationId, contactEmail: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { contactName: true, contactEmail: true, contactPhone: true, projectName: true },
        });
        renewal = await this.prisma.paymentRequest.create({
          data: {
            organizationId: subscription.organizationId,
            plan: subscription.plan,
            amount: PLANS[subscription.plan].priceMonthly,
            kind: PaymentRequestKind.RENEWAL,
            ...(last ?? {}),
          },
          include: { organization: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue; // créée entre-temps
        throw error;
      }
      const link = await this.planLink(subscription.plan);
      if (link) await this.deliver(renewal, link);
      created.push(
        `• ${subscription.organization.name} — ${PLANS[subscription.plan].label}, ` +
          `${money(PLANS[subscription.plan].priceMonthly)}, échéance ${date(subscription.currentPeriodEnd)}` +
          (link ? ' (lien envoyé)' : ' (lien à envoyer)'),
      );
    }

    if (created.length) {
      await this.notifier.notifyAdmin(`${created.length} abonnement(s) à renouveler`, [
        ...created,
        adminUrl(),
      ]);
    }
    return created.length;
  }

  /** Rappel quotidien à l'administrateur de ce qui l'attend. */
  async remindAdminOfPending() {
    const [awaitingLink, toVerify] = await Promise.all([
      this.prisma.paymentRequest.count({ where: { status: PaymentRequestStatus.AWAITING_LINK } }),
      this.prisma.paymentRequest.count({ where: { status: PaymentRequestStatus.REFERENCE_SUBMITTED } }),
    ]);
    if (!awaitingLink && !toVerify) return;
    await this.notifier.notifyAdmin('Paiements en attente', [
      ...(awaitingLink ? [`${awaitingLink} lien(s) de paiement à envoyer`] : []),
      ...(toVerify ? [`${toVerify} paiement(s) à vérifier`] : []),
      adminUrl(),
    ]);
  }

  /** Message de relance au client, avec son lien s'il existe. */
  async remindClient(
    subscription: { organizationId: string; plan: PlanCode; status: SubscriptionStatus; currentPeriodEnd: Date; gracePeriodEnd: Date | null; organization: { billingEmail: string } },
    stage: 'BEFORE' | 'DUE' | 'OVERDUE',
  ) {
    const open = await this.findOpen(subscription.organizationId);
    const plan = PLANS[subscription.plan];
    const trial = subscription.status === SubscriptionStatus.TRIALING;

    const intro =
      stage === 'BEFORE'
        ? trial
          ? `Votre essai gratuit se termine le ${date(subscription.currentPeriodEnd)}.`
          : `Votre formule ${plan.label} arrive à échéance le ${date(subscription.currentPeriodEnd)}.`
        : `Votre abonnement ${plan.label} n’est pas encore renouvelé.` +
          (subscription.gracePeriodEnd
            ? ` Sans paiement avant le ${date(subscription.gracePeriodEnd)}, la saisie sera bloquée (vos données resteront consultables).`
            : '');

    const action = open?.paymentLink
      ? `Payez avec ce lien : ${open.paymentLink}\nPuis saisissez la référence de transaction sur la page Abonnement.`
      : open
        ? LINK_DELAY_MESSAGE
        : 'Choisissez votre formule sur la page Abonnement de votre espace.';

    await this.notifier.sendEmail(
      await this.clientEmail(subscription.organizationId, subscription.organization.billingEmail),
      `${BRAND.name} — ${stage === 'BEFORE' ? 'échéance proche' : 'abonnement à renouveler'}`,
      ['Bonjour,', '', intro, action].join('\n'),
    );
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private reload(id: string) {
    return this.prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
  }

  private findOpen(organizationId: string) {
    return this.prisma.paymentRequest.findFirst({
      where: { organizationId, status: { in: OPEN } },
    });
  }

  private requestResponse(request: { status: PaymentRequestStatus } & Record<string, unknown>) {
    return {
      paymentUrl: null,
      paymentRequest: request,
      message:
        request.status === PaymentRequestStatus.AWAITING_LINK
          ? `Demande enregistrée. ${LINK_DELAY_MESSAGE}`
          : request.status === PaymentRequestStatus.LINK_SENT
            ? 'Votre lien de paiement est prêt ci-dessous (il vous a aussi été envoyé par e-mail).'
            : 'Votre demande de paiement est en cours.',
    };
  }

  private linkMessage(organizationName: string, planCode: PlanCode, amount: number, link: string) {
    return [
      'Bonjour,',
      '',
      `Voici votre lien de paiement pour l’abonnement ${BRAND.name} de ${organizationName} : ` +
        `formule ${PLANS[planCode].label}, ${money(amount)}.`,
      link,
      '',
      'Après le paiement, saisissez la référence de transaction sur la page Abonnement ' +
        `de votre espace (${frontendUrl()}/abonnement) : votre accès sera activé dès vérification.`,
    ].join('\n');
  }

  /** E-mail saisi dans le formulaire, sinon celui de facturation ou du propriétaire. */
  private async requestEmail(request: {
    organizationId: string;
    contactEmail?: string | null;
    organization: { billingEmail: string };
  }) {
    return request.contactEmail || this.clientEmail(request.organizationId, request.organization.billingEmail);
  }

  /** E-mail de facturation, sinon celui du propriétaire du compte. */
  private async clientEmail(organizationId: string, billingEmail?: string | null) {
    if (billingEmail) return billingEmail;
    const owner = await this.prisma.membership.findFirst({
      where: { organizationId, role: 'OWNER', deletedAt: null },
      select: { user: { select: { email: true } } },
    });
    return owner?.user.email ?? '';
  }

  private async requesterPhone(userId: string | null) {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    return user?.phone ?? null;
  }
}

/** Référence de transaction : espaces superflus retirés, majuscules. */
export function normalizeRef(input: string): string {
  const ref = input.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ._\-/#:]{3,79}$/.test(ref)) {
    throw new BadRequestException('Référence de transaction invalide.');
  }
  return ref;
}

export function money(centimes: number): string {
  return `${Math.round(centimes / 100).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
}

function date(value: Date): string {
  return value.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' });
}

function frontendUrl() {
  return (process.env.FRONTEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

function adminUrl() {
  return `${frontendUrl()}/admin/paiements`;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
