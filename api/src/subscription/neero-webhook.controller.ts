import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { NeeroProvider } from '../payments/neero/neero.provider';
import { NeeroBillingService } from './neero-billing.service';

/**
 * Webhook Neero (événement transactionIntent.statusUpdated).
 *
 * 1. Signature HMAC-SHA512 sur le corps BRUT (main.ts : rawBody),
 *    horodatage de moins de 5 minutes, sinon 401.
 * 2. Idempotence sur l'identifiant d'événement.
 * 3. Opérateur vérifié, puis transaction relue chez Neero avant
 *    toute activation (NeeroBillingService → confirmPayment).
 */
@Controller('webhooks/neero')
export class NeeroWebhookController {
  private readonly logger = new Logger(NeeroWebhookController.name);

  constructor(
    private readonly neero: NeeroProvider,
    private readonly billing: NeeroBillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() request: RawBodyRequest<Request>) {
    const raw = request.rawBody;
    if (!raw) throw new BadRequestException('Corps de requête absent');

    if (!this.neero.verifyWebhook(raw, request.headers)) {
      this.logger.warn('Webhook Neero refusé : signature ou horodatage invalide');
      // Journalisé sans identifiant d'événement : un faux webhook ne
      // doit jamais pouvoir « occuper » l'identifiant d'un vrai.
      await this.prisma.webhookEvent
        .create({
          data: {
            provider: 'NEERO',
            eventType: 'signature-invalide',
            payload: { excerpt: raw.toString('utf8').slice(0, 2000) },
            signatureValid: false,
          },
        })
        .catch(() => undefined);
      throw new UnauthorizedException('Signature invalide');
    }

    const event = this.neero.parseWebhookEvent(raw);
    if (!event.eventId) return { received: true, ignored: true };

    const known = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'NEERO', externalId: event.eventId } },
    });
    if (known?.processedAt) return { received: true, duplicate: true };

    const record =
      known ??
      (await this.prisma.webhookEvent.create({
        data: {
          provider: 'NEERO',
          eventType: event.type || 'inconnu',
          externalId: event.eventId,
          payload: event.raw as object,
          signature: String(request.headers['x-signature'] ?? ''),
          signatureValid: true,
        },
      }));

    try {
      const result = await this.billing.handleWebhook(event);
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: null },
      });
      return { received: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook Neero ${event.eventId} en échec : ${message}`);
      await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { error: message } });
      throw error; // Neero renverra l'événement
    }
  }
}
