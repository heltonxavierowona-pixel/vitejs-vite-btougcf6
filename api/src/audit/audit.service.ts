import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

interface AuditContext {
  organizationId: string;
  entityId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Journal d'audit — obligatoire en contexte comptable.
 *
 * PRINCIPE : une écriture d'audit qui échoue ne doit JAMAIS
 * faire échouer l'opération métier. On logue l'erreur et on
 * continue. Mieux vaut un trou dans le journal qu'une facture
 * perdue.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    ctx: AuditContext,
    action: AuditAction,
    targetType: string,
    targetId: string,
    data?: { before?: unknown; after?: unknown },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          entityId: ctx.entityId,
          userId: ctx.userId,
          action,
          targetType,
          targetId,
          before: data?.before ? this.redact(data.before) : undefined,
          after: data?.after ? this.redact(data.after) : undefined,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `Échec d'écriture du journal d'audit (${targetType}/${targetId})`,
        error as Error,
      );
    }
  }

  /** Retire les champs sensibles avant stockage. */
  private redact(value: unknown): any {
    const blocked = ['passwordHash', 'token', 'refreshToken', 'secret'];
    return JSON.parse(
      JSON.stringify(value, (key, val) =>
        blocked.includes(key) ? '[REDACTED]' : val,
      ),
    );
  }

  /** Historique d'un objet — affiché dans la fiche facture. */
  async history(organizationId: string, targetType: string, targetId: string) {
    return this.prisma.auditLog.findMany({
      where: { organizationId, targetType, targetId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
