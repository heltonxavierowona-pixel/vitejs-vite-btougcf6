import { Module } from '@nestjs/common';

import {
  FlutterwaveWebhookController,
  NotchPayWebhookController,
  StripeWebhookController,
  SubscriptionController,
} from './subscription.controller';
import { StripeService } from './stripe.service';
import { NotchPayService } from './notchpay.service';
import { CronController } from './cron.controller';
import { AdminController } from './admin.controller';
import { ManualPaymentService } from './manual-payment.service';
import { NotifierService } from './notifier.service';
import { PlatformAdminGuard } from '../auth/platform-admin';
import { StripeBillingService } from './stripe-billing.service';
import { SubscriptionService } from './subscription.service';
import { FlutterwaveService } from './flutterwave.service';
import { SubscriptionCronService } from './subscription-cron.service';

@Module({
  controllers: [
    SubscriptionController,
    FlutterwaveWebhookController,
    NotchPayWebhookController,
    StripeWebhookController,
    CronController,
    AdminController,
  ],
  providers: [
    SubscriptionService,
    FlutterwaveService,
    StripeService,
    StripeBillingService,
    NotchPayService,
    SubscriptionCronService,
    ManualPaymentService,
    NotifierService,
    PlatformAdminGuard,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
