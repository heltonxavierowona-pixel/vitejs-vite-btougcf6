import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';

import { SubscriptionCronService } from './subscription-cron.service';

/**
 * Déclenchement des tâches quotidiennes par Vercel Cron
 * (voir api/vercel.json). Vercel envoie `Authorization: Bearer
 * <CRON_SECRET>` ; sans ce secret, personne ne peut lancer les
 * relances de l'extérieur.
 */
@Controller('cron')
@SkipThrottle()
export class CronController {
  constructor(private readonly cron: SubscriptionCronService) {}

  @Get('dunning')
  async dunning(@Headers('authorization') authorization?: string) {
    this.assertAuthorized(authorization);
    await this.cron.runDunning();
    return { ok: true };
  }

  @Get('tax-reminders')
  async taxReminders(@Headers('authorization') authorization?: string) {
    this.assertAuthorized(authorization);
    await this.cron.runTaxReminders();
    return { ok: true };
  }

  private assertAuthorized(authorization?: string) {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const received = Buffer.from(authorization ?? '');
    if (
      !secret ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException();
    }
  }
}
