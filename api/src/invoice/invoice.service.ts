import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DeclarationStatus,
  InvoiceDirection,
  InvoiceStatus,
  InvoiceType,
  PlanCode,
  Prisma,
  TaxRegime,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../auth/request-context';
import { AuditService } from '../audit/audit.service';
import { FREE_PLAN_MONTHLY_INVOICES } from '../subscription/plans';
import { InvoiceNumberingService } from './invoice-numbering.service';
import {
  computeInvoiceTotals,
  InvoiceTotals,
  LineInput,
  VatRateKey,
} from '../tax/vat-calculator';
import {
  CreateCreditNoteDto,
  CreateInvoiceDto,
  InvoiceLineDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';

/** Statuts d'une facture émise et non annulée. */
const ISSUED_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.VALIDATED,
  InvoiceStatus.SENT,
  InvoiceStatus.PAID,
  InvoiceStatus.PARTIALLY_PAID,
];

/**
 * ============================================================
 *  SERVICE FACTURATION
 * ============================================================
 *
 *  INVARIANTS ABSOLUS :
 *  1. Une facture VALIDATED est IMMUABLE. Toute correction
 *     passe par un avoir. Aucune exception, aucun mode admin.
 *  2. Toute requête filtre sur entityId. Une fuite entre deux
 *     clients d'un même cabinet serait fatale.
 *  3. Les montants sont recalculés côté serveur à partir des
 *     lignes. Les totaux envoyés par le client sont ignorés.
 *  4. Le cumul des avoirs ne dépasse jamais la facture d'origine.
 *  5. Aucune facture ne peut entrer dans une période dont la
 *     déclaration est déjà déposée : elle ne serait jamais
 *     déclarée.
 * ============================================================
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: InvoiceNumberingService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------
  //  Lecture
  // ----------------------------------------------------------

  async list(ctx: RequestContext, query: ListInvoicesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);

    const where: Prisma.InvoiceWhereInput = {
      entityId: ctx.entityId, // filtre de tenancy — non négociable
      deletedAt: null,
      ...(query.direction && { direction: query.direction }),
      ...(query.status && { status: query.status }),
      ...((query.from || query.to) && {
        issuedAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
      ...(query.search && {
        OR: [
          { number: { contains: query.search, mode: 'insensitive' } },
          { partyName: { contains: query.search, mode: 'insensitive' } },
          {
            supplierReference: { contains: query.search, mode: 'insensitive' },
          },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: {
          // Un brouillon n'a pas encore d'identité figée : on
          // affiche le nom actuel du tiers.
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map(({ customer, supplier, ...invoice }) => ({
        ...invoice,
        partyName: invoice.partyName ?? customer?.name ?? supplier?.name ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(ctx: RequestContext, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
      include: {
        lines: { orderBy: { position: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        customer: true,
        supplier: true,
        originalInvoice: { select: { id: true, number: true } },
        creditNotes: {
          where: { deletedAt: null },
          select: { id: true, number: true, totalInclVat: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Facture introuvable');

    const creditedAmount = invoice.creditNotes.reduce(
      (sum, note) => sum + note.totalInclVat,
      0,
    );

    return {
      ...invoice,
      creditedAmount,
      // Solde réellement dû : TTC − avoirs − règlements.
      balanceDue: Math.max(
        0,
        invoice.totalInclVat - creditedAmount - invoice.paidAmount,
      ),
    };
  }

  // ----------------------------------------------------------
  //  Création (toujours en brouillon)
  // ----------------------------------------------------------

  async create(ctx: RequestContext, dto: CreateInvoiceDto) {
    this.assertPartyProvided(dto.direction, dto.customerId, dto.supplierId);
    await this.assertPartyBelongsToEntity(ctx, dto);
    this.assertDates(dto.issuedAt, dto.dueAt);

    const totals = this.computeTotals(dto.lines);

    const invoice = await this.prisma.invoice.create({
      data: {
        entityId: ctx.entityId,
        direction: dto.direction,
        type: InvoiceType.INVOICE,
        status: InvoiceStatus.DRAFT, // jamais autre chose à la création
        issuedAt: new Date(dto.issuedAt),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        customerId:
          dto.direction === InvoiceDirection.SALE ? dto.customerId : null,
        supplierId:
          dto.direction === InvoiceDirection.PURCHASE ? dto.supplierId : null,
        supplierReference:
          dto.direction === InvoiceDirection.PURCHASE
            ? dto.supplierReference || null
            : null,
        vatNonDeductible:
          dto.direction === InvoiceDirection.PURCHASE && !!dto.vatNonDeductible,
        subtotalExclVat: totals.subtotalExclVat,
        vatAmount: totals.vatAmount,
        totalInclVat: totals.totalInclVat,
        notes: dto.notes,
        terms: dto.terms,
        lines: { create: this.lineRows(dto.lines, totals) },
      },
      include: { lines: true },
    });

    await this.audit.log(ctx, AuditAction.CREATE, 'Invoice', invoice.id, {
      after: invoice,
    });

    return invoice;
  }

  // ----------------------------------------------------------
  //  Modification — brouillon UNIQUEMENT
  // ----------------------------------------------------------

  async update(ctx: RequestContext, id: string, dto: UpdateInvoiceDto) {
    const existing = await this.findOne(ctx, id);

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Une facture validée ne peut pas être modifiée. ' +
          'Émettez un avoir pour la corriger.',
      );
    }
    if (dto.direction !== existing.direction) {
      throw new BadRequestException(
        'Le sens d’une facture (vente ou achat) ne peut pas être modifié.',
      );
    }

    this.assertPartyProvided(existing.direction, dto.customerId, dto.supplierId);
    await this.assertPartyBelongsToEntity(ctx, dto);
    this.assertDates(dto.issuedAt, dto.dueAt);

    const totals = this.computeTotals(dto.lines);
    const isSale = existing.direction === InvoiceDirection.SALE;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Garde-fou concurrent : si la facture a été validée entre
      // la lecture et l'écriture, on n'écrase rien.
      const locked = await tx.invoice.updateMany({
        where: { id, entityId: ctx.entityId, status: InvoiceStatus.DRAFT },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) {
        throw new ConflictException('Cette facture vient d’être validée.');
      }

      // Les lignes sont remplacées en bloc : plus simple et plus
      // sûr qu'un diff, et sans risque puisqu'on est en brouillon.
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });

      return tx.invoice.update({
        where: { id },
        data: {
          issuedAt: new Date(dto.issuedAt),
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          customerId: isSale ? dto.customerId : null,
          supplierId: isSale ? null : dto.supplierId,
          supplierReference: isSale ? null : dto.supplierReference || null,
          vatNonDeductible: !isSale && !!dto.vatNonDeductible,
          subtotalExclVat: totals.subtotalExclVat,
          vatAmount: totals.vatAmount,
          totalInclVat: totals.totalInclVat,
          notes: dto.notes ?? null,
          terms: dto.terms ?? null,
          lines: { create: this.lineRows(dto.lines, totals) },
        },
        include: { lines: true },
      });
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'Invoice', id, {
      before: existing,
      after: updated,
    });

    return updated;
  }

  // ----------------------------------------------------------
  //  Validation — point de non-retour
  // ----------------------------------------------------------

  async validate(ctx: RequestContext, id: string) {
    const existing = await this.findOne(ctx, id);

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException('Cette facture est déjà validée.');
    }
    if (existing.lines.length === 0) {
      throw new BadRequestException(
        'Une facture sans ligne ne peut pas être validée.',
      );
    }
    if (existing.totalInclVat <= 0) {
      throw new BadRequestException(
        'Une facture d’un montant nul ne peut pas être validée.',
      );
    }

    const isSale = existing.direction === InvoiceDirection.SALE;
    const party = isSale ? existing.customer : existing.supplier;

    if (!party || party.deletedAt) {
      throw new BadRequestException('Le tiers est obligatoire.');
    }

    // Facture normalisée : le NIU du client assujetti est requis.
    if (isSale && existing.customer?.isVatSubject && !existing.customer.niu) {
      throw new BadRequestException(
        'Le NIU du client assujetti est obligatoire sur une facture normalisée.',
      );
    }

    // Seules les entreprises du régime réel sont soumises à la TVA
    // (CGI art. 132) ; une TVA facturée à tort reste due (art. 134-2).
    if (isSale && existing.vatAmount > 0) {
      const entity = await this.prisma.entity.findUnique({
        where: { id: ctx.entityId },
        select: { taxRegime: true },
      });
      if (entity?.taxRegime === TaxRegime.IGS) {
        throw new BadRequestException(
          'Votre entreprise relève de l’impôt général synthétique (IGS) : elle ne ' +
            'doit pas facturer de TVA (CGI art. 132). Passez les lignes en « Exonéré » ' +
            'ou corrigez le régime fiscal dans les paramètres.',
        );
      }
    }

    await this.assertPeriodOpen(ctx.entityId, existing.issuedAt);
    if (isSale) await this.assertFreePlanQuota(ctx, existing.issuedAt);

    const validated = await this.prisma.$transaction(async (tx) => {
      // Verrou optimiste : deux validations simultanées ne peuvent
      // pas réussir toutes les deux (sinon deux numéros seraient
      // consommés pour la même facture).
      const locked = await tx.invoice.updateMany({
        where: { id, entityId: ctx.entityId, status: InvoiceStatus.DRAFT },
        data: { status: InvoiceStatus.VALIDATED },
      });
      if (locked.count === 0) {
        throw new ConflictException('Cette facture est déjà validée.');
      }

      const number = await this.numbering.nextNumber(
        tx,
        ctx.entityId,
        existing.direction,
        existing.type,
        existing.issuedAt,
      );

      return tx.invoice.update({
        where: { id },
        data: {
          number,
          validatedAt: new Date(),
          // Identité du tiers FIGÉE : une facture émise ne doit
          // pas changer si le client est renommé plus tard.
          partyName: party.name,
          partyNiu: party.niu,
          partyAddress: [party.address, party.city].filter(Boolean).join(', ') || null,
        },
        include: { lines: true },
      });
    });

    await this.audit.log(ctx, AuditAction.VALIDATE, 'Invoice', id, {
      before: existing,
      after: validated,
    });

    return validated;
  }

  // ----------------------------------------------------------
  //  Avoir — seule façon de corriger une facture validée
  // ----------------------------------------------------------

  async createCreditNote(
    ctx: RequestContext,
    invoiceId: string,
    dto: CreateCreditNoteDto,
  ) {
    const original = await this.findOne(ctx, invoiceId);

    if (original.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        "Un brouillon se supprime, il n'a pas besoin d'avoir.",
      );
    }
    if (original.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cette facture est déjà entièrement annulée par un avoir.',
      );
    }
    if (original.type === InvoiceType.CREDIT_NOTE) {
      throw new BadRequestException("On n'émet pas un avoir sur un avoir.");
    }

    const issuedAt = new Date(dto.issuedAt);
    if (issuedAt < this.startOfDay(original.issuedAt)) {
      throw new BadRequestException(
        'L’avoir ne peut pas être antérieur à la facture qu’il corrige.',
      );
    }
    await this.assertPeriodOpen(ctx.entityId, issuedAt);

    if (dto.isFull && original.creditedAmount > 0) {
      throw new BadRequestException(
        'Cette facture a déjà fait l’objet d’un avoir partiel : ' +
          'émettez un avoir partiel pour le solde.',
      );
    }

    const sourceLines: InvoiceLineDto[] = dto.isFull
      ? original.lines.map((l) => ({
          label: l.label,
          description: l.description ?? undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
          isService: l.isService,
          stateBorne: l.stateBorne,
        }))
      : (dto.lines ?? []);

    if (sourceLines.length === 0) {
      throw new BadRequestException('Un avoir partiel doit comporter des lignes.');
    }

    const totals = this.computeTotals(sourceLines);
    const remainingCreditable = original.totalInclVat - original.creditedAmount;

    if (totals.totalInclVat <= 0) {
      throw new BadRequestException('Un avoir d’un montant nul est sans objet.');
    }
    if (totals.totalInclVat > remainingCreditable) {
      throw new BadRequestException(
        `L’avoir dépasse le montant restant de la facture ` +
          `(${remainingCreditable / 100} FCFA TTC).`,
      );
    }

    const fullyCredited = totals.totalInclVat === remainingCreditable;

    const creditNote = await this.prisma.$transaction(async (tx) => {
      // Sérialise les avoirs concurrents sur la même facture.
      await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${original.id} FOR UPDATE`;
      const already = await tx.invoice.aggregate({
        where: { originalInvoiceId: original.id, deletedAt: null },
        _sum: { totalInclVat: true },
      });
      if ((already._sum.totalInclVat ?? 0) !== original.creditedAmount) {
        throw new ConflictException(
          'Un autre avoir vient d’être émis sur cette facture. Rechargez la page.',
        );
      }

      const number = await this.numbering.nextNumber(
        tx,
        ctx.entityId,
        original.direction,
        InvoiceType.CREDIT_NOTE,
        issuedAt,
      );

      const created = await tx.invoice.create({
        data: {
          entityId: ctx.entityId,
          direction: original.direction,
          type: InvoiceType.CREDIT_NOTE,
          status: InvoiceStatus.VALIDATED, // un avoir naît validé
          number,
          issuedAt,
          validatedAt: new Date(),
          customerId: original.customerId,
          supplierId: original.supplierId,
          partyName: original.partyName,
          partyNiu: original.partyNiu,
          partyAddress: original.partyAddress,
          originalInvoiceId: original.id,
          subtotalExclVat: totals.subtotalExclVat,
          vatAmount: totals.vatAmount,
          totalInclVat: totals.totalInclVat,
          notes: dto.reason,
          lines: { create: this.lineRows(sourceLines, totals) },
        },
        include: { lines: true },
      });

      // Une facture entièrement couverte par ses avoirs est annulée.
      if (fullyCredited) {
        await tx.invoice.update({
          where: { id: original.id },
          data: { status: InvoiceStatus.CANCELLED },
        });
      }

      return created;
    });

    await this.audit.log(ctx, AuditAction.CREATE, 'Invoice', creditNote.id, {
      after: creditNote,
    });
    await this.audit.log(
      ctx,
      fullyCredited ? AuditAction.CANCEL : AuditAction.UPDATE,
      'Invoice',
      original.id,
      { after: { creditNoteId: creditNote.id, fullyCredited } },
    );

    return creditNote;
  }

  // ----------------------------------------------------------
  //  Suppression — brouillon uniquement
  // ----------------------------------------------------------

  async remove(ctx: RequestContext, id: string) {
    const existing = await this.findOne(ctx, id);

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Une facture validée ne se supprime pas. Émettez un avoir.',
      );
    }

    const deleted = await this.prisma.invoice.updateMany({
      where: { id, entityId: ctx.entityId, status: InvoiceStatus.DRAFT },
      data: { deletedAt: new Date() }, // suppression logique
    });
    if (deleted.count === 0) {
      throw new ConflictException('Cette facture vient d’être validée.');
    }

    await this.audit.log(ctx, AuditAction.DELETE, 'Invoice', id, {
      before: existing,
    });

    return { deleted: true };
  }

  // ----------------------------------------------------------
  //  Règlements
  // ----------------------------------------------------------

  async recordPayment(
    ctx: RequestContext,
    invoiceId: string,
    dto: RecordPaymentDto,
  ) {
    const invoice = await this.findOne(ctx, invoiceId);

    if (invoice.type === InvoiceType.CREDIT_NOTE) {
      throw new BadRequestException('Un avoir ne se règle pas.');
    }
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        "Validez la facture avant d'enregistrer un règlement.",
      );
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cette facture est annulée.');
    }
    const vatWithheld = dto.vatWithheld ?? 0;
    if (vatWithheld > 0) {
      if (
        invoice.direction !== InvoiceDirection.SALE ||
        !invoice.customer?.withholdsVat
      ) {
        throw new BadRequestException(
          'La retenue à la source ne s’applique qu’aux clients qui retiennent la TVA ' +
            '(État, collectivités, entreprises publiques ou listées : CGI art. 149-2). ' +
            'Cochez cette option sur la fiche du client.',
        );
      }
      const alreadyWithheld = invoice.payments.reduce(
        (sum, p) => sum + p.vatWithheld,
        0,
      );
      if (alreadyWithheld + vatWithheld > invoice.vatAmount) {
        throw new BadRequestException(
          'La TVA retenue dépasse la TVA de la facture.',
        );
      }
    }
    // La retenue solde la facture au même titre qu'un encaissement.
    const settledNow = dto.amount + vatWithheld;
    if (settledNow > invoice.balanceDue) {
      throw new BadRequestException(
        `Le montant dépasse le solde restant dû (${invoice.balanceDue / 100} FCFA).`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const paidAmount = invoice.paidAmount + settledNow;
      const settled = paidAmount + invoice.creditedAmount >= invoice.totalInclVat;

      // Verrou optimiste : un second règlement saisi en même temps
      // ne peut pas faire dépasser le solde.
      const locked = await tx.invoice.updateMany({
        where: {
          id: invoiceId,
          entityId: ctx.entityId,
          paidAmount: invoice.paidAmount,
          status: { in: ISSUED_STATUSES },
        },
        data: {
          paidAmount,
          status: settled ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
        },
      });
      if (locked.count === 0) {
        throw new ConflictException(
          'La facture a été modifiée entre-temps. Rechargez la page.',
        );
      }

      await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          vatWithheld,
          method: dto.method,
          reference: dto.reference,
          paidAt: new Date(dto.paidAt),
          notes: dto.notes,
        },
      });

      return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'Invoice', invoiceId, {
      after: { payment: dto.amount, status: updated.status },
    });

    return updated;
  }

  /**
   * Enregistre la référence de la facture émise sur le système de
   * facturation électronique de la DGI. Seule une facture validée
   * peut en recevoir une : c'est une métadonnée de certification, les
   * montants restent figés. Chaque changement est tracé.
   */
  async setDgiReference(ctx: RequestContext, id: string, reference: string) {
    const invoice = await this.findOne(ctx, id);
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'Validez la facture avant d’enregistrer sa référence DGI.',
      );
    }
    const value = reference.trim();
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { fiscalStamp: value, certifiedAt: new Date() },
    });
    await this.audit.log(ctx, AuditAction.UPDATE, 'Invoice', id, {
      before: { fiscalStamp: invoice.fiscalStamp },
      after: { fiscalStamp: value },
    });
    return updated;
  }

  /** Historique d'audit d'une facture (fiche facture). */
  async history(ctx: RequestContext, id: string) {
    await this.findOne(ctx, id);
    return this.audit.history(ctx.organizationId, 'Invoice', id);
  }

  // ----------------------------------------------------------
  //  Helpers privés
  // ----------------------------------------------------------

  private computeTotals(lines: InvoiceLineDto[]): InvoiceTotals {
    const inputs: LineInput[] = lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountPct: line.discountPct,
      vatRate: line.vatRate as VatRateKey,
    }));
    try {
      return computeInvoiceTotals(inputs);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Ligne de facture invalide',
      );
    }
  }

  private lineRows(lines: InvoiceLineDto[], totals: InvoiceTotals) {
    return lines.map((line, index) => ({
      productId: line.productId ?? null,
      label: line.label,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct ?? 0,
      vatRate: line.vatRate,
      isService: !!line.isService,
      // La prise en charge ne concerne qu'une TVA effectivement due.
      stateBorne: !!line.stateBorne && line.vatRate === 'STANDARD',
      lineExclVat: totals.lines[index].exclVat,
      lineVat: totals.lines[index].vat,
      lineInclVat: totals.lines[index].inclVat,
      position: index,
    }));
  }

  private assertPartyProvided(
    direction: InvoiceDirection,
    customerId?: string,
    supplierId?: string,
  ) {
    if (direction === InvoiceDirection.SALE && !customerId) {
      throw new BadRequestException('Le client est obligatoire sur une vente.');
    }
    if (direction === InvoiceDirection.PURCHASE && !supplierId) {
      throw new BadRequestException(
        'Le fournisseur est obligatoire sur un achat.',
      );
    }
  }

  /** Empêche de rattacher un tiers appartenant à une autre entité. */
  private async assertPartyBelongsToEntity(
    ctx: RequestContext,
    dto: CreateInvoiceDto,
  ) {
    if (dto.direction === InvoiceDirection.SALE && dto.customerId) {
      const found = await this.prisma.customer.count({
        where: { id: dto.customerId, entityId: ctx.entityId, deletedAt: null },
      });
      if (!found) throw new NotFoundException('Client introuvable');
    }
    if (dto.direction === InvoiceDirection.PURCHASE && dto.supplierId) {
      const found = await this.prisma.supplier.count({
        where: { id: dto.supplierId, entityId: ctx.entityId, deletedAt: null },
      });
      if (!found) throw new NotFoundException('Fournisseur introuvable');
    }
    const productIds = [
      ...new Set(dto.lines.map((l) => l.productId).filter(Boolean)),
    ] as string[];
    if (productIds.length > 0) {
      const found = await this.prisma.product.count({
        where: { id: { in: productIds }, entityId: ctx.entityId },
      });
      if (found !== productIds.length) {
        throw new NotFoundException('Article introuvable');
      }
    }
  }

  private assertDates(issuedAt: string, dueAt?: string) {
    if (dueAt && new Date(dueAt) < this.startOfDay(new Date(issuedAt))) {
      throw new BadRequestException(
        'L’échéance de paiement ne peut pas précéder la date de facture.',
      );
    }
  }

  /**
   * Une facture datée d'un mois dont la déclaration est déjà
   * déposée ne serait jamais déclarée : on la refuse.
   */
  private async assertPeriodOpen(entityId: string, date: Date) {
    const closed = await this.prisma.taxDeclaration.findFirst({
      where: {
        entityId,
        periodYear: date.getUTCFullYear(),
        periodMonth: date.getUTCMonth() + 1,
        status: { in: [DeclarationStatus.SUBMITTED, DeclarationStatus.PAID] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (closed) {
      throw new ConflictException(
        'La déclaration de TVA de ce mois est déjà déposée. ' +
          'Datez le document dans une période ouverte.',
      );
    }
  }

  /** Plan gratuit : quota mensuel de factures de vente validées. */
  private async assertFreePlanQuota(ctx: RequestContext, issuedAt: Date) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { plan: true },
    });
    if (subscription?.plan !== PlanCode.FREE) return;

    const start = new Date(
      Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth() + 1, 1),
    );
    const count = await this.prisma.invoice.count({
      where: {
        entityId: ctx.entityId,
        direction: InvoiceDirection.SALE,
        type: InvoiceType.INVOICE,
        number: { not: null },
        issuedAt: { gte: start, lt: end },
        deletedAt: null,
      },
    });
    if (count >= FREE_PLAN_MONTHLY_INVOICES) {
      throw new ForbiddenException(
        `Le plan Découverte est limité à ${FREE_PLAN_MONTHLY_INVOICES} factures ` +
          'par mois. Passez au plan supérieur pour continuer.',
      );
    }
  }

  private startOfDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
