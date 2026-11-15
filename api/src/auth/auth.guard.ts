import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  sid: string; // session id — permet la révocation
}

/** Utilisateur authentifié, attaché à la requête par le guard. */
export interface AuthUser {
  id: string;
  email: string;
  sessionId: string;
}

/**
 * Vérifie le jeton d'accès ET que la session correspondante
 * n'a pas été révoquée. Un JWT seul n'est pas révocable : sans
 * cette vérification, une déconnexion ne déconnecte rien.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('Jeton manquant');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, isActive: true, deletedAt: true },
        },
      },
    });

    if (!session) throw new UnauthorizedException('Session expirée');
    if (!session.user.isActive || session.user.deletedAt) {
      throw new UnauthorizedException('Compte désactivé');
    }

    const user: AuthUser = {
      id: session.user.id,
      email: session.user.email,
      sessionId: session.id,
    };
    (request as Request & { user: AuthUser }).user = user;

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] =
      request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
