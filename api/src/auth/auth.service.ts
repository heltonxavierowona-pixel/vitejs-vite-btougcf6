import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  OrganizationType,
  Prisma,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';

import { isPlatformAdmin } from './platform-admin';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TRIAL_PLAN, PLANS } from '../subscription/plans';
import { LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';
import { NotifierService } from '../subscription/notifier.service';
import { BRAND } from '../config/brand';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;
const RESET_TTL_MINUTES = 60;

/**
 * Hash factice vérifié quand l'e-mail est inconnu : la réponse
 * prend alors le même temps que pour un mauvais mot de passe, ce
 * qui empêche de deviner quels e-mails sont inscrits.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= argon2.hash(randomBytes(16).toString('hex'), {
    type: argon2.argon2id,
  });
  return dummyHash;
}

/**
 * Le jeton de rafraîchissement n'est stocké qu'en empreinte : une
 * fuite de la base ne permet pas d'ouvrir les sessions.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifier: NotifierService,
  ) {}

  // ----------------------------------------------------------
  //  Mot de passe oublié
  // ----------------------------------------------------------

  /**
   * Envoie un lien de réinitialisation. La réponse est la même que
   * l'adresse soit inscrite ou non : impossible de deviner qui a un
   * compte.
   */
  async requestPasswordReset(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && user.isActive && !user.deletedAt) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.$transaction([
        // Un seul lien valable à la fois : les précédents sont annulés.
        this.prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
          },
        }),
      ]);

      const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');
      await this.notifier.sendEmail(
        user.email,
        `${BRAND.name} — réinitialisation de votre mot de passe`,
        [
          `Bonjour ${user.firstName},`,
          '',
          'Pour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure, une seule fois) :',
          `${frontend}/mot-de-passe/nouveau?token=${token}`,
          '',
          'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.',
        ].join('\n'),
      );
    }

    return {
      message:
        'Si un compte existe avec cette adresse, un e-mail vient de vous être envoyé. ' +
        'Pensez à regarder dans vos courriers indésirables.',
    };
  }

  /** Nouveau mot de passe ; toutes les sessions ouvertes sont fermées. */
  async resetPassword(dto: ResetPasswordDto) {
    const now = new Date();
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= now || !record.user.isActive || record.user.deletedAt) {
      throw new BadRequestException(
        'Ce lien est invalide ou a expiré. Faites une nouvelle demande.',
      );
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    await this.prisma.$transaction(async (tx) => {
      // Verrou : un lien ne sert qu'une fois, même en double clic.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Ce lien a déjà été utilisé. Faites une nouvelle demande.');
      }
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { message: 'Mot de passe modifié. Vous pouvez vous connecter.' };
  }

  /**
   * Inscription : crée l'utilisateur, son organisation et — pour
   * une PME — sa première entité, le tout dans une transaction.
   * Le choix ENTREPRISE / CABINET est fait ici et détermine le
   * dashboard affiché.
   */
  async register(dto: RegisterDto, meta: { ip?: string; ua?: string }) {
    const email = dto.email.trim().toLowerCase();

    if (dto.organizationType === OrganizationType.ENTREPRISE && !dto.entity) {
      throw new BadRequestException(
        'Les informations de la société sont obligatoires pour un compte entreprise.',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Cet e-mail est déjà utilisé');
    }

    if (dto.entity) {
      const duplicate = await this.prisma.entity.findUnique({
        where: { niu: dto.entity.niu },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException(
          'Ce NIU est déjà enregistré sur la plateforme.',
        );
      }
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone: dto.phone || null,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          type: dto.organizationType,
          slug: await this.uniqueSlug(tx, dto.organizationName),
          billingEmail: email,
          billingPhone: dto.phone ?? '',
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: Role.OWNER,
        },
      });

      // Une PME a une seule entité, créée d'emblée.
      // Un cabinet part d'un portefeuille vide.
      let entityId: string | null = null;
      if (
        dto.organizationType === OrganizationType.ENTREPRISE &&
        dto.entity
      ) {
        const entity = await tx.entity.create({
          data: {
            organizationId: organization.id,
            niu: dto.entity.niu,
            legalName: dto.entity.legalName,
            legalForm: dto.entity.legalForm,
            taxRegime: dto.entity.taxRegime,
            isVatSubject: dto.entity.isVatSubject ?? false,
            address: dto.entity.address,
            city: dto.entity.city,
            phone: dto.entity.phone,
            email,
          },
        });
        entityId = entity.id;
      }

      // Essai gratuit ouvert d'emblée : sans abonnement, aucune
      // entité ne pourrait être créée ni aucune facture saisie.
      const plan = PLANS[DEFAULT_TRIAL_PLAN[dto.organizationType]];
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + plan.trialDays);
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          plan: plan.code,
          status: SubscriptionStatus.TRIALING,
          maxEntities: plan.maxEntities,
          maxUsers: plan.maxUsers,
          priceAmount: plan.priceMonthly,
          trialEndsAt: trialEnd,
          currentPeriodEnd: trialEnd,
        },
      });

      return { user, organization, entityId };
    });

    const tokens = await this.issueSession(result.user.id, result.user.email, meta);

    await this.prisma.auditLog
      .create({
        data: {
          organizationId: result.organization.id,
          userId: result.user.id,
          action: AuditAction.CREATE,
          targetType: 'Organization',
          targetId: result.organization.id,
          ipAddress: meta.ip,
          userAgent: meta.ua,
        },
      })
      .catch(() => undefined);

    return {
      user: this.sanitize(result.user),
      memberships: await this.listMemberships(result.user.id),
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        type: result.organization.type,
      },
      entityId: result.entityId,
      ...tokens,
    };
  }

  async login(dto: LoginDto, meta: { ip?: string; ua?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    // Message ET durée identiques dans tous les cas : ne pas
    // révéler si l'e-mail existe.
    const invalid = new UnauthorizedException('Identifiants incorrects');
    const valid = await argon2
      .verify(user?.passwordHash ?? (await getDummyHash()), dto.password)
      .catch(() => false);
    if (!user || !valid || user.deletedAt || !user.isActive) throw invalid;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueSession(user.id, user.email, meta);
    const memberships = await this.listMemberships(user.id);

    if (memberships[0]) {
      await this.prisma.auditLog
        .create({
          data: {
            organizationId: memberships[0].organizationId,
            userId: user.id,
            action: AuditAction.LOGIN,
            targetType: 'User',
            targetId: user.id,
            ipAddress: meta.ip,
            userAgent: meta.ua,
          },
        })
        .catch(() => undefined); // l'audit ne doit jamais bloquer la connexion
    }

    return { user: this.sanitize(user), memberships, ...tokens };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * Rotation : chaque rafraîchissement émet un NOUVEAU jeton et
   * invalide l'ancien. Un jeton volé et rejoué après usage par
   * son propriétaire légitime ne fonctionne donc plus.
   */
  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findFirst({
      where: {
        token: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!session || !session.user.isActive || session.user.deletedAt) {
      throw new UnauthorizedException('Session invalide');
    }

    const nextToken = randomBytes(48).toString('base64url');
    const rotated = await this.prisma.session.updateMany({
      // Condition sur l'ancien jeton : deux rafraîchissements
      // simultanés ne peuvent pas réussir tous les deux.
      where: { id: session.id, token: hashToken(refreshToken) },
      data: { token: hashToken(nextToken) },
    });
    if (rotated.count === 0) {
      throw new UnauthorizedException('Session invalide');
    }

    const accessToken = await this.jwt.signAsync(
      { sub: session.userId, email: session.user.email, sid: session.id },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL },
    );

    return { accessToken, refreshToken: nextToken };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.sanitize(user);
  }

  /**
   * Organisations accessibles à l'utilisateur.
   * C'est cette réponse qui permet au front de router vers le
   * dashboard ENTREPRISE ou CABINET.
   */
  async listMemberships(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, deletedAt: null },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            slug: true,
            _count: { select: { entities: true } },
          },
        },
        assignments: { select: { entityId: true } },
      },
    });

    return memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationType: m.organization.type,
      role: m.role,
      entityCount: m.organization._count.entities,
      restrictedTo:
        m.assignments.length > 0
          ? m.assignments.map((a) => a.entityId)
          : null, // null = accès à toutes les entités
    }));
  }

  // ----------------------------------------------------------
  //  Privé
  // ----------------------------------------------------------

  private async issueSession(
    userId: string,
    email: string,
    meta: { ip?: string; ua?: string },
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TTL_DAYS);

    const session = await this.prisma.session.create({
      data: {
        userId,
        token: hashToken(refreshToken),
        expiresAt,
        ipAddress: meta.ip,
        userAgent: meta.ua,
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, sid: session.id },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL },
    );

    return { accessToken, refreshToken, expiresAt };
  }

  private async uniqueSlug(
    tx: Prisma.TransactionClient,
    name: string,
  ): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'organisation';

    let slug = base;
    let suffix = 1;
    while (await tx.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${++suffix}`;
    }
    return slug;
  }

  private sanitize<T extends { passwordHash: string; email: string }>(user: T) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safe } = user;
    // Affiche l'accès à l'écran d'administration de la plateforme.
    return { ...safe, isPlatformAdmin: isPlatformAdmin(user.email) };
  }
}
