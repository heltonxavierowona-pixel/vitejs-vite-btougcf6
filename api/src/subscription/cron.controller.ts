import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';

import { SubscriptionCronService } from './subscription-cron.service';
import { NeeroBillingService } from './neero-billing.service';

/**
 * Déclenchement des tâches quotidiennes par Vercel Cron
 * (voir api/vercel.json). Vercel envoie `Authorization: Bearer
 * <CRON_SECRET>` ; sans ce secret, personne ne peut lancer les
 * relances de l'extérieur.
 */
@Controller('cron')
@SkipThrottle()
export class CronController {
  constructor(
    private readonly cron: SubscriptionCronService,
    private readonly neeroBilling: NeeroBillingService,
  ) {}

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

  /**
   * Rattrapage des paiements Neero sans webhook. Vercel (offre
   * gratuite) ne lance une tâche qu'une fois par jour : pour le
   * rythme de 15 minutes, un service externe (cron-job.org…) peut
   * appeler cette adresse avec le même en-tête.
   */
  @Get('payments-reconcile')
  async paymentsReconcile(@Headers('authorization') authorization?: string) {
    this.assertAuthorized(authorization);
    return { ok: true, ...(await this.neeroBilling.reconcilePending()) };
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
