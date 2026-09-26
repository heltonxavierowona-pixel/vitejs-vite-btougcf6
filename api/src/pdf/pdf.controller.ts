import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { PdfService } from './pdf.service';
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

@Controller('entities/:entityId')
@UseGuards(AuthGuard, TenancyGuard)
export class PdfController {
  constructor(private readonly pdf: PdfService) {}

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
