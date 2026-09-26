import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { LegalForm, TaxRegime } from '@prisma/client';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateEntityDto {
  @Transform(trimUpper)
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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tradeName?: string;

  @IsEnum(LegalForm)
  legalForm: LegalForm;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rccm?: string;

  @IsEnum(TaxRegime)
  taxRegime: TaxRegime;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  taxCenter?: string;

  @IsOptional()
  @IsBoolean()
  isVatSubject?: boolean;

  @IsString()
  @MaxLength(255)
  address: string;

  @IsString()
  @MaxLength(120)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  poBox?: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  activity?: string;

  @IsOptional()
  @Transform(trimUpper)
  @Matches(/^[A-Z0-9]{1,10}$/, {
    message: 'Le préfixe ne contient que des lettres et chiffres (10 max).',
  })
  invoicePrefix?: string;

  @IsOptional()
  @Transform(trimUpper)
  @Matches(/^[A-Z0-9]{1,10}$/, {
    message: 'Le préfixe ne contient que des lettres et chiffres (10 max).',
  })
  creditNotePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStart?: number;
}

/** Mise à jour partielle : seuls les champs envoyés sont modifiés. */
export class UpdateEntityDto extends PartialType(CreateEntityDto) {}

export class AssignCollaboratorDto {
  @IsString()
  membershipId: string;

  /** Liste vide = accès à toutes les entités du portefeuille. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  entityIds: string[];
}
