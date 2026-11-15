import { Module } from '@nestjs/common';

import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { ExportService } from './export.service';

@Module({
  controllers: [PdfController],
  providers: [PdfService, ExportService],
  exports: [PdfService],
})
export class PdfModule {}
