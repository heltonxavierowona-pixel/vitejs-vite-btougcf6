import { Injectable } from '@nestjs/common';
import { DeclarationStatus, OrganizationType, TaxRegime } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  daysUntilDue,
  estimateLatePenalty,
  monthsLate,
  formatPeriod,
  urgencyLevel,
  vatDueDate,
  Period,
} from '../tax/deadline.util';

/**
 * ============================================================
 *  DASHBOARD
 * ============================================================
 *
 *  Deux vues RADICALEMENT différentes, volontairement séparées :
 *
 *  - CABINET   : « qui risque une pénalité cette semaine ? »
 *                Portefeuille, tri par urgence, charge par
 *                collaborateur.
 *
 *  - ENTREPRISE: « où j'en suis ? »
 *                Ma prochaine échéance, mes factures, mes
 *                impayés. AUCUNE liste d'entreprises.
 *
 *  Le socle (factures, TVA, DGI) est commun ; seule cette
 *  couche de présentation diverge.
 * ============================================================
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================
  //  VUE CABINET
  // ==========================================================

  async cabinetOverview(
    organizationId: string,
    userId: string,
    period?: Period,
  ) {
    const target = period ?? this.currentDeclarablePeriod();
    const dueDate = vatDueDate(target);
    const daysLeft = daysUntilDue(dueDate);

    // Restriction éventuelle du collaborateur à une partie du
    // portefeuille.
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, deletedAt: null },
      include: { assignments: { select: { entityId: true } } },
    });

    const restrictedIds = membership?.assignments.map((a) => a.entityId);

    const entities = await this.prisma.entity.findMany({
      where: {
        organizationId,
        isActive: true,
        deletedAt: null,
        // Les dossiers à l'IGS n'ont pas de TVA (CGI art. 132).
        taxRegime: { not: TaxRegime.IGS },
        ...(restrictedIds?.length && { id: { in: restrictedIds } }),
      },
      select: {
        id: true,
        legalName: true,
        niu: true,
        taxRegime: true,
        isVatSubject: true,
        declarations: {
          where: {
            periodYear: target.year,
            periodMonth: target.month,
            deletedAt: null,
          },
          select: {
            id: true,
            status: true,
            vatDue: true,
            carryForward: true,
            submittedAt: true,
            receiptRef: true,
          },
        },
        assignments: {
          select: {
            membership: {
              select: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
        _count: {
          select: {
            invoices: {
              where: { status: 'DRAFT', deletedAt: null },
            },
          },
        },
      },
      orderBy: { legalName: 'asc' },
    });

    const rows = entities.map((entity) => {
      const declaration = entity.declarations[0];
      const status = declaration?.status ?? DeclarationStatus.PENDING;
      const done =
        status === DeclarationStatus.SUBMITTED ||
        status === DeclarationStatus.PAID;

      return {
        entityId: entity.id,
        legalName: entity.legalName,
        niu: entity.niu,
        taxRegime: entity.taxRegime,
        isVatSubject: entity.isVatSubject,
        declarationId: declaration?.id ?? null,
        status,
        vatDue: declaration?.vatDue ?? 0,
        carryForward: declaration?.carryForward ?? 0,
        receiptRef: declaration?.receiptRef ?? null,
        // Un brouillon non validé ne compte pas dans la
        // déclaration : c'est le blocage le plus fréquent.
        pendingDrafts: entity._count.invoices,
        assignedTo: entity.assignments.map((a) => ({
          id: a.membership.user.id,
          name: `${a.membership.user.firstName} ${a.membership.user.lastName}`,
        })),
        urgency: done ? 'SAFE' : urgencyLevel(daysLeft),
      };
    });

    const submitted = rows.filter(
      (r) =>
        r.status === DeclarationStatus.SUBMITTED ||
        r.status === DeclarationStatus.PAID,
    );
    // En retard = échéance dépassée sans dépôt, que la déclaration
    // ait été préparée ou non.
    const late = rows.filter((r) => r.urgency === 'LATE');
    const blocked = rows.filter((r) => r.pendingDrafts > 0 && !submitted.includes(r));

    return {
      period: target,
      periodLabel: formatPeriod(target),
      dueDate,
      daysLeft,
      urgency: urgencyLevel(daysLeft),
      estimatedPenalties: late.reduce(
        (sum, r) => sum + estimateLatePenalty(r.vatDue, monthsLate(dueDate)),
        0,
      ),
      summary: {
        total: rows.length,
        submitted: submitted.length,
        pending: rows.length - submitted.length,
        late: late.length,
        blocked: blocked.length,
        totalVatDue: rows.reduce((sum, r) => sum + r.vatDue, 0),
      },
      // Tri par urgence : l'écran doit répondre en une seconde
      // à « qui risque une pénalité ? »
      portfolio: rows.sort((a, b) => {
        const order = { LATE: 0, CRITICAL: 1, URGENT: 2, SOON: 3, SAFE: 4 };
        return (
          order[a.urgency as keyof typeof order] -
          order[b.urgency as keyof typeof order]
        );
      }),
      workload: this.workloadByCollaborator(rows),
    };
  }

  // ==========================================================
  //  VUE ENTREPRISE
  // ==========================================================

  async entityOverview(entityId: string, period?: Period) {
    const target = period ?? this.currentDeclarablePeriod();
    const dueDate = vatDueDate(target);
    const daysLeft = daysUntilDue(dueDate);

    const [entity, declaration, drafts, unpaid, recent] = await Promise.all([
      this.prisma.entity.findUnique({
        where: { id: entityId },
        select: { taxRegime: true },
      }),
      this.prisma.taxDeclaration.findFirst({
        where: {
          entityId,
          periodYear: target.year,
          periodMonth: target.month,
          deletedAt: null,
        },
      }),
      this.prisma.invoice.count({
        where: { entityId, status: 'DRAFT', deletedAt: null },
      }),
      this.prisma.invoice.findMany({
        where: {
          entityId,
          direction: 'SALE',
          type: 'INVOICE',
          status: { in: ['VALIDATED', 'SENT', 'PARTIALLY_PAID'] },
          deletedAt: null,
        },
        select: {
          id: true,
          number: true,
          partyName: true,
          dueAt: true,
          totalInclVat: true,
          paidAmount: true,
          creditNotes: {
            where: { deletedAt: null },
            select: { totalInclVat: true },
          },
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { issuedAt: 'asc' }],
      }),
      this.prisma.invoice.findMany({
        where: { entityId, deletedAt: null },
        select: {
          id: true,
          number: true,
          direction: true,
          type: true,
          partyName: true,
          issuedAt: true,
          totalInclVat: true,
          status: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    // Solde dû = TTC − avoirs partiels − règlements.
    const open = unpaid
      .map(({ creditNotes, ...invoice }) => ({
        ...invoice,
        balanceDue:
          invoice.totalInclVat -
          invoice.paidAmount -
          creditNotes.reduce((sum, c) => sum + c.totalInclVat, 0),
      }))
      .filter((invoice) => invoice.balanceDue > 0);

    const receivable = open.reduce((sum, i) => sum + i.balanceDue, 0);
    const overdue = open.filter((i) => i.dueAt && i.dueAt < new Date());

    return {
      period: target,
      periodLabel: formatPeriod(target),
      // Entreprise à l'IGS : pas de TVA ni de déclaration (CGI art. 132).
      vatApplicable: entity?.taxRegime !== TaxRegime.IGS,
      nextDeadline: {
        label: `Déclaration TVA ${formatPeriod(target)}`,
        dueDate,
        daysLeft,
        urgency:
          declaration?.status === DeclarationStatus.SUBMITTED ||
          declaration?.status === DeclarationStatus.PAID
            ? 'SAFE'
            : urgencyLevel(daysLeft),
        status: declaration?.status ?? DeclarationStatus.PENDING,
        vatDue: declaration?.vatDue ?? 0,
      },
      // Point d'action n°1 : un brouillon n'entre pas dans la
      // déclaration tant qu'il n'est pas validé.
      pendingDrafts: drafts,
      receivables: {
        totalOutstanding: receivable,
        overdueCount: overdue.length,
        overdueAmount: overdue.reduce((sum, i) => sum + i.balanceDue, 0),
        items: open.slice(0, 10),
      },
      recentInvoices: recent.map(({ customer, supplier, ...invoice }) => ({
        ...invoice,
        partyName: invoice.partyName ?? customer?.name ?? supplier?.name ?? null,
      })),
    };
  }

  // ==========================================================
  //  Routage
  // ==========================================================

  /** Détermine quelle vue servir selon le type d'organisation. */
  async resolveView(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        type: true,
        entities: {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    });

    return {
      view:
        organization?.type === OrganizationType.CABINET
          ? 'CABINET'
          : 'ENTREPRISE',
      defaultEntityId: organization?.entities[0]?.id ?? null,
    };
  }

  // ==========================================================
  //  Privé
  // ==========================================================

  /**
   * Période courante à déclarer = mois précédent.
   * En mai, on déclare avril (échéance le 15 mai).
   */
  private currentDeclarablePeriod(): Period {
    const now = new Date();
    const month = now.getUTCMonth(); // 0-indexé => mois précédent
    return month === 0
      ? { year: now.getUTCFullYear() - 1, month: 12 }
      : { year: now.getUTCFullYear(), month };
  }

  private workloadByCollaborator(rows: any[]) {
    const map = new Map<
      string,
      { id: string; name: string; total: number; done: number }
    >();

    for (const row of rows) {
      for (const user of row.assignedTo) {
        const entry =
          map.get(user.id) ?? { id: user.id, name: user.name, total: 0, done: 0 };
        entry.total += 1;
        if (
          row.status === DeclarationStatus.SUBMITTED ||
          row.status === DeclarationStatus.PAID
        ) {
          entry.done += 1;
        }
        map.set(user.id, entry);
      }
    }

    return [...map.values()].sort(
      (a, b) => b.total - b.done - (a.total - a.done),
    );
  }
}
