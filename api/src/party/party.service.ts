import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../auth/request-context';
import {
  CreatePartyDto,
  CreateProductDto,
  ListPartiesQueryDto,
  UpdatePartyDto,
  UpdateProductDto,
} from './dto/party.dto';

/**
 * ============================================================
 *  TIERS & CATALOGUE
 * ============================================================
 *
 *  Clients, fournisseurs et produits sont toujours rattachés à
 *  UNE entité. Dans un cabinet, chaque dossier a ses propres
 *  tiers — ils ne sont jamais partagés entre clients du
 *  cabinet, même si le même fournisseur revient partout.
 *
 *  C'est volontaire : mutualiser créerait un chemin de fuite
 *  entre deux entreprises concurrentes.
 * ============================================================
 */
@Injectable()
export class PartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================
  //  CLIENTS
  // ==========================================================

  async listCustomers(ctx: RequestContext, query: ListPartiesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const where: Prisma.CustomerWhereInput = {
      entityId: ctx.entityId,
      deletedAt: null,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { niu: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { invoices: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async createCustomer(ctx: RequestContext, dto: CreatePartyDto) {
    this.assertNiuIfVatSubject(dto);

    const customer = await this.prisma.customer.create({
      data: { entityId: ctx.entityId, ...dto },
    });

    await this.audit.log(ctx, AuditAction.CREATE, 'Customer', customer.id, {
      after: customer,
    });

    return customer;
  }

  async updateCustomer(
    ctx: RequestContext,
    id: string,
    dto: UpdatePartyDto,
  ) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Client introuvable');

    this.assertNiuIfVatSubject({ ...existing, ...dto } as any);

    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'Customer', id, {
      before: existing,
      after: updated,
    });

    return updated;
  }

  async deleteCustomer(ctx: RequestContext, id: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
      include: { _count: { select: { invoices: true } } },
    });
    if (!existing) throw new NotFoundException('Client introuvable');

    // On n'efface jamais un tiers lié à des factures : les
    // documents émis doivent rester cohérents.
    if (existing._count.invoices > 0) {
      throw new ConflictException(
        `Ce client est lié à ${existing._count.invoices} facture(s) ` +
          'et ne peut pas être supprimé.',
      );
    }

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log(ctx, AuditAction.DELETE, 'Customer', id, {
      before: existing,
    });

    return { deleted: true };
  }

  // ==========================================================
  //  FOURNISSEURS
  // ==========================================================

  async listSuppliers(ctx: RequestContext, query: ListPartiesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const where: Prisma.SupplierWhereInput = {
      entityId: ctx.entityId,
      deletedAt: null,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { niu: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { invoices: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async createSupplier(ctx: RequestContext, input: CreatePartyDto) {
    // La retenue à la source ne concerne que les clients.
    const { withholdsVat: _ignored, ...dto } = input;
    const supplier = await this.prisma.supplier.create({
      data: { entityId: ctx.entityId, ...dto },
    });

    await this.audit.log(ctx, AuditAction.CREATE, 'Supplier', supplier.id, {
      after: supplier,
    });

    return supplier;
  }

  async updateSupplier(
    ctx: RequestContext,
    id: string,
    dto: UpdatePartyDto,
  ) {
    const existing = await this.prisma.supplier.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Fournisseur introuvable');

    const { withholdsVat: _ignored, ...data } = dto;
    const updated = await this.prisma.supplier.update({
      where: { id },
      data,
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'Supplier', id, {
      before: existing,
      after: updated,
    });

    return updated;
  }

  async deleteSupplier(ctx: RequestContext, id: string) {
    const existing = await this.prisma.supplier.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
      include: { _count: { select: { invoices: true } } },
    });
    if (!existing) throw new NotFoundException('Fournisseur introuvable');

    if (existing._count.invoices > 0) {
      throw new ConflictException(
        'Ce fournisseur est lié à des factures et ne peut pas être supprimé.',
      );
    }

    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log(ctx, AuditAction.DELETE, 'Supplier', id, {
      before: existing,
    });

    return { deleted: true };
  }

  // ==========================================================
  //  CATALOGUE
  // ==========================================================

  async listProducts(ctx: RequestContext, search?: string) {
    search = search?.slice(0, 100);
    return this.prisma.product.findMany({
      where: {
        entityId: ctx.entityId,
        deletedAt: null,
        ...(search && {
          OR: [
            { label: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { label: 'asc' },
    });
  }

  async createProduct(ctx: RequestContext, dto: CreateProductDto) {
    if (dto.reference) {
      const duplicate = await this.prisma.product.findFirst({
        where: {
          entityId: ctx.entityId,
          reference: dto.reference,
          deletedAt: null,
        },
      });
      if (duplicate) {
        throw new ConflictException('Cette référence existe déjà');
      }
    }

    return this.prisma.product.create({
      data: { entityId: ctx.entityId, ...dto, reference: dto.reference || null },
    });
  }

  async updateProduct(
    ctx: RequestContext,
    id: string,
    dto: UpdateProductDto,
  ) {
    const existing = await this.prisma.product.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Article introuvable');

    if (dto.reference && dto.reference !== existing.reference) {
      const duplicate = await this.prisma.product.findFirst({
        where: {
          entityId: ctx.entityId,
          reference: dto.reference,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException('Cette référence existe déjà');
      }
    }

    // Changer le prix du catalogue n'affecte PAS les factures
    // déjà émises : leurs lignes portent leur propre prix.
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async deleteProduct(ctx: RequestContext, id: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Article introuvable');

    // La référence est libérée : l'unicité (entité, référence)
    // ne doit pas bloquer la recréation d'un article supprimé.
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), reference: null },
    });

    return { deleted: true };
  }

  // ==========================================================
  //  Privé
  // ==========================================================

  /**
   * Un client assujetti doit porter un NIU : il est obligatoire
   * sur la facture normalisée. On bloque à la saisie plutôt
   * qu'au moment de la validation, où c'est trop tard.
   */
  private assertNiuIfVatSubject(dto: {
    isVatSubject?: boolean;
    niu?: string | null;
  }) {
    if (dto.isVatSubject && !dto.niu) {
      throw new BadRequestException(
        'Le NIU est obligatoire pour un client assujetti à la TVA.',
      );
    }
  }
}
