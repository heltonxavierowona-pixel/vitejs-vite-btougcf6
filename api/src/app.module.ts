import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { InvoiceModule } from './invoice/invoice.module';
import { DeclarationModule } from './declaration/declaration.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PdfModule } from './pdf/pdf.module';
import { HealthModule } from './health/health.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { NotifierModule } from './subscription/notifier.module';
import { PaymentsModule } from './payments/payments.module';
import { EntityModule } from './entity/entity.module';
import { PartyModule } from './party/party.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Limite globale par IP ; /auth/login et /auth/register ont
    // leur propre limite, plus stricte (voir AuthController).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // Nécessaire aux tâches planifiées (rappels d'échéance,
    // relances d'abonnement)
    ScheduleModule.forRoot(),

    PrismaModule,
    NotifierModule,
    PaymentsModule,
    AuditModule,
    AuthModule,
    InvoiceModule,
    DeclarationModule,
    DashboardModule,
    PdfModule,
    SubscriptionModule,
    EntityModule,
    PartyModule,
    HealthModule,
  ],
  providers: [
    // Sans ce guard global, ThrottlerModule ne limite rien.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
