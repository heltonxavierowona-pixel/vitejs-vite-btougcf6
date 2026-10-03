import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { InvoiceDirection } from '@prisma/client';
import { Response } from 'express';

import { PdfService } from './pdf.service';
import { ExportService } from './export.service';
import { AuthGuard } from '../auth/auth.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import { Ctx } from '../auth/context.decorator';
import { RequestContext } from '../auth/request-context';

function send(res: Response, buffer: Buffer, filename: string) {
  // Nom de fichier limité à des caractères sûrs dans l'en-tête.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${safe}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, no-store',
  });
  res.end(buffer);
}

function sendFile(
  res: Response,
  file: { buffer: Buffer; filename: string; contentType: string },
) {
  const safe = file.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${safe}"`,
    'Content-Length': String(file.buffer.length),
    'Cache-Control': 'private, no-store',
  });
  res.end(file.buffer);
}

@Controller('entities/:entityId')
@UseGuards(AuthGuard, TenancyGuard)
export class PdfController {
  constructor(
    private readonly pdf: PdfService,
    private readonly exports: ExportService,
  ) {}

  /** Facture en CSV, Excel ou XML, pour la reporter sans ressaisie. */
  @Get('invoices/:id/export')
  async invoiceExport(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    sendFile(
      res,
      await this.exports.invoice(ctx.entityId, id, ExportService.parseFormat(format)),
    );
  }

  /** Factures validées d'un mois, ventes ou achats. */
  @Get('exports/invoices')
  async periodExport(
    @Ctx() ctx: RequestContext,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('direction') direction: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    sendFile(
      res,
      await this.exports.period(
        ctx.entityId,
        Number(year),
        Number(month),
        direction === 'PURCHASE' ? InvoiceDirection.PURCHASE : InvoiceDirection.SALE,
        ExportService.parseFormat(format),
      ),
    );
  }

  @Get('invoices/:id/pdf')
  async invoice(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.pdf.invoicePdf(ctx.entityId, id);
    send(res, buffer, filename);
  }

  @Get('declarations/:id/pdf')
  async declaration(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.pdf.declarationPdf(ctx.entityId, id);
    send(res, buffer, filename);
  }
}
