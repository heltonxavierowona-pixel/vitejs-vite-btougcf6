import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injecte le RequestContext construit par le TenancyGuard.
 *
 * ⚠️ Les services ne doivent JAMAIS lire organizationId ou
 * entityId depuis le body ou la query. Uniquement d'ici.
 */
export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return request.ctx;
  },
);

/** Utilisateur authentifié, sans contexte d'entité. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    return context.switchToHttp().getRequest().user;
  },
);
