import { Module } from '@nestjs/common';

import {
  FlutterwaveWebhookController,
  StripeWebhookController,
  SubscriptionController,
} from './subscription.controller';
import { StripeService } from './stripe.service';
import { CronController } from './cron.controller';
import { StripeBillingService } from './stripe-billing.service';
import { SubscriptionService } from './subscription.service';
import { FlutterwaveService } from './flutterwave.service';
import { SubscriptionCronService } from './subscription-cron.service';

@Module({
  controllers: [
    SubscriptionController,
    FlutterwaveWebhookController,
    StripeWebhookController,
    CronController,
  ],
  providers: [
    SubscriptionService,
    FlutterwaveService,
    StripeService,
    StripeBillingService,
    SubscriptionCronService,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
