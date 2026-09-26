import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlanCode } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';

import { SubscriptionService } from './subscription.service';
import { FlutterwaveService } from './flutterwave.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/context.decorator';

class SelectPlanDto {
  @IsEnum(PlanCode)
  plan: PlanCode;
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
    @Body() dto: SelectPlanDto,
  ) {
    await this.assertOwner(user.id, organizationId);
    return this.subscriptions.initiateCheckout(
      organizationId,
      dto.plan,
      user.email,
    );
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
