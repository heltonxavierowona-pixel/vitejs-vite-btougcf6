import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'required_roles';

/**
 * Restreint une route à certains rôles.
 * Lu par le TenancyGuard, jamais par un guard séparé — le rôle
 * dépend de l'organisation, donc il ne peut être évalué qu'une
 * fois l'entité résolue.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
