import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Traduit les erreurs Prisma connues en réponses HTTP lisibles,
 * au lieu d'une erreur 500 opaque. Les autres restent des 500,
 * journalisées sans exposer leur détail au client.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const mapped: Record<string, [number, string]> = {
      P2002: [HttpStatus.CONFLICT, 'Cet enregistrement existe déjà.'],
      P2003: [HttpStatus.BAD_REQUEST, 'Référence vers un élément inexistant.'],
      P2025: [HttpStatus.NOT_FOUND, 'Élément introuvable.'],
    };

    // Doublon : message précis quand le champ en cause est connu.
    const target = String((error.meta?.target as string[] | string) ?? '');
    const duplicates: Array<[string, string]> = [
      ['email', 'Cette adresse e-mail est déjà utilisée.'],
      ['niu', 'Ce NIU est déjà enregistré sur la plateforme.'],
      ['reference', 'Cette référence existe déjà dans le catalogue.'],
      ['number', 'Ce numéro de facture existe déjà. Réessayez.'],
    ];
    if (error.code === 'P2002') {
      const known = duplicates.find(([field]) => target.includes(field));
      if (known) mapped.P2002 = [HttpStatus.CONFLICT, known[1]];
    }

    const [status, message] = mapped[error.code] ?? [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Une erreur interne est survenue.',
    ];

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${error.code} : ${error.message}`);
    }

    response.status(status).json({ statusCode: status, message });
  }
}
