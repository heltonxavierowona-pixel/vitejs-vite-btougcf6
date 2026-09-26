import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import {
  canUseSubscription,
  SUBSCRIPTION_BLOCKED_MESSAGE,
} from '../subscription/access';
import { AuthUser } from './auth.guard';
import { RequestContext } from './request-context';
import { ROLES_KEY } from './roles.decorator';

/**
 * ============================================================
 *  TENANCY GUARD — LA PIÈCE CRITIQUE DE SÉCURITÉ
 * ============================================================
 *
 *  Sans ce guard, il suffit de changer l'identifiant d'entité
 *  dans l'URL pour lire les factures d'une autre entreprise.
 *  Dans un cabinet comptable, ce serait une fuite entre deux
 *  clients concurrents. Fatal.
 *
 *  Il vérifie, dans l'ordre :
 *   1. L'entité existe et est active.
 *   2. L'utilisateur est membre de l'organisation propriétaire.
 *   3. Si son membership est restreint à certaines entités,
 *      celle demandée en fait partie.
 *   4. Son rôle autorise l'action demandée.
 *   5. Pour une écriture : le dossier n'est pas archivé et
 *      l'abonnement de l'organisation est en règle.
 *
 *  Puis il construit le RequestContext que reçoivent tous les
 *  services. Aucun service ne doit lire entityId ailleurs.
 * ============================================================
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: AuthUser }).user;

    if (!user) throw new ForbiddenException('Authentification requise');

    const entityId = request.params.entityId;
    if (!entityId) {
      throw new ForbiddenException("Identifiant d'entité manquant");
    }

    // 1. L'entité existe-t-elle ?
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        organization: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        isActive: true,
        organization: {
          select: {
            subscription: {
              select: {
                status: true,
                currentPeriodEnd: true,
                gracePeriodEnd: true,
              },
            },
          },
        },
      },
    });

    // Volontairement un 404 et non un 403 : un 403 confirmerait
    // à un attaquant que l'entité existe.
    if (!entity) throw new NotFoundException('Entité introuvable');

    // 2. L'utilisateur est-il membre de l'organisation ?
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: entity.organizationId,
        deletedAt: null,
      },
      include: { assignments: { select: { entityId: true } } },
    });

    if (!membership) throw new NotFoundException('Entité introuvable');

    // 3. Membership restreint ? (cas du collaborateur de cabinet
    //    qui ne gère qu'une partie du portefeuille)
    if (membership.assignments.length > 0) {
      const allowed = membership.assignments.some(
        (a) => a.entityId === entityId,
      );
      if (!allowed) {
        throw new ForbiddenException(
          "Vous n'êtes pas affecté·e à ce dossier",
        );
      }
    }

    // 4. Contrôle de rôle
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length && !required.includes(membership.role)) {
      throw new ForbiddenException('Droits insuffisants pour cette action');
    }

    // 5. Écritures : dossier actif et abonnement en règle.
    //    La lecture reste toujours possible — les factures et
    //    déclarations doivent rester consultables en cas de
    //    contrôle, même dossier archivé ou abonnement suspendu.
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (isWrite) {
      if (!entity.isActive) {
        throw new ForbiddenException(
          'Ce dossier est archivé : il est consultable mais plus modifiable.',
        );
      }
      if (!canUseSubscription(entity.organization.subscription)) {
        throw new ForbiddenException(SUBSCRIPTION_BLOCKED_MESSAGE);
      }
    }

    // Contexte unique consommé par tous les services
    const ctx: RequestContext = {
      organizationId: entity.organizationId,
      entityId: entity.id,
      userId: user.id,
      role: membership.role,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
    (request as Request & { ctx: RequestContext }).ctx = ctx;

    return true;
  }
}
