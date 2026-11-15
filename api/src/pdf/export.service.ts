import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDirection, InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import { PrismaService } from '../prisma/prisma.service';

/**
 * ============================================================
 *  EXPORT DES FACTURES : CSV, Excel, XML
 * ============================================================
 *
 *  Sert à reporter les factures sur la plateforme de facturation
 *  électronique de la DGI (ou chez un comptable) sans ressaisie.
 *  Le format officiel de la DGI n'étant pas publié, on exporte
 *  toutes les mentions de l'article 150 du CGI, une ligne de
 *  tableau par ligne de facture.
 * ============================================================
 */

export type ExportFormat = 'csv' | 'xlsx' | 'xml';

const FORMATS: Record<ExportFormat, { type: string; ext: string }> = {
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  xml: { type: 'application/xml; charset=utf-8', ext: 'xml' },
};

const RATE_LABEL: Record<string, string> = {
  STANDARD: '19,25 %',
  ZERO: '0 %',
  EXEMPT: 'Exonérée',
};

const INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  entity: true,
  customer: true,
  supplier: true,
  originalInvoice: { select: { number: true } },
} satisfies Prisma.InvoiceInclude;

type FullInvoice = Prisma.InvoiceGetPayload<{ include: typeof INCLUDE }>;

/** Colonnes communes au CSV et à l'Excel. */
const COLUMNS: Array<{ header: string; key: string; width: number; money?: boolean }> = [
  { header: 'Numéro', key: 'number', width: 16 },
  { header: 'Type', key: 'type', width: 10 },
  { header: 'Sens', key: 'direction', width: 8 },
  { header: 'Date', key: 'date', width: 11 },
  { header: 'Échéance', key: 'dueDate', width: 11 },
  { header: 'Facture corrigée', key: 'original', width: 16 },
  { header: 'Émetteur', key: 'issuerName', width: 28 },
  { header: 'NIU émetteur', key: 'issuerNiu', width: 16 },
  { header: 'RCCM émetteur', key: 'issuerRccm', width: 18 },
  { header: 'Adresse émetteur', key: 'issuerAddress', width: 30 },
  { header: 'Client', key: 'clientName', width: 28 },
  { header: 'NIU client', key: 'clientNiu', width: 16 },
  { header: 'Adresse client', key: 'clientAddress', width: 30 },
  { header: 'Ligne', key: 'lineNo', width: 6 },
  { header: 'Désignation', key: 'label', width: 32 },
  { header: 'Nature', key: 'nature', width: 9 },
  { header: 'Quantité', key: 'quantity', width: 9 },
  { header: 'Prix unitaire HT', key: 'unitPrice', width: 14, money: true },
  { header: 'Remise %', key: 'discount', width: 9 },
  { header: 'Taux TVA', key: 'rate', width: 10 },
  { header: 'Mention', key: 'mention', width: 22 },
  { header: 'Total HT ligne', key: 'lineHt', width: 14, money: true },
  { header: 'TVA ligne', key: 'lineVat', width: 12, money: true },
  { header: 'Total TTC ligne', key: 'lineTtc', width: 14, money: true },
  { header: 'Total HT facture', key: 'totalHt', width: 15, money: true },
  { header: 'TVA facture', key: 'totalVat', width: 13, money: true },
  { header: 'Total TTC facture', key: 'totalTtc', width: 15, money: true },
  { header: 'Référence DGI', key: 'dgiRef', width: 20 },
];

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  static parseFormat(value: string | undefined): ExportFormat {
    if (value === 'csv' || value === 'xlsx' || value === 'xml') return value;
    throw new BadRequestException('Format attendu : csv, xlsx ou xml.');
  }

  /** Export d'une facture. */
  async invoice(entityId: string, invoiceId: string, format: ExportFormat) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, entityId, deletedAt: null },
      include: INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Facture introuvable');
    const base = invoice.number ?? `brouillon-${invoice.id.slice(0, 8)}`;
    return this.render([invoice], format, `facture-${base}`);
  }

  /** Export des factures validées d'un mois (ventes ou achats). */
  async period(
    entityId: string,
    year: number,
    month: number,
    direction: InvoiceDirection,
    format: ExportFormat,
  ) {
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
      throw new BadRequestException('Période invalide');
    }
    const invoices = await this.prisma.invoice.findMany({
      where: {
        entityId,
        deletedAt: null,
        direction,
        type: { in: [InvoiceType.INVOICE, InvoiceType.CREDIT_NOTE] },
        status: { not: InvoiceStatus.DRAFT },
        number: { not: null },
        issuedAt: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
      include: INCLUDE,
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
    });
    const kind = direction === InvoiceDirection.SALE ? 'ventes' : 'achats';
    return this.render(
      invoices,
      format,
      `${kind}-${year}-${String(month).padStart(2, '0')}`,
    );
  }

  // ----------------------------------------------------------

  private async render(invoices: FullInvoice[], format: ExportFormat, name: string) {
    const { type, ext } = FORMATS[format];
    let buffer: Buffer;
    if (format === 'csv') buffer = this.toCsv(invoices);
    else if (format === 'xlsx') buffer = await this.toXlsx(invoices);
    else buffer = this.toXml(invoices);
    return { buffer, filename: `${name}.${ext}`, contentType: type };
  }

  /** Une ligne de tableau par ligne de facture, montants en francs. */
  private rows(invoices: FullInvoice[]) {
    return invoices.flatMap((inv) => {
      const { issuer, client } = this.parties(inv);
      const sign = inv.type === InvoiceType.CREDIT_NOTE ? -1 : 1;
      return inv.lines.map((line, index) => ({
        number: inv.number ?? 'BROUILLON',
        type: inv.type === InvoiceType.CREDIT_NOTE ? 'Avoir' : 'Facture',
        direction: inv.direction === InvoiceDirection.SALE ? 'Vente' : 'Achat',
        date: this.date(inv.issuedAt),
        dueDate: inv.dueAt ? this.date(inv.dueAt) : '',
        original: inv.originalInvoice?.number ?? '',
        issuerName: issuer.name,
        issuerNiu: issuer.niu,
        issuerRccm: issuer.rccm,
        issuerAddress: issuer.address,
        clientName: client.name,
        clientNiu: client.niu,
        clientAddress: client.address,
        lineNo: index + 1,
        label: line.label,
        nature: line.isService ? 'Service' : 'Bien',
        quantity: line.quantity / 1000,
        unitPrice: this.francs(line.unitPrice),
        discount: line.discountPct / 100,
        rate: RATE_LABEL[line.vatRate] ?? line.vatRate,
        mention: line.vatRate === 'EXEMPT'
          ? 'Exonérée'
          : line.stateBorne
            ? 'Prise en charge État'
            : '',
        lineHt: sign * this.francs(line.lineExclVat),
        lineVat: sign * this.francs(line.lineVat),
        lineTtc: sign * this.francs(line.lineInclVat),
        totalHt: sign * this.francs(inv.subtotalExclVat),
        totalVat: sign * this.francs(inv.vatAmount),
        totalTtc: sign * this.francs(inv.totalInclVat),
        dgiRef: inv.fiscalStamp ?? '',
      }));
    });
  }

  private toCsv(invoices: FullInvoice[]): Buffer {
    const escape = (value: unknown) => {
      let text = value === null || value === undefined ? '' : String(value);
      if (typeof value === 'number') text = text.replace('.', ',');
      // Un tableur exécuterait une cellule commençant par = + - @.
      else if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      COLUMNS.map((c) => c.header).join(';'),
      ...this.rows(invoices).map((row) =>
        COLUMNS.map((c) => escape((row as Record<string, unknown>)[c.key])).join(';'),
      ),
    ];
    // BOM : Excel reconnaît ainsi l'UTF-8 (accents).
    return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
  }

  private async toXlsx(invoices: FullInvoice[]): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    book.creator = 'Numera';
    const sheet = book.addWorksheet('Factures', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
      style: c.money ? { numFmt: '#,##0' } : undefined,
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of this.rows(invoices)) sheet.addRow(row);
    const data = await book.xlsx.writeBuffer();
    return Buffer.from(data as ArrayBuffer);
  }

  private toXml(invoices: FullInvoice[]): Buffer {
    const x = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const tag = (name: string, value: unknown, indent: string) =>
      value === null || value === undefined || value === ''
        ? ''
        : `${indent}<${name}>${x(value)}</${name}>\n`;

    let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
    out += `<Factures generePar="Numera" date="${new Date().toISOString()}">\n`;
    for (const inv of invoices) {
      const { issuer, client } = this.parties(inv);
      out += `  <Facture type="${inv.type === InvoiceType.CREDIT_NOTE ? 'AVOIR' : 'FACTURE'}" sens="${
        inv.direction === InvoiceDirection.SALE ? 'VENTE' : 'ACHAT'
      }">\n`;
      out += tag('Numero', inv.number ?? 'BROUILLON', '    ');
      out += tag('Date', this.date(inv.issuedAt), '    ');
      out += tag('Echeance', inv.dueAt ? this.date(inv.dueAt) : '', '    ');
      out += tag('FactureCorrigee', inv.originalInvoice?.number, '    ');
      out += tag('ReferenceDGI', inv.fiscalStamp, '    ');
      out += '    <Emetteur>\n';
      out += tag('RaisonSociale', issuer.name, '      ');
      out += tag('NIU', issuer.niu, '      ');
      out += tag('RCCM', issuer.rccm, '      ');
      out += tag('Adresse', issuer.address, '      ');
      out += '    </Emetteur>\n    <Client>\n';
      out += tag('Nom', client.name, '      ');
      out += tag('NIU', client.niu, '      ');
      out += tag('Adresse', client.address, '      ');
      out += '    </Client>\n    <Lignes>\n';
      inv.lines.forEach((line, index) => {
        out += `      <Ligne numero="${index + 1}">\n`;
        out += tag('Designation', line.label, '        ');
        out += tag('Nature', line.isService ? 'SERVICE' : 'BIEN', '        ');
        out += tag('Quantite', line.quantity / 1000, '        ');
        out += tag('PrixUnitaireHT', this.francs(line.unitPrice), '        ');
        out += tag('RemisePourcent', line.discountPct ? line.discountPct / 100 : '', '        ');
        out += tag('TauxTVA', RATE_LABEL[line.vatRate] ?? line.vatRate, '        ');
        out += tag(
          'Mention',
          line.vatRate === 'EXEMPT' ? 'Exonérée' : line.stateBorne ? 'Prise en charge État' : '',
          '        ',
        );
        out += tag('MontantHT', this.francs(line.lineExclVat), '        ');
        out += tag('MontantTVA', this.francs(line.lineVat), '        ');
        out += tag('MontantTTC', this.francs(line.lineInclVat), '        ');
        out += '      </Ligne>\n';
      });
      out += '    </Lignes>\n    <Totaux devise="XAF">\n';
      out += tag('TotalHT', this.francs(inv.subtotalExclVat), '      ');
      out += tag('TotalTVA', this.francs(inv.vatAmount), '      ');
      out += tag('TotalTTC', this.francs(inv.totalInclVat), '      ');
      out += '    </Totaux>\n  </Facture>\n';
    }
    out += '</Factures>\n';
    return Buffer.from(out, 'utf8');
  }

  /** Émetteur et client selon le sens de la facture. */
  private parties(inv: FullInvoice) {
    const entity = {
      name: inv.entity.legalName,
      niu: inv.entity.niu,
      rccm: inv.entity.rccm ?? '',
      address: [inv.entity.address, inv.entity.city].filter(Boolean).join(', '),
    };
    const partyRecord = inv.customer ?? inv.supplier;
    const party = {
      name: inv.partyName ?? partyRecord?.name ?? '',
      niu: inv.partyNiu ?? partyRecord?.niu ?? '',
      rccm: '',
      address:
        inv.partyAddress ??
        ([partyRecord?.address, partyRecord?.city].filter(Boolean).join(', ') || ''),
    };
    return inv.direction === InvoiceDirection.SALE
      ? { issuer: entity, client: party }
      : { issuer: party, client: entity };
  }

  private francs(cents: number) {
    return Math.round(cents / 100);
  }

  private date(d: Date) {
    return d.toISOString().slice(0, 10);
  }
}
