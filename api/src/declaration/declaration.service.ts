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
  TaxRegime,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../auth/request-context';
import { computeDeclaration, roundToFranc } from '../tax/vat-calculator';
import { nonDeductibleReasons, serviceVatForPeriod } from '../tax/exigibility';
import {
  CREDIT_VALIDATION_MONTHS,
  TAXABLE_BASE_ROUNDING,
  VAT_RATES_BP,
} from '../tax/tax.constants';
import {
  daysUntilDue,
  estimateLatePenalty,
  monthsLate,
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

    await this.assertSubjectToVat(ctx.entityId);

    const { invoiceIds, result, turnoverExclVat, vatExcluded } =
      await this.aggregate(ctx.entityId, period);

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
      vatWithheld: result.vatWithheld,
      vatExcluded,
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
   * Ventes de BIENS : la TVA entre dans la période de la date
   * d'émission (exigibilité à la livraison, CGI art. 134-1-a), y
   * compris si la facture a été annulée depuis : c'est alors
   * l'avoir, daté de sa propre période, qui vient en déduction.
   *
   * Prestations de SERVICES : la TVA entre dans la période de
   * l'ENCAISSEMENT (art. 134-1-b), calculée par serviceVatForPeriod.
   *
   * Achats : la TVA est déductible dans la période de la facture,
   * sauf exclusions (facture sans NIU, achat ≥ 100 000 FCFA payé en
   * espèces, dépense exclue par nature), comptées à part.
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
        totalInclVat: true,
        partyNiu: true,
        vatNonDeductible: true,
        originalInvoiceId: true,
        originalInvoice: {
          select: {
            partyNiu: true,
            totalInclVat: true,
            vatNonDeductible: true,
            payments: { select: { method: true } },
          },
        },
        lines: { select: { isService: true, lineVat: true } },
        payments: { select: { method: true } },
      },
    });

    let vatCollected = 0;
    let vatDeductible = 0;
    let vatExcluded = 0;
    let turnoverExclVat = 0;

    for (const invoice of invoices) {
      // Un avoir vient en déduction : signe négatif.
      const sign = invoice.type === InvoiceType.CREDIT_NOTE ? -1 : 1;

      if (invoice.direction === InvoiceDirection.SALE) {
        turnoverExclVat += sign * invoice.subtotalExclVat;
        // La part services d'une facture, ou d'un avoir rattaché à
        // une facture, suit les encaissements (voir plus bas). Un
        // avoir isolé reste imputé à sa date.
        const servicesFollowCash =
          invoice.type === InvoiceType.INVOICE || !!invoice.originalInvoiceId;
        const serviceVat = servicesFollowCash
          ? invoice.lines
              .filter((l) => l.isService)
              .reduce((sum, l) => sum + l.lineVat, 0)
          : 0;
        vatCollected += sign * (invoice.vatAmount - serviceVat);
      } else {
        // Un avoir d'achat suit le sort de la facture d'origine.
        const source =
          invoice.type === InvoiceType.CREDIT_NOTE && invoice.originalInvoice
            ? invoice.originalInvoice
            : invoice;
        const excluded =
          nonDeductibleReasons({
            partyNiu: source.partyNiu,
            totalInclVat: source.totalInclVat,
            vatNonDeductible: source.vatNonDeductible,
            paymentMethods: source.payments.map((p) => p.method),
          }).length > 0;
        if (excluded) vatExcluded += sign * invoice.vatAmount;
        else vatDeductible += sign * invoice.vatAmount;
      }
    }

    vatCollected += await this.serviceVatCollected(entityId, start, end);
    const vatWithheld = await this.vatWithheldOn(entityId, start, end);

    // Report du crédit de la période précédente
    const previousCredit = await this.previousCarryForward(entityId, period);

    const result = computeDeclaration({
      vatCollected,
      vatDeductible,
      vatWithheld,
      previousCredit,
    });

    return {
      invoiceIds: invoices.map((i) => i.id),
      result,
      turnoverExclVat,
      vatExcluded: roundToFranc(vatExcluded),
    };
  }

  /**
   * TVA sur prestations de services exigible sur la période :
   * factures ayant reçu un règlement, ou un avoir, dans la période.
   */
  private async serviceVatCollected(entityId: string, start: Date, end: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        entityId,
        deletedAt: null,
        direction: InvoiceDirection.SALE,
        type: InvoiceType.INVOICE,
        status: { not: InvoiceStatus.DRAFT },
        number: { not: null },
        lines: { some: { isService: true, lineVat: { gt: 0 } } },
        OR: [
          { payments: { some: { paidAt: { gte: start, lt: end } } } },
          {
            creditNotes: {
              some: {
                deletedAt: null,
                number: { not: null },
                issuedAt: { gte: start, lt: end },
              },
            },
          },
        ],
      },
      select: {
        totalInclVat: true,
        lines: { select: { isService: true, lineVat: true, lineInclVat: true } },
        payments: { select: { paidAt: true, amount: true, vatWithheld: true } },
        creditNotes: {
          where: { deletedAt: null, number: { not: null } },
          select: {
            issuedAt: true,
            lines: { select: { isService: true, lineInclVat: true } },
          },
        },
      },
    });

    let total = 0;
    for (const invoice of invoices) {
      const services = invoice.lines.filter((l) => l.isService);
      total += serviceVatForPeriod(
        {
          totalInclVat: invoice.lines.reduce((sum, l) => sum + l.lineInclVat, 0),
          serviceInclVat: services.reduce((sum, l) => sum + l.lineInclVat, 0),
          serviceVat: services.reduce((sum, l) => sum + l.lineVat, 0),
          settlements: invoice.payments.map((p) => ({
            at: p.paidAt,
            amount: p.amount + p.vatWithheld,
          })),
          credits: invoice.creditNotes.map((c) => ({
            at: c.issuedAt,
            serviceInclVat: c.lines
              .filter((l) => l.isService)
              .reduce((sum, l) => sum + l.lineInclVat, 0),
          })),
        },
        start,
        end,
      );
    }
    return total;
  }

  /** TVA retenue à la source par les clients sur la période (CGI art. 149-2). */
  private async vatWithheldOn(entityId: string, start: Date, end: Date) {
    const sum = await this.prisma.invoicePayment.aggregate({
      where: {
        paidAt: { gte: start, lt: end },
        vatWithheld: { gt: 0 },
        invoice: {
          entityId,
          deletedAt: null,
          direction: InvoiceDirection.SALE,
        },
      },
      _sum: { vatWithheld: true },
    });
    return sum._sum.vatWithheld ?? 0;
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

    const [pendingDrafts, isStale, creditMonths, excludedPurchases, withoutDgi] = await Promise.all([
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
      this.creditMonths(ctx.entityId, period),
      this.excludedPurchases(ctx.entityId, start, end),
      this.withoutDgiReference(ctx.entityId, start, end),
    ]);

    return {
      ...declaration,
      periodLabel: formatPeriod(period),
      daysLeft,
      urgency: filed ? 'SAFE' : urgencyLevel(daysLeft),
      estimatedPenalty:
        !filed && daysLeft < 0
          ? estimateLatePenalty(declaration.vatDue, monthsLate(declaration.dueDate))
          : 0,
      pendingDrafts,
      isStale,
      // Base au taux général arrondie au millier de FCFA inférieur
      // (CGI art. 141), telle qu'à reporter sur le formulaire.
      taxableBase: this.taxableBase(declaration.vatCollected),
      creditMonths,
      creditNeedsValidation: creditMonths > CREDIT_VALIDATION_MONTHS,
      excludedPurchases,
      // Factures sans référence du système de facturation électronique
      // de la DGI (CGI art. 8 bis et 143, LPF art. L 8 bis).
      salesWithoutDgiReference: withoutDgi.SALE,
      purchasesWithoutDgiReference: withoutDgi.PURCHASE,
    };
  }

  private async withoutDgiReference(entityId: string, start: Date, end: Date) {
    const groups = await this.prisma.invoice.groupBy({
      by: ['direction'],
      where: {
        entityId,
        deletedAt: null,
        type: { in: [InvoiceType.INVOICE, InvoiceType.CREDIT_NOTE] },
        status: { not: InvoiceStatus.DRAFT },
        number: { not: null },
        issuedAt: { gte: start, lt: end },
        fiscalStamp: null,
      },
      _count: { _all: true },
    });
    const count = { SALE: 0, PURCHASE: 0 };
    for (const g of groups) count[g.direction] = g._count._all;
    return count;
  }

  private taxableBase(vatCollected: number): number {
    if (vatCollected <= 0) return 0;
    const base = Math.round((vatCollected * 10_000) / VAT_RATES_BP.STANDARD);
    return Math.floor(base / TAXABLE_BASE_ROUNDING) * TAXABLE_BASE_ROUNDING;
  }

  /** Achats de la période dont la TVA n'est pas déductible, avec la raison. */
  private async excludedPurchases(entityId: string, start: Date, end: Date) {
    const purchases = await this.prisma.invoice.findMany({
      where: {
        entityId,
        deletedAt: null,
        direction: InvoiceDirection.PURCHASE,
        type: InvoiceType.INVOICE,
        status: { not: InvoiceStatus.DRAFT },
        number: { not: null },
        issuedAt: { gte: start, lt: end },
        vatAmount: { gt: 0 },
      },
      select: {
        id: true,
        number: true,
        partyName: true,
        partyNiu: true,
        totalInclVat: true,
        vatAmount: true,
        vatNonDeductible: true,
        payments: { select: { method: true } },
      },
      orderBy: { issuedAt: 'asc' },
    });
    return purchases
      .map((p) => ({
        id: p.id,
        number: p.number,
        partyName: p.partyName,
        vatAmount: p.vatAmount,
        reasons: nonDeductibleReasons({
          partyNiu: p.partyNiu,
          totalInclVat: p.totalInclVat,
          vatNonDeductible: p.vatNonDeductible,
          paymentMethods: p.payments.map((x) => x.method),
        }),
      }))
      .filter((p) => p.reasons.length > 0);
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

  /** Seules les entreprises du régime réel déclarent la TVA (CGI art. 132). */
  private async assertSubjectToVat(entityId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { taxRegime: true },
    });
    if (entity?.taxRegime === TaxRegime.IGS) {
      throw new BadRequestException(
        'Votre entreprise relève de l’impôt général synthétique (IGS) : elle n’est ' +
          'pas soumise à la TVA et n’a pas de déclaration de TVA à déposer (CGI art. 132).',
      );
    }
  }

  /**
   * Nombre de mois consécutifs, jusqu'à la période incluse, se
   * terminant par un crédit reporté. Au-delà de 3 mois, le report
   * d'un crédit en commerce général exige une validation préalable
   * de l'administration (CGI art. 149-3).
   */
  private async creditMonths(entityId: string, period: Period) {
    const recent = await this.prisma.taxDeclaration.findMany({
      where: {
        entityId,
        deletedAt: null,
        OR: [
          { periodYear: { lt: period.year } },
          { periodYear: period.year, periodMonth: { lte: period.month } },
        ],
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      take: 24,
      select: { periodYear: true, periodMonth: true, carryForward: true },
    });
    let months = 0;
    let expected = period;
    for (const d of recent) {
      if (d.periodYear !== expected.year || d.periodMonth !== expected.month) break;
      if (d.carryForward <= 0) break;
      months += 1;
      expected = previousPeriod(expected);
    }
    return months;
  }

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
      vatWithheld: number;
      vatExcluded: number;
      turnoverExclVat: number;
    },
  ): Promise<boolean> {
    const { result, turnoverExclVat, vatExcluded } = await this.aggregate(entityId, {
      year: declaration.periodYear,
      month: declaration.periodMonth,
    });
    return (
      result.vatCollected !== declaration.vatCollected ||
      result.vatDeductible !== declaration.vatDeductible ||
      result.vatCredit !== declaration.vatCredit ||
      result.vatWithheld !== declaration.vatWithheld ||
      vatExcluded !== declaration.vatExcluded ||
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
