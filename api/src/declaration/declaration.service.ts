import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DeclarationStatus,
  DeclarationType,
  InvoiceDirection,
  InvoiceStatus,
  InvoiceType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../auth/request-context';
import { computeDeclaration } from '../tax/vat-calculator';
import {
  daysUntilDue,
  estimateLatePenalty,
  formatPeriod,
  previousPeriod,
  urgencyLevel,
  vatDueDate,
  Period,
} from '../tax/deadline.util';
import { SubmitDeclarationDto } from './dto/declaration.dto';

/**
 * ============================================================
 *  DÉCLARATION TVA MENSUELLE
 * ============================================================
 *
 *  C'est le cœur de valeur du produit : transformer un mois de
 *  factures en une déclaration prête à déposer avant le 15.
 *
 *  RÈGLES :
 *  1. Seules les factures VALIDÉES entrent dans la déclaration.
 *     Un brouillon n'existe pas fiscalement.
 *  2. Les factures ANNULÉES sont exclues ; les AVOIRS sont
 *     soustraits.
 *  3. Le crédit de la période précédente est repris
 *     automatiquement.
 *  4. Une déclaration SUBMITTED est figée. On ne recalcule plus.
 *  5. Une période sans opération produit une déclaration NÉANT,
 *     qui reste OBLIGATOIRE (amende de 50 000 FCFA si omise).
 * ============================================================
 */
