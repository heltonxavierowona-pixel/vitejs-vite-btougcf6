import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentProvider,
  PaymentRequestStatus,
  PaymentStatus,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { FlutterwaveService } from './flutterwave.service';
import { NotchPayService, normalizeCameroonPhone } from './notchpay.service';
import { NeeroProvider } from '../payments/neero/neero.provider';
import { NotifierService } from './notifier.service';
import { BRAND } from '../config/brand';
import type { PaymentVerification } from './flutterwave.service';
import { StripeBillingService } from './stripe-billing.service';
import { PLANS, UNLIMITED, plansFor } from './plans';
import { canUseSubscription, SUBSCRIPTION_BLOCKED_MESSAGE } from './access';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flutterwave: FlutterwaveService,
    private readonly stripeBilling: StripeBillingService,
    private readonly notchpay: NotchPayService,
    private readonly neero: NeeroProvider,
    private readonly notifier: NotifierService,
  ) {}

  /**
   * Mode de paiement. Par défaut « manual » : l'administrateur envoie
   * un lien de paiement Neero (voir ManualPaymentService). « online »
   * réactive les paiements en ligne (Notch Pay, Stripe, Flutterwave).
   */
  get onlinePaymentsEnabled(): boolean {
    return process.env.PAYMENT_MODE === 'online';
  }

  /** Moyens de paiement en ligne actifs sur ce serveur. */
  paymentProviders(): PaymentProvider[] {
    if (!this.onlinePaymentsEnabled) return [];
    return [
      ...(this.neero.isConfigured ? [PaymentProvider.NEERO] : []),
      ...(this.notchpay.isEnabled ? [PaymentProvider.NOTCHPAY] : []),
      ...(this.stripeBilling.isEnabled ? [PaymentProvider.STRIPE] : []),
      ...(process.env.FLUTTERWAVE_SECRET_KEY ? [PaymentProvider.FLUTTERWAVE] : []),
    ];
  }

  // ----------------------------------------------------------
  //  Consultation
  // ----------------------------------------------------------

  /** Plans proposés selon le type d'organisation. */
  async availablePlans(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');

    return {
      paymentMode: this.onlinePaymentsEnabled ? 'online' : 'manual',
      providers: this.paymentProviders(),
      plans: plansFor(organization.type).map((plan) => ({
        ...plan,
        maxEntities: plan.maxEntities === UNLIMITED ? null : plan.maxEntities,
        maxUsers: plan.maxUsers === UNLIMITED ? null : plan.maxUsers,
      })),
    };
  }

  async current(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: {
        payments: {
          where: { status: PaymentStatus.SUCCEEDED },
          orderBy: { paidAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!subscription) return null;

    const [entityCount, userCount, paymentRequest] = await Promise.all([
      this.prisma.entity.count({
        where: { organizationId, deletedAt: null, isActive: true },
      }),
      this.prisma.membership.count({
        where: { organizationId, deletedAt: null },
      }),
      this.openPaymentRequest(organizationId),
    ]);

    const daysLeft = Math.ceil(
      (subscription.currentPeriodEnd.getTime() - Date.now()) / 86_400_000,
    );

    return {
      ...subscription,
      plan: PLANS[subscription.plan],
      usage: {
        entities: entityCount,
        maxEntities:
          subscription.maxEntities === UNLIMITED ? null : subscription.maxEntities,
        users: userCount,
        maxUsers:
          subscription.maxUsers === UNLIMITED ? null : subscription.maxUsers,
      },
      daysLeft,
      needsRenewal: daysLeft <= 7,
      canWrite: canUseSubscription(subscription),
      paymentRequest: paymentRequest && {
        ...paymentRequest,
        planLabel: PLANS[paymentRequest.plan].label,
      },
    };
  }

  /** Demande de paiement manuelle en cours, s'il y en a une. */
  openPaymentRequest(organizationId: string) {
    return this.prisma.paymentRequest.findFirst({
      where: {
        organizationId,
        status: {
          in: [
            PaymentRequestStatus.AWAITING_LINK,
            PaymentRequestStatus.LINK_SENT,
            PaymentRequestStatus.REFERENCE_SUBMITTED,
          ],
        },
      },
      select: {
        id: true,
        plan: true,
        amount: true,
        kind: true,
        status: true,
        paymentLink: true,
        transactionRef: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
  }

  // ----------------------------------------------------------
  //  Souscription / renouvellement
  // ----------------------------------------------------------

  /**
   * Prépare un paiement et retourne le lien.
   *
   * L'abonnement n'est PAS activé ici : il ne l'est qu'après
   * vérification serveur du paiement.
   */
  async initiateCheckout(
    organizationId: string,
    planCode: PlanCode,
    userEmail: string,
    requestedProvider?: PaymentProvider,
  ) {
    // Sans précision : premier moyen de paiement configuré
    // (Notch Pay en priorité).
    const provider =
      requestedProvider ??
      this.paymentProviders().find((p) => p !== PaymentProvider.STRIPE) ??
      PaymentProvider.FLUTTERWAVE;
    const { organization, plan } = await this.assertPlanAllowed(organizationId, planCode);

    const current = organization.subscription;
    const paysByCard =
      current?.provider === PaymentProvider.STRIPE &&
      !!current.stripeSubscriptionId &&
      current.status !== SubscriptionStatus.CANCELLED;

    // Un abonnement par carte se renouvelle tout seul : passer au
    // gratuit ou au Mobile Money exige d'abord de le résilier, sinon
    // la carte continuerait d'être débitée.
    if (paysByCard && (plan.priceMonthly === 0 || provider !== PaymentProvider.STRIPE)) {
      throw new BadRequestException(
        'Votre abonnement est payé par carte et se renouvelle automatiquement. ' +
          'Résiliez-le d’abord, ou changez de formule en payant par carte.',
      );
    }
    if (paysByCard && current.plan === planCode && !current.cancelAtPeriodEnd) {
      throw new BadRequestException(
        'Cette formule est déjà active et se renouvelle automatiquement.',
      );
    }

    if (plan.priceMonthly === 0) {
      return this.activateFreePlan(organizationId, planCode);
    }

    if (!this.paymentProviders().includes(provider)) {
      throw new BadRequestException('Ce moyen de paiement n’est pas disponible.');
    }

    if (provider === PaymentProvider.STRIPE) {
      return this.stripeBilling.checkout(
        organization,
        planCode,
        userEmail,
        `SUB-${organizationId.slice(0, 8)}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`,
        current
          ? { stripeCustomerId: current.stripeCustomerId, subscriptionId: current.id }
          : null,
      );
    }

    if (provider === PaymentProvider.NOTCHPAY) {
      return this.checkoutNotchPay(organization, planCode, userEmail);
    }

    if (provider === PaymentProvider.NEERO) {
      return this.checkoutNeero(organization, planCode, userEmail);
    }

    const txRef = this.flutterwave.buildTxRef(organizationId);

    const payment = await this.prisma.payment.create({
      data: {
        organizationId,
        subscriptionId: organization.subscription?.id,
        provider: PaymentProvider.FLUTTERWAVE,
        amount: plan.priceMonthly,
        currency: 'XAF',
        txRef,
        status: PaymentStatus.PENDING,
        providerRaw: { planCode },
      },
    });

    const { paymentUrl } = await this.flutterwave.initPayment({
      txRef,
      amount: plan.priceMonthly,
      customerEmail: organization.billingEmail || userEmail,
      customerPhone: organization.billingPhone,
      customerName: organization.name,
      description: `${plan.label} — 1 mois`,
      redirectUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/abonnement/retour`,
    });

    return { paymentId: payment.id, txRef, paymentUrl, plan };
  }

  /** Contrôles communs à tout changement de formule. */
  async assertPlanAllowed(organizationId: string, planCode: PlanCode) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');

    const plan = PLANS[planCode];
    if (!plan) throw new BadRequestException('Plan inconnu');

    // Un cabinet ne peut pas souscrire un plan PME et inversement.
    if (plan.audience !== organization.type) {
      throw new BadRequestException(
        'Ce plan ne correspond pas à votre type de compte.',
      );
    }

    // Un déclassement ne doit pas laisser des entités orphelines.
    const entityCount = await this.prisma.entity.count({
      where: { organizationId, deletedAt: null, isActive: true },
    });
    if (plan.maxEntities !== UNLIMITED && entityCount > plan.maxEntities) {
      throw new BadRequestException(
        `Ce plan est limité à ${plan.maxEntities} dossiers, ` +
          `vous en avez ${entityCount}. Archivez-en avant de changer de plan.`,
      );
    }

    return { organization, plan };
  }

  /**
   * Confirme un paiement et active l'abonnement.
   *
   * Appelé par le webhook ET par le retour navigateur : les deux
   * chemins sont possibles, l'opération doit donc être idempotente.
   */
  async confirmPayment(
    txRef: string,
    providerTxId: string,
    organizationId?: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { txRef },
      include: { organization: true },
    });
    // Retour navigateur : le paiement doit appartenir à
    // l'organisation de l'utilisateur connecté.
    if (!payment || (organizationId && payment.organizationId !== organizationId)) {
      throw new NotFoundException('Paiement introuvable');
    }

    // Idempotence : un second appel ne double pas la période.
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return { success: true, alreadyProcessed: true, paymentId: payment.id };
    }

    // On ne fait jamais confiance au webhook seul : la transaction
    // est relue chez le prestataire du paiement.
    const isNotchPay = payment.provider === PaymentProvider.NOTCHPAY;
    const isNeero = payment.provider === PaymentProvider.NEERO;
    const verification = isNeero
      ? await this.verifyNeero(payment.providerTxId)
      : isNotchPay
        ? await this.notchpay.verifyPayment(payment.providerTxId ?? txRef)
        : await this.flutterwave.verifyPayment(providerTxId);

    // La transaction vérifiée doit être CELLE de ce paiement :
    // sinon un seul paiement réussi pourrait être rejoué pour
    // activer n'importe quel autre abonnement.
    const sameTransaction =
      verification.txRef === txRef ||
      ((isNotchPay || isNeero) &&
        !!payment.providerTxId &&
        verification.providerTxId === payment.providerTxId);

    const failure = !verification.isSuccessful
      ? verification.isFailed
        ? 'Le paiement a été refusé ou annulé.'
        : 'Paiement en attente de confirmation. Validez-le sur votre téléphone, puis réessayez.'
      : !sameTransaction
        ? 'La transaction ne correspond pas à ce paiement'
        : verification.currency !== 'XAF'
          ? 'Devise inattendue'
          : verification.amount < payment.amount
            ? 'Montant inférieur au montant attendu'
            : null;

    // La formule choisie est conservée quoi qu'il arrive : la réponse
    // du prestataire est rangée à côté, jamais à sa place.
    const planCode = (payment.providerRaw as any)?.planCode as PlanCode;
    const rawWithPlan = { planCode, provider: verification.raw } as any;

    if (failure) {
      this.logger.warn(`Paiement ${txRef} non confirmé : ${failure}`);
      // Seul un échec DÉFINITIF de CETTE transaction clôt le paiement :
      // ni une attente, ni une tentative frauduleuse ne doivent
      // bloquer le vrai paiement.
      // Neero : montant ou devise anormal sur la BONNE transaction, le
      // paiement est clos aussi pour ne pas le revérifier indéfiniment.
      const closes =
        sameTransaction && (verification.isFailed || (isNeero && verification.isSuccessful));
      if (closes) {
        const closed = await this.prisma.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status:
              verification.finalStatus === 'expired'
                ? PaymentStatus.EXPIRED
                : verification.finalStatus === 'canceled'
                  ? PaymentStatus.CANCELED
                  : PaymentStatus.FAILED,
            failureReason: failure,
            providerRaw: rawWithPlan,
          },
        });
        if (closed.count > 0 && isNeero) await this.notifyNeeroFailure(payment, failure);
      }
      return { success: false, reason: failure };
    }

    const plan = PLANS[planCode];
    if (!plan) {
      throw new BadRequestException('Plan du paiement introuvable');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Verrou : le webhook et le retour navigateur arrivent
      // souvent en même temps. Un seul des deux prolonge la période.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.SUCCEEDED } },
        data: {
          status: PaymentStatus.SUCCEEDED,
          providerTxId: verification.providerTxId,
          method: this.mapMethod(verification.method),
          paidAt: new Date(),
          providerRaw: rawWithPlan,
        },
      });
      if (claimed.count === 0) return null;

      return this.activatePaidPeriod(tx, payment.organizationId, planCode, payment.provider);
    });

    if (!result) {
      return { success: true, alreadyProcessed: true, paymentId: payment.id };
    }
    if (isNeero) await this.notifyNeeroSuccess(payment, planCode, result.currentPeriodEnd);
    return { success: true, subscription: result };
  }

  // ----------------------------------------------------------
  //  Neero
  // ----------------------------------------------------------

  /**
   * Paiement Neero : ligne « pending », demande d'encaissement et
   * session de paiement hébergée. Le montant vient toujours de la
   * formule, jamais du navigateur.
   */
  async checkoutNeero(
    organization: {
      id: string;
      name: string;
      billingEmail: string;
      billingPhone: string;
      subscription: { id: string } | null;
    },
    planCode: PlanCode,
    userEmail: string,
    options: { renewalStage?: string } = {},
  ) {
    const plan = PLANS[planCode];
    const txRef = `NRO-${organization.id.slice(0, 8)}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const period = await this.previewPeriod(organization.id, planCode);

    const payment = await this.prisma.payment.create({
      data: {
        organizationId: organization.id,
        subscriptionId: organization.subscription?.id,
        provider: PaymentProvider.NEERO,
        amount: plan.priceMonthly,
        currency: 'XAF',
        txRef,
        status: PaymentStatus.PENDING,
        providerRaw: { planCode, ...(options.renewalStage && { renewalStage: options.renewalStage }) },
        periodStart: period.start,
        periodEnd: period.end,
      },
    });

    const app = this.neero.config.appPublicUrl;
    const back = `${app}/abonnement/retour?provider=neero&ref=${encodeURIComponent(txRef)}`;
    try {
      const { transactionIntentId, paymentUrl } = await this.neero.createCheckout({
        amount: Math.round(plan.priceMonthly / 100),
        currency: 'XAF',
        customer: {
          name: organization.name,
          email: organization.billingEmail || userEmail,
          phone: normalizeCameroonPhone(organization.billingPhone),
        },
        metadata: {
          project: this.neero.config.project,
          paymentId: payment.id,
          customerId: organization.id,
          planId: planCode,
          periodEnd: period.end.toISOString(),
        },
        successUrl: back,
        failureUrl: `${back}&statut=echec`,
        cancelUrl: `${app}/abonnement?paiement=annule`,
        displayInfo: { name: BRAND.name, imageUrl: `${app}/numera-mark.png` },
      });

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerTxId: transactionIntentId, paymentUrl },
      });
      return { paymentId: payment.id, txRef, paymentUrl, plan };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erreur inconnue';
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: reason },
      });
      throw new BadGatewayException(`Paiement Neero impossible : ${reason}`);
    }
  }

  /** Statut relu chez Neero, au format commun des vérifications. */
  private async verifyNeero(transactionIntentId: string | null): Promise<PaymentVerification> {
    if (!transactionIntentId) {
      return { isSuccessful: false, amount: 0, currency: 'XAF', providerTxId: '', txRef: null, raw: null };
    }
    const trx = await this.neero.getTransactionStatus(transactionIntentId);
    const closed = trx.status === 'failed' || trx.status === 'expired' || trx.status === 'canceled';
    return {
      isSuccessful: trx.status === 'succeeded',
      isFailed: closed,
      finalStatus: closed ? (trx.status as 'failed' | 'expired' | 'canceled') : undefined,
      amount: trx.amount === null ? 0 : Math.round(trx.amount * 100),
      currency: trx.currency ?? '',
      providerTxId: trx.transactionIntentId,
      txRef: null,
      method: 'neero',
      raw: trx.raw,
    };
  }

  /** Période qu'ouvrirait ce paiement (même règle que activatePaidPeriod). */
  private async previewPeriod(organizationId: string, planCode: PlanCode) {
    const existing = await this.prisma.subscription.findUnique({ where: { organizationId } });
    const now = new Date();
    const extend =
      existing &&
      existing.plan === planCode &&
      existing.status !== SubscriptionStatus.TRIALING &&
      existing.currentPeriodEnd > now;
    const start = extend ? existing.currentPeriodEnd : now;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
  }

  private async notifyNeeroSuccess(
    payment: { organizationId: string; amount: number; txRef: string; organization: { name: string; billingEmail: string } },
    planCode: PlanCode,
    periodEnd: Date,
  ) {
    const plan = PLANS[planCode];
    await this.notifier.sendEmail(
      await this.clientEmail(payment.organizationId, payment.organization.billingEmail),
      `${BRAND.name} — paiement confirmé`,
      [
        'Bonjour,',
        '',
        `Votre paiement de ${fcfa(payment.amount)} est confirmé (référence ${payment.txRef}).`,
        `Votre formule ${plan.label} est active jusqu’au ${frDate(periodEnd)}.`,
        '',
        'Merci de votre confiance.',
      ].join('\n'),
    );
    await this.notifier.notifyAdmin('Paiement reçu (Neero)', [
      `Projet : ${payment.organization.name}`,
      `Offre : ${plan.label} — ${fcfa(payment.amount)}`,
      `Valable jusqu’au ${frDate(periodEnd)}`,
    ]);
  }

  private async notifyNeeroFailure(
    payment: { organizationId: string; amount: number; organization: { name: string; billingEmail: string } },
    reason: string,
  ) {
    const app = this.neero.config.appPublicUrl;
    await this.notifier.sendEmail(
      await this.clientEmail(payment.organizationId, payment.organization.billingEmail),
      `${BRAND.name} — paiement non abouti`,
      [
        'Bonjour,',
        '',
        `Votre paiement de ${fcfa(payment.amount)} n’a pas abouti : ${reason}`,
        `Vous pouvez réessayer depuis la page Abonnement : ${app}/abonnement`,
      ].join('\n'),
    );

    // L'administratrice n'est prévenue qu'en cas d'échecs répétés.
    const recentFailures = await this.prisma.payment.count({
      where: {
        organizationId: payment.organizationId,
        provider: PaymentProvider.NEERO,
        status: { in: [PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.CANCELED] },
        updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    });
    if (recentFailures >= 2) {
      await this.notifier.notifyAdmin('Échecs de paiement répétés (Neero)', [
        `Projet : ${payment.organization.name}`,
        `${recentFailures} paiements non aboutis en 7 jours`,
        `Dernier motif : ${reason}`,
      ]);
    }
  }

  /** E-mail de facturation, sinon celui du propriétaire du compte. */
  async clientEmail(organizationId: string, billingEmail?: string | null) {
    if (billingEmail) return billingEmail;
    const owner = await this.prisma.membership.findFirst({
      where: { organizationId, role: 'OWNER', deletedAt: null },
      select: { user: { select: { email: true } } },
    });
    return owner?.user.email ?? '';
  }

  /**
   * Ouvre (ou prolonge) un mois payé. À appeler dans la transaction
   * qui marque le paiement comme réussi.
   */
  async activatePaidPeriod(
    tx: Prisma.TransactionClient,
    organizationId: string,
    planCode: PlanCode,
    provider: PaymentProvider,
  ) {
    const plan = PLANS[planCode];
    const existing = await tx.subscription.findUnique({ where: { organizationId } });

    // Un renouvellement anticipé du MÊME plan prolonge la période
    // en cours — sinon le client perd des jours. Un changement de
    // plan démarre une nouvelle période.
    const now = new Date();
    const extend =
      existing &&
      existing.plan === planCode &&
      existing.status !== SubscriptionStatus.TRIALING &&
      existing.currentPeriodEnd > now;
    const base = extend ? existing.currentPeriodEnd : now;

    const periodEnd = new Date(base);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const data = {
      plan: planCode,
      status: SubscriptionStatus.ACTIVE,
      provider,
      cancelAtPeriodEnd: false,
      maxEntities: plan.maxEntities,
      maxUsers: plan.maxUsers,
      priceAmount: plan.priceMonthly,
      currentPeriodStart: extend ? existing.currentPeriodStart : now,
      currentPeriodEnd: periodEnd,
      gracePeriodEnd: null,
      remindersSent: 0,
      lastReminderAt: null,
      cancelledAt: null,
    };

    return existing
      ? tx.subscription.update({ where: { id: existing.id }, data })
      : tx.subscription.create({ data: { organizationId, ...data } });
  }

  /** Paiement Notch Pay : Mobile Money (MTN, Orange) ou carte. */
  private async checkoutNotchPay(
    organization: {
      id: string;
      name: string;
      billingEmail: string;
      billingPhone: string;
      subscription: { id: string } | null;
    },
    planCode: PlanCode,
    userEmail: string,
  ) {
    const plan = PLANS[planCode];
    const txRef = this.notchpay.buildTxRef(organization.id);

    const payment = await this.prisma.payment.create({
      data: {
        organizationId: organization.id,
        subscriptionId: organization.subscription?.id,
        provider: PaymentProvider.NOTCHPAY,
        amount: plan.priceMonthly,
        currency: 'XAF',
        txRef,
        status: PaymentStatus.PENDING,
        providerRaw: { planCode },
      },
    });

    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const { paymentUrl, providerRef } = await this.notchpay.initPayment({
      txRef,
      amount: plan.priceMonthly,
      customerEmail: organization.billingEmail || userEmail,
      customerPhone: organization.billingPhone,
      customerName: organization.name,
      description: this.notchpay.describe(plan.label),
      // Notch Pay ajoute ses propres paramètres à cette adresse.
      redirectUrl: `${frontend}/abonnement/retour?provider=notchpay&ref=${encodeURIComponent(txRef)}`,
    });

    // Référence Notch Pay conservée : elle sert à la vérification.
    if (providerRef) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerTxId: providerRef },
      });
    }

    return { paymentId: payment.id, txRef, paymentUrl, plan };
  }

  /**
   * Webhook Notch Pay : retrouve le paiement concerné puis le
   * confirme par une relecture serveur (confirmPayment).
   */
  async handleNotchPayEvent(event: {
    type?: string;
    event?: string;
    data?: { reference?: string; merchant_reference?: string };
  }) {
    const type = event.type ?? event.event ?? '';
    if (!type.startsWith('payment.')) return { ignored: true };

    const reference = event.data?.reference;
    const merchantRef = event.data?.merchant_reference;
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: PaymentProvider.NOTCHPAY,
        OR: [
          ...(reference ? [{ providerTxId: reference }, { txRef: reference }] : []),
          ...(merchantRef ? [{ txRef: merchantRef }] : []),
        ],
      },
    });
    if (!payment) return { ignored: true };

    return this.confirmPayment(payment.txRef, payment.providerTxId ?? payment.txRef);
  }

  // ----------------------------------------------------------
  //  Contrôle d'accès
  // ----------------------------------------------------------

  /**
   * Vérifie que l'organisation peut encore utiliser le service.
   * Un abonnement expiré reste utilisable pendant la période de
   * grâce — on ne coupe pas l'accès la veille d'une échéance
   * fiscale, ce serait contre-productif et brutal.
   */
  async assertActive(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!canUseSubscription(subscription)) {
      throw new ForbiddenException(SUBSCRIPTION_BLOCKED_MESSAGE);
    }
    return true;
  }

  /** Vérifie qu'on peut ajouter une entité de plus. */
  async assertCanAddEntity(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription) throw new ForbiddenException('Aucun abonnement actif');
    if (subscription.maxEntities === UNLIMITED) return true;

    const count = await this.prisma.entity.count({
      where: { organizationId, deletedAt: null, isActive: true },
    });

    if (count >= subscription.maxEntities) {
      throw new ForbiddenException(
        `Votre plan est limité à ${subscription.maxEntities} dossiers. ` +
          'Passez au plan supérieur pour en ajouter.',
      );
    }
    return true;
  }

  // ----------------------------------------------------------
  //  Essai gratuit et annulation
  // ----------------------------------------------------------

  async startTrial(organizationId: string, planCode: PlanCode) {
    const [existing, organization] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId } }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { type: true },
      }),
    ]);
    if (!organization) throw new NotFoundException('Organisation introuvable');
    if (existing) {
      throw new BadRequestException(
        'Un abonnement existe déjà : l’essai gratuit n’est proposé qu’une fois.',
      );
    }

    const plan = PLANS[planCode];
    if (plan.audience !== organization.type || plan.trialDays <= 0) {
      throw new BadRequestException('Aucun essai disponible pour ce plan.');
    }
    const end = new Date();
    end.setDate(end.getDate() + plan.trialDays);

    return this.prisma.subscription.create({
      data: {
        organizationId,
        plan: planCode,
        status: SubscriptionStatus.TRIALING,
        maxEntities: plan.maxEntities,
        maxUsers: plan.maxUsers,
        priceAmount: plan.priceMonthly,
        trialEndsAt: end,
        currentPeriodEnd: end,
      },
    });
  }

  async cancel(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription) throw new NotFoundException('Aucun abonnement');
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Cet abonnement est déjà résilié.');
    }

    // Carte : Stripe arrête les prélèvements à la fin de la période
    // payée ; l'abonnement reste actif jusque-là.
    if (subscription.stripeSubscriptionId) {
      if (subscription.cancelAtPeriodEnd) {
        throw new BadRequestException('La résiliation est déjà programmée.');
      }
      return this.stripeBilling.setCancelAtPeriodEnd(
        subscription.stripeSubscriptionId,
        true,
      );
    }

    // L'accès reste ouvert jusqu'à la fin de la période payée
    // (voir canUseSubscription).
    return this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  /** Annule une résiliation programmée (abonnement par carte). */
  async resume(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription?.stripeSubscriptionId || !subscription.cancelAtPeriodEnd) {
      throw new BadRequestException('Aucune résiliation programmée à annuler.');
    }
    return this.stripeBilling.setCancelAtPeriodEnd(
      subscription.stripeSubscriptionId,
      false,
    );
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private async activateFreePlan(
    organizationId: string,
    planCode: PlanCode,
  ) {
    const plan = PLANS[planCode];
    const periodEnd = new Date();
    periodEnd.setFullYear(periodEnd.getFullYear() + 10);

    const data = {
      plan: planCode,
      status: SubscriptionStatus.ACTIVE,
      maxEntities: plan.maxEntities,
      maxUsers: plan.maxUsers,
      priceAmount: 0,
      currentPeriodEnd: periodEnd,
      provider: null,
      cancelAtPeriodEnd: false,
      gracePeriodEnd: null,
      cancelledAt: null,
    };

    const subscription = await this.prisma.subscription.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    return { paymentUrl: null, subscription, plan };
  }

  private mapMethod(method?: string) {
    if (!method) return undefined;
    const normalized = method.toLowerCase();
    if (normalized.includes('mtn')) return 'MOBILE_MONEY_MTN' as const;
    if (normalized.includes('orange')) return 'MOBILE_MONEY_ORANGE' as const;
    if (normalized.includes('mobile')) return 'MOBILE_MONEY_MTN' as const;
    if (normalized.includes('bank')) return 'BANK_TRANSFER' as const;
    return 'OTHER' as const;
  }
}

function fcfa(centimes: number): string {
  return `${Math.round(centimes / 100).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
}

function frDate(value: Date): string {
  return value.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' });
}
