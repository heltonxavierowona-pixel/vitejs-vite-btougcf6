import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  RawBodyRequest,
  Req,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentProvider, PlanCode } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import Stripe from 'stripe';

import { SubscriptionService } from './subscription.service';
import { StripeBillingService } from './stripe-billing.service';
import { NotchPayService } from './notchpay.service';
import { FlutterwaveService } from './flutterwave.service';
import { ManualPaymentService } from './manual-payment.service';
import { PLANS } from './plans';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/context.decorator';

class SelectPlanDto {
  @IsEnum(PlanCode)
  plan: PlanCode;
}

class CheckoutDto extends SelectPlanDto {
  /** Notch Pay (Mobile Money, carte), Stripe (carte) ou Flutterwave. */
  @IsOptional()
  @IsIn([PaymentProvider.NOTCHPAY, PaymentProvider.STRIPE, PaymentProvider.FLUTTERWAVE])
  provider?: PaymentProvider;
}

class ConfirmNotchPayDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{4,80}$/, { message: 'Référence de paiement invalide' })
  txRef: string;
}

class TransactionRefDto {
  @IsString()
  @MaxLength(80)
  transactionRef: string;
}

class ConfirmStripeDto {
  @IsString()
  @Matches(/^cs_(test|live)_[A-Za-z0-9]{10,200}$/, {
    message: 'Session de paiement invalide',
  })
  sessionId: string;
}

class ConfirmDto {
  @IsString()
  @MaxLength(80)
  txRef: string;

  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'Identifiant de transaction invalide' })
  transactionId: string;
}

@Controller('organizations/:organizationId/subscription')
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly stripeBilling: StripeBillingService,
    private readonly manualPayments: ManualPaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('plans')
  async plans(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.subscriptions.availablePlans(organizationId);
  }

  @Get()
  async current(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.subscriptions.current(organizationId);
  }

  @Post('checkout')
  async checkout(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: CheckoutDto,
  ) {
    await this.assertOwner(user.id, organizationId);
    // Paiements en ligne désactivés : demande de lien Neero.
    if (!this.subscriptions.onlinePaymentsEnabled && PLANS[dto.plan]?.priceMonthly > 0) {
      return this.manualPayments.request(organizationId, dto.plan, user);
    }
    return this.subscriptions.initiateCheckout(
      organizationId,
      dto.plan,
      user.email,
      dto.provider,
    );
  }

  /** Le client a payé avec le lien Neero : il saisit la référence. */
  @Post('payment-request/reference')
  @HttpCode(200)
  async submitReference(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: TransactionRefDto,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.manualPayments.submitReference(organizationId, dto.transactionRef);
  }

  @Post('payment-request/cancel')
  @HttpCode(200)
  async cancelPaymentRequest(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.manualPayments.cancelByClient(organizationId);
  }

  /** Retour navigateur après un paiement Notch Pay. */
  @Post('confirm-notchpay')
  @HttpCode(200)
  async confirmNotchPay(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ConfirmNotchPayDto,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.subscriptions.confirmPayment(dto.txRef, dto.txRef, organizationId);
  }

  /** Retour navigateur après un paiement Stripe. */
  @Post('confirm-stripe')
  @HttpCode(200)
  async confirmStripe(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ConfirmStripeDto,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.stripeBilling.confirmSession(dto.sessionId, organizationId);
  }

  /** Portail Stripe : carte bancaire, factures, résiliation. */
  @Post('portal')
  @HttpCode(200)
  async portal(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.stripeBilling.portal(organizationId);
  }

  @Post('resume')
  @HttpCode(200)
  async resume(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.subscriptions.resume(organizationId);
  }

  @Post('trial')
  async trial(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: SelectPlanDto,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.subscriptions.startTrial(organizationId, dto.plan);
  }

  /** Retour navigateur après paiement — chemin redondant du webhook. */
  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ConfirmDto,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.subscriptions.confirmPayment(
      dto.txRef,
      dto.transactionId,
      organizationId,
    );
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.subscriptions.cancel(organizationId);
  }

  private async assertMember(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Accès refusé');
  }

  private async assertOwner(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        organizationId,
        deletedAt: null,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        "Seul un administrateur peut gérer l'abonnement",
      );
    }
  }
}

