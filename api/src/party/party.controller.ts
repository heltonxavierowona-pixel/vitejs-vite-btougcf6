import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { PartyService } from './party.service';
import {
  CreatePartyDto,
  CreateProductDto,
  ListPartiesQueryDto,
  UpdatePartyDto,
  UpdateProductDto,
} from './dto/party.dto';
import { AuthGuard } from '../auth/auth.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import { Roles } from '../auth/roles.decorator';
import { Ctx } from '../auth/context.decorator';
import { RequestContext } from '../auth/request-context';

const WRITERS = [Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.OPERATOR];

@Controller('entities/:entityId')
@UseGuards(AuthGuard, TenancyGuard)
export class PartyController {
  constructor(private readonly parties: PartyService) {}

  // ---- Clients ----

  @Get('customers')
  listCustomers(
    @Ctx() ctx: RequestContext,
    @Query() query: ListPartiesQueryDto,
  ) {
    return this.parties.listCustomers(ctx, query);
  }

  @Post('customers')
  @Roles(...WRITERS)
  createCustomer(@Ctx() ctx: RequestContext, @Body() dto: CreatePartyDto) {
    return this.parties.createCustomer(ctx, dto);
  }

  @Put('customers/:id')
  @Roles(...WRITERS)
  updateCustomer(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.parties.updateCustomer(ctx, id, dto);
  }

  @Delete('customers/:id')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  deleteCustomer(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.parties.deleteCustomer(ctx, id);
  }

  // ---- Fournisseurs ----

  @Get('suppliers')
  listSuppliers(
    @Ctx() ctx: RequestContext,
    @Query() query: ListPartiesQueryDto,
  ) {
    return this.parties.listSuppliers(ctx, query);
  }

  @Post('suppliers')
  @Roles(...WRITERS)
  createSupplier(@Ctx() ctx: RequestContext, @Body() dto: CreatePartyDto) {
    return this.parties.createSupplier(ctx, dto);
  }

  @Put('suppliers/:id')
  @Roles(...WRITERS)
  updateSupplier(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.parties.updateSupplier(ctx, id, dto);
  }

  @Delete('suppliers/:id')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  deleteSupplier(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.parties.deleteSupplier(ctx, id);
  }

  // ---- Catalogue ----

  @Get('products')
  listProducts(
    @Ctx() ctx: RequestContext,
    @Query('search') search?: string,
  ) {
    return this.parties.listProducts(ctx, search);
  }

  @Post('products')
  @Roles(...WRITERS)
  createProduct(@Ctx() ctx: RequestContext, @Body() dto: CreateProductDto) {
    return this.parties.createProduct(ctx, dto);
  }

  @Put('products/:id')
  @Roles(...WRITERS)
  updateProduct(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.parties.updateProduct(ctx, id, dto);
  }

  @Delete('products/:id')
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  deleteProduct(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.parties.deleteProduct(ctx, id);
  }
}
