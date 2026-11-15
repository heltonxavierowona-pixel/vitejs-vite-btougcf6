import { Role } from '@prisma/client';

/**
 * Contexte d'appel construit par le TenancyGuard.
 * C'est la SEULE source d'entityId pour les services métier.
 */
export interface RequestContext {
  organizationId: string;
  entityId: string;
  userId: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}
