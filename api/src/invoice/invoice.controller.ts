import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { InvoiceService } from './invoice.service';
import { RequestContext } from '../auth/request-context';
import {
  CreateCreditNoteDto,
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  SetDgiReferenceDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import { AuthGuard } from '../auth/auth.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import { Roles } from '../auth/roles.decorator';
import { Ctx } from '../auth/context.decorator';

/**
 * Routes imbriquées sous l'entité : l'identifiant d'entité fait
 * partie de l'URL et le TenancyGuard vérifie que l'utilisateur
 * courant y a bien accès. Aucun endpoint ne doit exposer une
 * facture sans passer par ce préfixe.
 */
@Controller('entities/:entityId/invoices')
@UseGuards(AuthGuard, TenancyGuard)
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(ctx, query);
  }

  @Get(':id/history')
  history(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.history(ctx, id);
  }

  @Get(':id')
  findOne(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.findOne(ctx, id);
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.OPERATOR)
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(ctx, dto);
  }

  @Put(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.OPERATOR)
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(ctx, id, dto);
  }

  /** Point de non-retour : la facture devient immuable. */
  @Post(':id/validate')
  @HttpCode(200)
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  validate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.validate(ctx, id);
  }

  /**
   * Référence de la facture émise sur le système de facturation
   * électronique de la DGI (CGI art. 8 bis et 143, LPF art. L 8 bis).
   */
  @Put(':id/dgi-reference')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.OPERATOR)
  setDgiReference(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SetDgiReferenceDto,
  ) {
    return this.invoices.setDgiReference(ctx, id, dto.reference);
  }

  @Post(':id/credit-note')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  createCreditNote(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.invoices.createCreditNote(ctx, id, dto);
  }

  @Post(':id/payments')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.OPERATOR)
  recordPayment(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoices.recordPayment(ctx, id, dto);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.remove(ctx, id);
  }
}
