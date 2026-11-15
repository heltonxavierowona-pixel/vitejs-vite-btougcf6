import { Module } from '@nestjs/common';

import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceNumberingService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
