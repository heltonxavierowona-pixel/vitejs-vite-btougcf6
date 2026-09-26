import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { DeclarationService } from './declaration.service';
import { MarkPaidDto, SubmitDeclarationDto } from './dto/declaration.dto';
import { AuthGuard } from '../auth/auth.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import { Roles } from '../auth/roles.decorator';
import { Ctx } from '../auth/context.decorator';
import { RequestContext } from '../auth/request-context';

@Controller('entities/:entityId/declarations')
@UseGuards(AuthGuard, TenancyGuard)
export class DeclarationController {
  constructor(private readonly declarations: DeclarationService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query('year') year?: string) {
    const parsed = year ? Number(year) : undefined;
    return this.declarations.list(
      ctx,
      parsed && Number.isInteger(parsed) ? parsed : undefined,
    );
  }

  // Paramètres numériques uniquement : sans ce filtre, la route
  // captait aussi /declarations/:id/pdf (year=id, month="pdf").
  @Get(':year(\\d{4})/:month(\\d{1,2})')
  findByPeriod(
    @Ctx() ctx: RequestContext,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.declarations.findByPeriod(ctx, { year, month });
  }

  /** Calcule ou recalcule la déclaration depuis les factures validées. */
  @Post(':year(\\d{4})/:month(\\d{1,2})/compute')
  @HttpCode(200)
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  compute(
    @Ctx() ctx: RequestContext,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.declarations.computeForPeriod(ctx, { year, month });
  }

  @Post(':id/ready')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  markReady(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.declarations.markReady(ctx, id);
  }

  /** Enregistre le dépôt effectué sur le portail DGI (manuel en V1). */
  @Post(':id/submit')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  submit(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SubmitDeclarationDto,
  ) {
    return this.declarations.submit(ctx, id, dto);
  }

  @Post(':id/paid')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  markPaid(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.declarations.markPaid(ctx, id, dto.paidAt);
  }
}
