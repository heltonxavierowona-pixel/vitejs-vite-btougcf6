import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, OrganizationType, Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';

/**
 * ============================================================
 *  GESTION DES ENTITÉS
 * ============================================================
 *
 *  Une entité = une entreprise contribuable auprès de la DGI.
 *
 *  - Organisation ENTREPRISE : une seule entité, créée à
 *    l'inscription. On interdit la seconde.
 *  - Organisation CABINET : portefeuille de N entités, limité
 *    par le plan d'abonnement.
 *
 *  C'est le seul endroit du code où l'on manipule des entités
 *  sans passer par le TenancyGuard — parce qu'on en crée une
 *  qui n'existe pas encore. L'appartenance est donc vérifiée
 *  explicitement ici.
 * ============================================================
 */
@Injectable()
export class EntityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // ----------------------------------------------------------
  //  Lecture
  // ----------------------------------------------------------

  /** Entités visibles par l'utilisateur dans une organisation. */
  async list(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);
    const restricted = membership.assignments.map((a) => a.entityId);

    return this.prisma.entity.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(restricted.length && { id: { in: restricted } }),
      },
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        niu: true,
        taxRegime: true,
        isVatSubject: true,
        city: true,
        isActive: true,
        createdAt: true,
        _count: { select: { invoices: true, declarations: true } },
      },
      orderBy: { legalName: 'asc' },
    });
  }

  async findOne(userId: string, organizationId: string, entityId: string) {
    await this.requireEntityAccess(userId, organizationId, entityId);

    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, organizationId, deletedAt: null },
      include: {
        assignments: {
          select: {
            membership: {
              select: {
                id: true,
                role: true,
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    if (!entity) throw new NotFoundException('Entité introuvable');
    return entity;
  }

  // ----------------------------------------------------------
  //  Création
  // ----------------------------------------------------------

  async create(
    userId: string,
    organizationId: string,
    dto: CreateEntityDto,
  ) {
    const membership = await this.requireMembership(userId, organizationId);
    this.requireAdmin(membership.role);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        type: true,
        _count: {
          select: { entities: { where: { deletedAt: null } } },
        },
      },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');

    // Une PME n'a qu'une seule entité, par définition.
    if (
      organization.type === OrganizationType.ENTREPRISE &&
      organization._count.entities >= 1
    ) {
      throw new BadRequestException(
        'Un compte entreprise ne gère qu’une seule société. ' +
          'Passez en compte cabinet pour en gérer plusieurs.',
      );
    }

    // Abonnement en règle et limite du plan.
    await this.subscriptions.assertActive(organizationId);
    await this.subscriptions.assertCanAddEntity(organizationId);

    // Le NIU est unique au niveau national : deux organisations
    // ne peuvent pas gérer le même contribuable.
    const duplicate = await this.prisma.entity.findUnique({
      where: { niu: dto.niu },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ce NIU est déjà enregistré sur la plateforme.',
      );
    }

    const entity = await this.prisma.entity.create({
      data: { organizationId, ...dto },
    });

    await this.audit.log(
      { organizationId, entityId: entity.id, userId },
      AuditAction.CREATE,
      'Entity',
      entity.id,
      { after: entity },
    );

    return entity;
  }

  // ----------------------------------------------------------
  //  Modification
  // ----------------------------------------------------------

  async update(
    userId: string,
    organizationId: string,
    entityId: string,
    dto: UpdateEntityDto,
  ) {
    const membership = await this.requireEntityAccess(
      userId,
      organizationId,
      entityId,
    );
    this.requireAdmin(membership.role);

    const existing = await this.prisma.entity.findFirst({
      where: { id: entityId, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Entité introuvable');

    // Le NIU identifie le contribuable : le changer après des
    // factures émises rendrait l'historique incohérent.
    if (dto.niu && dto.niu !== existing.niu) {
      const duplicate = await this.prisma.entity.findUnique({
        where: { niu: dto.niu },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Ce NIU est déjà enregistré sur la plateforme.');
      }
      const invoiceCount = await this.prisma.invoice.count({
        where: { entityId, status: { not: 'DRAFT' }, deletedAt: null },
      });
      if (invoiceCount > 0) {
        throw new ConflictException(
          'Le NIU ne peut plus être modifié : des factures ont déjà été émises.',
        );
      }
    }

    // Idem pour la numérotation : la décaler créerait des
    // doublons ou des trous.
    const prefixChanged =
      (dto.invoicePrefix !== undefined &&
        dto.invoicePrefix !== existing.invoicePrefix) ||
      (dto.creditNotePrefix !== undefined &&
        dto.creditNotePrefix !== existing.creditNotePrefix);
    if (prefixChanged) {
      const issued = await this.prisma.invoice.count({
        where: { entityId, number: { not: null }, deletedAt: null },
      });
      if (issued > 0) {
        throw new ConflictException(
          'Le préfixe de numérotation ne peut plus être modifié.',
        );
      }
    }

    const updated = await this.prisma.entity.update({
      where: { id: entityId },
      data: dto,
    });

    await this.audit.log(
      { organizationId, entityId, userId },
      AuditAction.UPDATE,
      'Entity',
      entityId,
      { before: existing, after: updated },
    );

    return updated;
  }

  // ----------------------------------------------------------
  //  Archivage
  // ----------------------------------------------------------

  /**
   * On archive, on ne supprime jamais : les factures et
   * déclarations doivent rester consultables en cas de contrôle.
   */
  async archive(userId: string, organizationId: string, entityId: string) {
    const membership = await this.requireEntityAccess(
      userId,
      organizationId,
      entityId,
    );
    this.requireAdmin(membership.role);

    const pending = await this.prisma.taxDeclaration.count({
      where: {
        entityId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'READY', 'LATE'] },
        deletedAt: null,
      },
    });

    if (pending > 0) {
      throw new ConflictException(
        `${pending} déclaration(s) non déposée(s). ` +
          'Traitez-les avant d’archiver ce dossier.',
      );
    }

    const archived = await this.prisma.entity.update({
      where: { id: entityId },
      data: { isActive: false },
    });

    await this.audit.log(
      { organizationId, entityId, userId },
      AuditAction.UPDATE,
      'Entity',
      entityId,
      { after: { isActive: false } },
    );

    return archived;
  }

  async restore(userId: string, organizationId: string, entityId: string) {
    const membership = await this.requireEntityAccess(
      userId,
      organizationId,
      entityId,
    );
    this.requireAdmin(membership.role);

    await this.subscriptions.assertActive(organizationId);
    await this.subscriptions.assertCanAddEntity(organizationId);

    const restored = await this.prisma.entity.update({
      where: { id: entityId },
      data: { isActive: true },
    });

    await this.audit.log(
      { organizationId, entityId, userId },
      AuditAction.UPDATE,
      'Entity',
      entityId,
      { after: { isActive: true } },
    );

    return restored;
  }

  // ----------------------------------------------------------
  //  Affectation des collaborateurs
  // ----------------------------------------------------------

  /**
   * Restreint un collaborateur à certaines entités du
   * portefeuille. Une liste vide signifie « accès à tout ».
   */
  async assignCollaborator(
    userId: string,
    organizationId: string,
    membershipId: string,
    entityIds: string[],
  ) {
    const membership = await this.requireMembership(userId, organizationId);
    this.requireAdmin(membership.role);

    const target = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Collaborateur introuvable');

    // Toutes les entités doivent appartenir à cette organisation.
    const valid = await this.prisma.entity.count({
      where: { id: { in: entityIds }, organizationId, deletedAt: null },
    });
    if (valid !== entityIds.length) {
      throw new BadRequestException(
        'Une ou plusieurs entités n’appartiennent pas à votre organisation.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.entityAssignment.deleteMany({ where: { membershipId } });
      if (entityIds.length > 0) {
        await tx.entityAssignment.createMany({
          data: entityIds.map((entityId) => ({ membershipId, entityId })),
        });
      }
    });

    return { membershipId, assignedEntities: entityIds.length };
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private async requireMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, deletedAt: null },
      include: { assignments: { select: { entityId: true } } },
    });
    if (!membership) {
      throw new ForbiddenException('Accès refusé à cette organisation');
    }
    return membership;
  }

  /**
   * Vérifie que l'entité appartient BIEN à l'organisation de
   * l'URL, puis que l'utilisateur y a accès. Sans le premier
   * contrôle, un administrateur de l'organisation A pourrait
   * archiver ou restaurer une entité de l'organisation B en
   * mettant son identifiant dans l'URL.
   */
  private async requireEntityAccess(
    userId: string,
    organizationId: string,
    entityId: string,
  ) {
    const membership = await this.requireMembership(userId, organizationId);

    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!entity) throw new NotFoundException('Entité introuvable');

    if (membership.assignments.length > 0) {
      const allowed = membership.assignments.some(
        (a) => a.entityId === entityId,
      );
      if (!allowed) {
        throw new ForbiddenException('Vous n’êtes pas affecté·e à ce dossier');
      }
    }
    return membership;
  }

  private requireAdmin(role: Role) {
    if (role !== Role.OWNER && role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Seul un administrateur peut effectuer cette action',
      );
    }
  }
}
