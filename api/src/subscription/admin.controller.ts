import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlanCode } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/context.decorator';
import { PlatformAdminGuard } from '../auth/platform-admin';
import { ManualPaymentService } from './manual-payment.service';
import { NotifierService } from './notifier.service';

class SendLinkDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Collez un lien https complet.' })
  @MaxLength(500)
  paymentLink: string;
}

class PlanLinkDto {
  @IsEnum(PlanCode)
  plan: PlanCode;

  /** Vide pour retirer le lien de cette formule. */
  @ValidateIf((dto) => !!dto.paymentLink)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Collez un lien https complet.' })
  @MaxLength(500)
  paymentLink?: string | null;
}

class ValidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  transactionRef?: string;
}

class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

/**
 * Écran de l'administrateur de la plateforme : demandes de
 * paiement Neero et réglage des notifications Telegram.
 */
@Controller('admin')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly manualPayments: ManualPaymentService,
    private readonly notifier: NotifierService,
  ) {}

  @Get('payment-requests')
  list(@Query('scope') scope?: string) {
    return this.manualPayments.list(scope === 'closed' ? 'closed' : 'open');
  }

  @Post('payment-requests/:id/link')
  @HttpCode(200)
  sendLink(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendLinkDto) {
    return this.manualPayments.sendLink(id, dto.paymentLink.trim());
  }

  @Post('payment-requests/:id/validate')
  @HttpCode(200)
  validate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateDto,
  ) {
    return this.manualPayments.validate(id, user, dto.transactionRef?.trim() || undefined);
  }

  @Post('payment-requests/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.manualPayments.rejectReference(id, dto.reason.trim());
  }

  @Post('payment-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.manualPayments.cancelByAdmin(id);
  }

  /** Liens Neero préparés par formule, envoyés automatiquement. */
  @Get('plan-links')
  planLinks() {
    return this.manualPayments.planLinks();
  }

  @Post('plan-links')
  @HttpCode(200)
  setPlanLink(@Body() dto: PlanLinkDto) {
    return this.manualPayments.setPlanLink(dto.plan, dto.paymentLink?.trim() || null);
  }

  // ----------------------------------------------------------
  //  Notifications
  // ----------------------------------------------------------

  @Get('notifications')
  async notifications() {
    return {
      telegramBot: this.notifier.telegramConfigured,
      telegramChat: !!(await this.notifier.telegramChatId()),
      whatsapp: this.notifier.whatsappConfigured,
      email: this.notifier.emailConfigured,
    };
  }

  /** Après avoir écrit au bot : retrouve la conversation. */
  @Post('notifications/telegram/detect')
  @HttpCode(200)
  async detectTelegram() {
    if (!this.notifier.telegramConfigured) {
      throw new BadRequestException('Ajoutez d’abord TELEGRAM_BOT_TOKEN dans Vercel.');
    }
    const chat = await this.notifier.detectTelegramChat();
    if (!chat) {
      throw new BadRequestException(
        'Aucun message trouvé : envoyez « /start » à votre bot dans Telegram, puis réessayez.',
      );
    }
    await this.notifier.sendTelegram('✅ Notifications Numera activées sur ce téléphone.');
    return chat;
  }

  @Post('notifications/test')
  @HttpCode(200)
  async test() {
    const sent = await this.notifier.notifyAdmin('Test de notification', [
      'Si vous lisez ce message, les notifications fonctionnent.',
    ]);
    if (!sent) {
      throw new BadRequestException('Aucun canal de notification ne fonctionne encore.');
    }
    return { sent };
  }
}
