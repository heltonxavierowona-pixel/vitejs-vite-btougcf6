import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
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
import { VatRate } from '@prisma/client';

export class CreatePartyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  /** Chaîne vide = effacer le NIU. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Le NIU ne contient que des lettres et des chiffres.',
  })
  niu?: string | null;

  @IsOptional()
  @IsBoolean()
  isVatSubject?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePartyDto extends CreatePartyDto {}

export class CreateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @IsString()
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Prix unitaire HT en centimes de FCFA. */
  @IsInt()
  @Min(0)
  @Max(10_000_000_000_000)
  unitPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsEnum(VatRate)
  vatRate: VatRate;

  @IsOptional()
  @IsBoolean()
  isService?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ListPartiesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
