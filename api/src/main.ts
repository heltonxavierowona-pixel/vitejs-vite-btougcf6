import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

/**
 * Refuse de démarrer sans secret JWT solide : un secret vide
 * permettrait à n'importe qui de forger des jetons valides.
 */
function assertEnvironment() {
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error(
      'JWT_ACCESS_SECRET absent ou trop court (32 caractères minimum). ' +
        'Générez-en un avec : openssl rand -base64 48',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL non configurée');
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // ConfigModule a chargé .env à ce stade : on peut vérifier.
  assertEnvironment();

  app.setGlobalPrefix('api');

  // Derrière un reverse proxy (Nginx, Traefik…), req.ip doit être
  // l'IP du client et non celle du proxy : indispensable pour la
  // limitation de débit et le journal d'audit.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime les champs non déclarés dans les DTO
      forbidNonWhitelisted: true, // et rejette la requête s'il y en a
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new PrismaExceptionFilter());

  // Arrêt propre sur SIGTERM (Docker, Kubernetes) : les requêtes
  // en cours se terminent et Prisma ferme ses connexions.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`API démarrée sur le port ${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error instanceof Error ? error.message : error, 'Bootstrap');
  process.exit(1);
});