@Injectable()
export class DeclarationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------
  //  Calcul / rafraîchissement
  // ----------------------------------------------------------

  /**
   * Crée ou recalcule la déclaration d'une période à partir des
   * factures validées. Idempotent tant que la déclaration n'est
   * pas déposée.
   */
  async computeForPeriod(ctx: RequestContext, period: Period) {
    this.assertValidPeriod(period);

    const existing = await this.prisma.taxDeclaration.findFirst({
      where: {
        entityId: ctx.entityId,
        periodYear: period.year,
        periodMonth: period.month,
        deletedAt: null,
      },
    });

    if (existing && this.isFiled(existing.status)) {
      throw new ConflictException(
        'Cette déclaration a déjà été déposée et ne peut plus être recalculée.',
      );
    }

    const { invoiceIds, result, turnoverExclVat } = await this.aggregate(
      ctx.entityId,
      period,
    );

    const dueDate = vatDueDate(period);

    const data = {
      type: result.isNil
        ? DeclarationType.VAT_NIL
        : DeclarationType.VAT_MONTHLY,
      // Un recalcul remet la déclaration « en cours » : les montants
      // ont pu changer, elle doit être relue avant d'être déposée.
      status:
        dueDate < new Date()
          ? DeclarationStatus.LATE
          : DeclarationStatus.IN_PROGRESS,
      dueDate,
      vatCollected: result.vatCollected,
      vatDeductible: result.vatDeductible,
      vatCredit: result.vatCredit,
      vatDue: result.vatDue,
      carryForward: result.carryForward,
      turnoverExclVat,
    };

    const declaration = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.taxDeclaration.update({
            where: { id: existing.id },
            data,
          })
        : await tx.taxDeclaration.create({
            data: {
              entityId: ctx.entityId,
              periodYear: period.year,
              periodMonth: period.month,
              ...data,
            },
          });

      // Rattachement des factures à la déclaration : trace de ce
      // qui a été déclaré, utile en cas de contrôle. Les factures
      // qui n'en font plus partie sont détachées.
      await tx.invoice.updateMany({
        where: { declarationId: saved.id, id: { notIn: invoiceIds } },
        data: { declarationId: null },
      });
      await tx.invoice.updateMany({
        where: { id: { in: invoiceIds } },
        data: { declarationId: saved.id },
      });

      return saved;
    });

    await this.audit.log(
      ctx,
      existing ? AuditAction.UPDATE : AuditAction.CREATE,
      'TaxDeclaration',
      declaration.id,
      { after: declaration },
    );

    return {
      ...declaration,
      periodLabel: formatPeriod(period),
      invoiceCount: invoiceIds.length,
      isNil: result.isNil,
    };
  }

  /**
   * Agrège les opérations d'une période.
   *
   * Toute facture VALIDÉE entre dans la période de sa date
   * d'émission — y compris si elle a été annulée depuis : c'est
   * alors l'avoir, daté de sa propre période, qui vient en
   * déduction. Exclure la facture annulée ET soustraire l'avoir
   * reviendrait à retirer deux fois le même montant.
   */
  private async aggregate(entityId: string, period: Period) {
    const { start, end } = this.periodBounds(period);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        entityId,
        deletedAt: null,
        issuedAt: { gte: start, lt: end },
        type: { in: [InvoiceType.INVOICE, InvoiceType.CREDIT_NOTE] },
        status: { not: InvoiceStatus.DRAFT },
        number: { not: null },
      },
      select: {
        id: true,
        direction: true,
        type: true,
        vatAmount: true,
        subtotalExclVat: true,
      },
    });

    let vatCollected = 0;
    let vatDeductible = 0;
    let turnoverExclVat = 0;

    for (const invoice of invoices) {
      // Un avoir vient en déduction : signe négatif.
      const sign = invoice.type === InvoiceType.CREDIT_NOTE ? -1 : 1;

      if (invoice.direction === InvoiceDirection.SALE) {
        vatCollected += sign * invoice.vatAmount;
        turnoverExclVat += sign * invoice.subtotalExclVat;
      } else {
        vatDeductible += sign * invoice.vatAmount;
      }
    }

    // Report du crédit de la période précédente
    const previousCredit = await this.previousCarryForward(entityId, period);

    const result = computeDeclaration({
      vatCollected,
      vatDeductible,
      previousCredit,
    });

    return {
      invoiceIds: invoices.map((i) => i.id),
      result,
      turnoverExclVat,
    };
  }

  // ----------------------------------------------------------
  //  Lecture
  // ----------------------------------------------------------

  async findByPeriod(ctx: RequestContext, period: Period) {
    const declaration = await this.prisma.taxDeclaration.findFirst({
      where: {
        entityId: ctx.entityId,
        periodYear: period.year,
        periodMonth: period.month,
        deletedAt: null,
      },
      include: {
        invoices: {
          select: {
            id: true,
            number: true,
            direction: true,
            type: true,
            partyName: true,
            issuedAt: true,
            subtotalExclVat: true,
            vatAmount: true,
            totalInclVat: true,
          },
          orderBy: { issuedAt: 'asc' },
        },
        documents: true,
      },
    });

    if (!declaration) throw new NotFoundException('Déclaration introuvable');

    const daysLeft = daysUntilDue(declaration.dueDate);
    const { start, end } = this.periodBounds(period);
    const filed = this.isFiled(declaration.status);

    const [pendingDrafts, isStale] = await Promise.all([
      // Brouillons datés de la période : ils n'entrent pas dans la
      // déclaration tant qu'ils ne sont pas validés.
      this.prisma.invoice.count({
        where: {
          entityId: ctx.entityId,
          status: InvoiceStatus.DRAFT,
          deletedAt: null,
          issuedAt: { gte: start, lt: end },
        },
      }),
      filed ? Promise.resolve(false) : this.isStale(ctx.entityId, declaration),
    ]);

    return {
      ...declaration,
      periodLabel: formatPeriod(period),
      daysLeft,
      urgency: filed ? 'SAFE' : urgencyLevel(daysLeft),
      estimatedPenalty:
        !filed && daysLeft < 0 ? estimateLatePenalty(declaration.vatDue) : 0,
      pendingDrafts,
      isStale,
    };
  }

  async list(ctx: RequestContext, year?: number) {
    const declarations = await this.prisma.taxDeclaration.findMany({
      where: {
        entityId: ctx.entityId,
        deletedAt: null,
        ...(year && { periodYear: year }),
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });

    return declarations.map((d) => {
      const daysLeft = daysUntilDue(d.dueDate);
      return {
        ...d,
        periodLabel: formatPeriod({
          year: d.periodYear,
          month: d.periodMonth,
        }),
        daysLeft,
        urgency: this.isFiled(d.status) ? 'SAFE' : urgencyLevel(daysLeft),
      };
    });
  }

  // ----------------------------------------------------------
  //  Marquage « prête » puis dépôt
  // ----------------------------------------------------------

  async markReady(ctx: RequestContext, id: string) {
    const declaration = await this.getOwned(ctx, id);

    if (this.isFiled(declaration.status)) {
      throw new ConflictException('Déclaration déjà déposée');
    }
    if (await this.isStale(ctx.entityId, declaration)) {
      throw new ConflictException(
        'Des factures ont changé depuis le dernier calcul : recalculez la déclaration.',
      );
    }

    const updated = await this.prisma.taxDeclaration.update({
      where: { id },
      data: { status: DeclarationStatus.READY },
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'TaxDeclaration', id, {
      after: updated,
    });

    return updated;
  }

  /**
   * Enregistre le dépôt effectué sur le portail DGI.
   *
   * ⚠️ En V1 le dépôt est MANUEL : le contribuable dépose sur le
   * portail, puis saisit ici la référence de l'accusé. Aucune
   * API publique ne permet aujourd'hui le dépôt automatisé par
   * un tiers — cela suppose une homologation éditeur.
   */
  async submit(
    ctx: RequestContext,
    id: string,
    dto: SubmitDeclarationDto,
  ) {
    const declaration = await this.getOwned(ctx, id);

    if (this.isFiled(declaration.status)) {
      throw new ConflictException('Déclaration déjà déposée');
    }

    const submittedAt = new Date(dto.submittedAt);
    if (submittedAt.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('La date de dépôt ne peut pas être future.');
    }

    // Les montants enregistrés doivent être ceux réellement
    // déposés : si une facture a été validée depuis le calcul,
    // l'utilisateur doit recalculer et relire avant de confirmer.
    if (await this.isStale(ctx.entityId, declaration)) {
      throw new ConflictException(
        'Des factures ont changé depuis le dernier calcul : recalculez ' +
          'et vérifiez les montants avant d’enregistrer le dépôt.',
      );
    }

    const locked = await this.prisma.taxDeclaration.updateMany({
      where: {
        id,
        entityId: ctx.entityId,
        status: {
          notIn: [DeclarationStatus.SUBMITTED, DeclarationStatus.PAID],
        },
      },
      data: { status: DeclarationStatus.SUBMITTED },
    });
    if (locked.count === 0) {
      throw new ConflictException('Déclaration déjà déposée');
    }

    const updated = await this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        status: DeclarationStatus.SUBMITTED,
        submittedAt,
        submittedBy: ctx.userId,
        receiptRef: dto.receiptRef,
        receiptUrl: dto.receiptUrl,
        notes: dto.notes,
      },
    });

    // Une déclaration déposée clôt l'échéance correspondante.
    await this.prisma.deadline.updateMany({
      where: {
        entityId: ctx.entityId,
        kind: 'VAT',
        dueDate: declaration.dueDate,
        completedAt: null,
      },
      data: { completedAt: new Date() },
    });

    await this.audit.log(ctx, AuditAction.SUBMIT, 'TaxDeclaration', id, {
      before: declaration,
      after: updated,
    });

    return updated;
  }

  async markPaid(ctx: RequestContext, id: string, paidAt: string) {
    const declaration = await this.getOwned(ctx, id);

    if (declaration.status !== DeclarationStatus.SUBMITTED) {
      throw new BadRequestException(
        'Déposez la déclaration avant d’enregistrer le paiement.',
      );
    }

    const updated = await this.prisma.taxDeclaration.update({
      where: { id },
      data: { status: DeclarationStatus.PAID, paidAt: new Date(paidAt) },
    });

    await this.audit.log(ctx, AuditAction.UPDATE, 'TaxDeclaration', id, {
      before: declaration,
      after: updated,
    });

    return updated;
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private async getOwned(ctx: RequestContext, id: string) {
    const declaration = await this.prisma.taxDeclaration.findFirst({
      where: { id, entityId: ctx.entityId, deletedAt: null },
    });
    if (!declaration) throw new NotFoundException('Déclaration introuvable');
    return declaration;
  }

  /** Crédit reportable issu de la période précédente. */
  private async previousCarryForward(
    entityId: string,
    period: Period,
  ): Promise<number> {
    const prev = previousPeriod(period);

    const previous = await this.prisma.taxDeclaration.findFirst({
      where: {
        entityId,
        periodYear: prev.year,
        periodMonth: prev.month,
        deletedAt: null,
      },
      select: { carryForward: true },
    });

    return previous?.carryForward ?? 0;
  }

  /** Bornes [début, fin[ de la période, en UTC. */
  private periodBounds(period: Period) {
    return {
      start: new Date(Date.UTC(period.year, period.month - 1, 1)),
      end: new Date(Date.UTC(period.year, period.month, 1)),
    };
  }

  private isFiled(status: DeclarationStatus): boolean {
    return (
      status === DeclarationStatus.SUBMITTED ||
      status === DeclarationStatus.PAID
    );
  }

  /** Les montants enregistrés ne correspondent plus aux factures. */
  private async isStale(
    entityId: string,
    declaration: {
      periodYear: number;
      periodMonth: number;
      vatCollected: number;
      vatDeductible: number;
      vatCredit: number;
      turnoverExclVat: number;
    },
  ): Promise<boolean> {
    const { result, turnoverExclVat } = await this.aggregate(entityId, {
      year: declaration.periodYear,
      month: declaration.periodMonth,
    });
    return (
      result.vatCollected !== declaration.vatCollected ||
      result.vatDeductible !== declaration.vatDeductible ||
      result.vatCredit !== declaration.vatCredit ||
      turnoverExclVat !== declaration.turnoverExclVat
    );
  }

  private assertValidPeriod(period: Period) {
    if (period.month < 1 || period.month > 12) {
      throw new BadRequestException('Mois invalide');
    }
    if (period.year < 2000 || period.year > 2100) {
      throw new BadRequestException('Année invalide');
    }
    const now = new Date();
    const isFuture =
      period.year > now.getUTCFullYear() ||
      (period.year === now.getUTCFullYear() &&
        period.month > now.getUTCMonth() + 1);

    if (isFuture) {
      throw new BadRequestException(
        'Impossible de déclarer une période non échue.',
      );
    }
  }
}
