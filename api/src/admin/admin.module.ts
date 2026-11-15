import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../auth/platform-admin';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

/** Tableau de bord de l'administratrice : chiffres, clients, e-mails. */
@Module({
  imports: [SubscriptionModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService, PlatformAdminGuard],
})
export class AdminModule {}