/**
 * Webhook Flutterwave — non authentifié par JWT, protégé par
 * la signature du fournisseur.
 */
@Controller('webhooks/flutterwave')
@SkipThrottle()
export class FlutterwaveWebhookController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly flutterwave: FlutterwaveService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Headers('verif-hash') signature: string,
    @Body() payload: any,
  ) {
    if (!this.flutterwave.verifyWebhookSignature(signature)) {
      throw new ForbiddenException('Signature invalide');
    }

    const rawId = payload?.data?.id ?? payload?.id;
    if (rawId === undefined || rawId === null) {
      return { received: true, ignored: true };
    }
    const externalId = String(rawId);

    // Déduplication : le fournisseur peut réémettre le même
    // événement plusieurs fois.
    const existing = await this.prisma.webhookEvent.findFirst({
      where: { provider: 'FLUTTERWAVE', externalId },
    });
    if (existing?.processedAt) return { received: true, duplicate: true };

    const event = await this.prisma.webhookEvent.upsert({
      where: {
        provider_externalId: { provider: 'FLUTTERWAVE', externalId },
      },
      create: {
        provider: 'FLUTTERWAVE',
        eventType: payload?.event ?? 'unknown',
        externalId,
        payload,
        signature,
      },
      update: { payload },
    });

    try {
      const txRef = payload?.data?.tx_ref;
      if (txRef && payload?.data?.status === 'successful') {
        await this.subscriptions.confirmPayment(txRef, externalId);
      }

      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (error: any) {
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: error?.message ?? 'Erreur inconnue' },
      });
      // On répond 200 malgré tout : le fournisseur ne doit pas
      // retenter indéfiniment. L'événement reste en base pour
      // rejeu manuel.
    }

    return { received: true };
  }
}

/**
 * Webhook Stripe — non authentifié par JWT, protégé par la
 * signature Stripe calculée sur le corps BRUT de la requête
 * (d'où `rawBody: true` dans main.ts).
 */
@Controller('webhooks/stripe')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly stripeBilling: StripeBillingService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('Corps de requête absent');
    }
    try {
      return await this.stripeBilling.handleWebhook(request.rawBody, signature);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw new BadRequestException('Signature Stripe invalide');
      }
      this.logger.error(
        `Webhook Stripe en échec : ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}

/**
 * Webhook Notch Pay — protégé par la signature HMAC calculée sur
 * le corps brut (en-tête x-notch-signature). Le paiement est de
 * toute façon revérifié auprès de Notch Pay avant activation.
 */
@Controller('webhooks/notchpay')
@SkipThrottle()
export class NotchPayWebhookController {
  private readonly logger = new Logger(NotchPayWebhookController.name);

  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly notchpay: NotchPayService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-notch-signature') signature?: string,
  ) {
    if (!request.rawBody || !this.notchpay.verifyWebhookSignature(request.rawBody, signature)) {
      throw new ForbiddenException('Signature invalide');
    }

    const payload = request.body as {
      id?: string;
      type?: string;
      event?: string;
      data?: { reference?: string; merchant_reference?: string };
    };
    const externalId = String(payload?.id ?? '');
    if (!externalId) return { received: true, ignored: true };

    // Déduplication : un même événement peut être réémis.
    const known = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'NOTCHPAY', externalId } },
    });
    if (known?.processedAt) return { received: true, duplicate: true };

    const record =
      known ??
      (await this.prisma.webhookEvent.create({
        data: {
          provider: 'NOTCHPAY',
          eventType: payload.type ?? payload.event ?? 'unknown',
          externalId,
          payload: payload as object,
          signature,
        },
      }));

    try {
      await this.subscriptions.handleNotchPayEvent(payload);
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook Notch Pay en échec : ${message}`);
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { error: message },
      });
      throw error; // Notch Pay retentera l'envoi
    }

    return { received: true };
  }
}
