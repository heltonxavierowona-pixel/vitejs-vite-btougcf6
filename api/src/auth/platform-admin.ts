import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

import type { AuthUser } from './auth.guard';

/**
 * Administrateurs de la plateforme (l'éditeur de Numera, pas les
 * administrateurs d'une organisation cliente) : adresses e-mail
 * listées dans PLATFORM_ADMIN_EMAILS, séparées par des virgules.
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  return !!email && platformAdminEmails().includes(email.trim().toLowerCase());
}

/** À placer APRÈS AuthGuard, qui attache l'utilisateur à la requête. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!isPlatformAdmin(request.user?.email)) {
      throw new ForbiddenException('Réservé à l’administrateur de la plateforme');
    }
    return true;
  }
}
