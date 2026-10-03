import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import { Ctx, CurrentUser } from '../auth/context.decorator';
import { RequestContext } from '../auth/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { Period } from '../tax/deadline.util';

/** Période facultative passée en query ; refusée si incohérente. */
function parsePeriod(year?: string, month?: string): Period | undefined {
  if (!year && !month) return undefined;
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2000 || y > 2100) {
    throw new BadRequestException('Période invalide');
  }
  return { year: y, month: m };
}

@Controller()
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Point d'entrée après connexion : indique au front quel
   * dashboard afficher.
   */
  @Get('organizations/:organizationId/view')
  async resolveView(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    await this.assertMember(user.id, organizationId);
    return this.dashboard.resolveView(organizationId);
  }

  /** Vue portefeuille — cabinets uniquement. */
  @Get('organizations/:organizationId/dashboard/cabinet')
  async cabinet(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    await this.assertMember(user.id, organizationId);

    return this.dashboard.cabinetOverview(
      organizationId,
      user.id,
      parsePeriod(year, month),
    );
  }

  /** Vue entreprise — une seule entité, aucune liste de clients. */
  @Get('entities/:entityId/dashboard')
  @UseGuards(TenancyGuard)
  entity(
    @Ctx() ctx: RequestContext,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.dashboard.entityOverview(ctx.entityId, parsePeriod(year, month));
  }

  /**
   * Les routes d'organisation ne passent pas par le TenancyGuard
   * (pas d'entityId dans l'URL) : on vérifie l'appartenance ici.
   */
  private async assertMember(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Accès refusé à cette organisation');
    }
  }
}
