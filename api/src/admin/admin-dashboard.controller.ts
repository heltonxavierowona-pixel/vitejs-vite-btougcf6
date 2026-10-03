import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlanCode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/context.decorator';
import { PlatformAdminGuard } from '../auth/platform-admin';
import { AdminDashboardService, ClientSegment } from './admin-dashboard.service';

const SEGMENTS: ClientSegment[] = ['all', 'trialing', 'active', 'expiring', 'past_due', 'suspended', 'cancelled', 'free'];

class ClientsQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(SEGMENTS) segment?: ClientSegment;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

class ExtendDto {
  @IsOptional() @IsInt() @Min(0) @Max(24) months?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) days?: number;
  /** Montant encaissé hors ligne, en FCFA (0 = geste commercial). */
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) amount?: number;
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

class PlanDto {
  @IsEnum(PlanCode) plan: PlanCode;
}

class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

class EmailDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsIn(SEGMENTS) segment?: ClientSegment;
  @IsString() @MinLength(3) @MaxLength(150) subject: string;
  @IsString() @MinLength(10) @MaxLength(5000) message: string;
}

class TrialRemindDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) organizationIds?: string[];
}

class ExportQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/** Tableau de bord de l'administratrice de la plateforme. */
@Controller('admin')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('stats')
  stats() {
    return this.dashboard.stats();
  }

  @Get('revenue')
  revenue(@Query('months') months?: string) {
    return this.dashboard.revenueByMonth(Number(months) || 12);
  }

  @Get('clients')
  clients(@Query() query: ClientsQuery) {
    return this.dashboard.listClients(query);
  }

  @Get('clients/:id')
  client(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.clientDetail(id);
  }

  @Post('clients/:id/extend')
  @HttpCode(200)
  extend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendDto) {
    return this.dashboard.extend(id, user, dto);
  }

  @Post('clients/:id/plan')
  @HttpCode(200)
  plan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.dashboard.changePlan(id, user, dto.plan);
  }

  @Post('clients/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.dashboard.suspend(id, user, dto.reason);
  }

  @Post('clients/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.reactivate(id, user);
  }

  // --- Exports ---

  @Get('export/clients.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="numera-clients.csv"')
  exportClients() {
    return this.dashboard.exportClientsCsv();
  }

  @Get('export/payments.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="numera-paiements.csv"')
  exportPayments(@Query() query: ExportQuery) {
    const date = (value?: string) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined);
    return this.dashboard.exportPaymentsCsv(date(query.from), date(query.to));
  }

  // --- E-mails ---

  @Get('emails/recipients')
  async recipients(@Query('segment') segment?: string, @Query('organizationId') organizationId?: string) {
    const valid = SEGMENTS.includes(segment as ClientSegment) ? (segment as ClientSegment) : 'all';
    const { recipients, truncated } = await this.dashboard.recipients({
      organizationId: organizationId || undefined,
      segment: valid,
    });
    return { count: recipients.length, truncated, sample: recipients.slice(0, 5).map((r) => r.name) };
  }

  @Post('emails')
  @HttpCode(200)
  sendEmail(@Body() dto: EmailDto) {
    return this.dashboard.sendEmail(
      { organizationId: dto.organizationId, segment: dto.segment },
      dto.subject.trim(),
      dto.message.trim(),
    );
  }

  @Post('trial-reminders')
  @HttpCode(200)
  remindTrials(@Body() dto: TrialRemindDto) {
    return this.dashboard.remindTrials(dto.organizationIds);
  }
}
