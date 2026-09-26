import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  InvoiceDirection,
  InvoiceStatus,
  PaymentMethod,
  VatRate,
} from '@prisma/client';

/**
 * ⚠️ RAPPEL D'UNITÉS — toutes les valeurs numériques sont des entiers.
 *   unitPrice   : centimes de FCFA        (1 500 FCFA  => 150000)
 *   quantity    : millièmes               (1,5         => 1500)
 *   discountPct : centièmes de %          (12,5 %      => 1250)
 *
 * Les bornes maximales gardent tous les calculs dans la zone des
 * entiers sûrs de JavaScript (2^53).
 */

/** 100 milliards de FCFA, en centimes. */
const MAX_UNIT_PRICE = 10_000_000_000_000;
/** 1 million d'unités, en millièmes. */
const MAX_QUANTITY = 1_000_000_000;

export class InvoiceLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Quantité en millièmes. */
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;

  /** Prix unitaire HT en centimes de FCFA. */
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_PRICE)
  unitPrice: number;

  /** Remise en centièmes de % (max 10000 = 100 %). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountPct?: number;

  @IsEnum(VatRate)
  vatRate: VatRate;
}

export class CreateInvoiceDto {
  @IsEnum(InvoiceDirection)
  direction: InvoiceDirection;

  @IsDateString()
  issuedAt: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /** Requis si direction = SALE. */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Requis si direction = PURCHASE. */
  @IsOptional()
  @IsString()
  supplierId?: string;

  /** Achats : numéro inscrit sur la facture du fournisseur. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  supplierReference?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Une facture doit comporter au moins une ligne.' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;
}

/**
 * Un brouillon seul est modifiable. Voir InvoiceService.update().
 * Le sens (vente / achat) ne peut pas changer : il est vérifié
 * contre celui du brouillon.
 */
export class UpdateInvoiceDto extends CreateInvoiceDto {}

export class CreateCreditNoteDto {
  @IsDateString()
  issuedAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  /**
   * true  => avoir total, reprend toutes les lignes d'origine
   * false => avoir partiel, les lignes doivent être fournies
   */
  @IsBoolean()
  isFull: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}

export class RecordPaymentDto {
  /** Montant en centimes de FCFA. */
  @IsInt()
  @Min(1)
  @Max(MAX_UNIT_PRICE)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsDateString()
  paidAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ListInvoicesQueryDto {
  @IsOptional()
  @IsEnum(InvoiceDirection)
  direction?: InvoiceDirection;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
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
  @Max(100)
  pageSize?: number;
}
