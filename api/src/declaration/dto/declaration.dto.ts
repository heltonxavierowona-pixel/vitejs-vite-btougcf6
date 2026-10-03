import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitDeclarationDto {
  @IsDateString()
  submittedAt: string;

  /** Référence de l'accusé délivré par le portail DGI. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  receiptRef?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class MarkPaidDto {
  @IsDateString()
  paidAt: string;
}
