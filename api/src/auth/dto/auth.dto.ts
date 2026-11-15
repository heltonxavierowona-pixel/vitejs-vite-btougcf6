import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LegalForm, OrganizationType, TaxRegime } from '@prisma/client';

export class EntitySetupDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(30)
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Le NIU ne contient que des lettres et des chiffres.',
  })
  niu: string;

  @IsString()
  @MaxLength(255)
  legalName: string;

  @IsEnum(LegalForm)
  legalForm: LegalForm;

  @IsEnum(TaxRegime)
  taxRegime: TaxRegime;

  @IsOptional()
  @IsBoolean()
  isVatSubject?: boolean;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  address: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city: string;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(180)
  email: string;

  @IsString()
  @MinLength(10, {
    message: 'Le mot de passe doit contenir au moins 10 caractères',
  })
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  organizationName: string;

  /** Le choix qui détermine le dashboard affiché. */
  @IsEnum(OrganizationType)
  organizationType: OrganizationType;

  /** Requis si organizationType = ENTREPRISE. */
  @IsOptional()
  @ValidateNested()
  @Type(() => EntitySetupDto)
  entity?: EntitySetupDto;
}

export class LoginDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(180)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,128}$/, { message: 'Lien invalide ou expiré.' })
  token: string;

  @IsString()
  @MinLength(10, {
    message: 'Le mot de passe doit contenir au moins 10 caractères',
  })
  @MaxLength(128)
  password: string;
}
