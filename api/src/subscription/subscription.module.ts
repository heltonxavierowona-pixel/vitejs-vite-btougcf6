import { Module } from '@nestjs/common';

import {
  FlutterwaveWebhookController,
  SubscriptionController,
} from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { FlutterwaveService } from './flutterwave.service';
import { SubscriptionCronService } from './subscription-cron.service';

@Module({
  controllers: [SubscriptionController, FlutterwaveWebhookController],
  providers: [
    SubscriptionService,
    FlutterwaveService,
    SubscriptionCronService,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
