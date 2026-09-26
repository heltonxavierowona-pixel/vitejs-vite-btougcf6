import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDirection, InvoiceStatus, InvoiceType } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { BRAND } from '../config/brand';
import { PrismaService } from '../prisma/prisma.service';
import { formatPeriod } from '../tax/deadline.util';
import { amountInWords } from './amount-in-words';

/**
 * ============================================================
 *  GÉNÉRATION DE DOCUMENTS
 * ============================================================
 *
 *  Mentions obligatoires sur une facture normalisée :
 *   - Identification complète de l'émetteur, NIU inclus
 *   - Identification du client, NIU si assujetti
 *   - Numéro et date de facture
 *   - Désignation, quantité, prix unitaire HT par ligne
 *   - Ventilation de la base et de la TVA par taux
 *   - Totaux HT, TVA, TTC
 *
 *  ⚠️ Le format exact du cachet fiscal / QR code exigé par la
 *  DGI dépend de l'homologation éditeur. L'emplacement est
 *  réservé ci-dessous mais le contenu n'est pas inventé.
 *
 *  MARQUE : la facture appartient à l'entreprise qui l'émet,
 *  pas à la plateforme. Aucun logo Numera dessus — seulement une
 *  mention discrète en pied de page.
 * ============================================================
 */

const MM = 2.8346; // 1 mm en points PDF
const PAGE_MARGIN = 15 * MM;
const CONTENT_WIDTH = 180 * MM;
const LEFT = PAGE_MARGIN;
const RIGHT = PAGE_MARGIN + CONTENT_WIDTH;

const INK = '#14201c';
const SOFT = '#5c6b66';
const LINE = '#d9dedb';

const VAT_LABELS: Record<string, string> = {
  STANDARD: 'TVA 19,25 %',
  ZERO: 'Taux zéro',
  EXEMPT: 'Exonéré',
};

const REGIME_LABELS: Record<string, string> = {
  IGS: 'Impôt général synthétique',
  RSI: 'Régime simplifié',
  REEL_NORMAL: 'Réel normal',
};

type Doc = PDFKit.PDFDocument;

@Injectable()
export class PdfService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------
  //  Facture / avoir
  // ----------------------------------------------------------

  async invoicePdf(
    entityId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, entityId, deletedAt: null },
      include: {
        lines: { orderBy: { position: 'asc' } },
        entity: true,
        customer: true,
        supplier: true,
        originalInvoice: { select: { number: true, issuedAt: true } },
      },
    });

    if (!invoice) throw new NotFoundException('Facture introuvable');

    const doc = this.createDocument(invoice.number ?? 'Brouillon');
    const entity = invoice.entity;
    const isCreditNote = invoice.type === InvoiceType.CREDIT_NOTE;
    const isPurchase = invoice.direction === InvoiceDirection.PURCHASE;
    const isDraft = invoice.status === InvoiceStatus.DRAFT;
    const party = invoice.customer ?? invoice.supplier;

    if (isDraft) this.watermark(doc, 'BROUILLON');

    // ---- En-tête : émetteur à gauche, document à droite ----
    const top = doc.y;
    const issuer = isPurchase
      ? {
          name: invoice.partyName ?? party?.name ?? '—',
          lines: [invoice.partyAddress ?? party?.address ?? null],
          niu: invoice.partyNiu ?? party?.niu ?? null,
        }
      : {
          name: entity.legalName,
          lines: [
            entity.tradeName,
            entity.address,
            `${entity.city}${entity.poBox ? ` — BP ${entity.poBox}` : ''}`,
            `Tél. ${entity.phone}${entity.email ? ` · ${entity.email}` : ''}`,
          ],
          niu: entity.niu,
        };

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14);
    doc.text(issuer.name, LEFT, top, { width: 100 * MM });
    doc.font('Helvetica').fontSize(9).fillColor(SOFT);
    for (const line of issuer.lines.filter(Boolean)) {
      doc.text(line as string, { width: 100 * MM });
    }
    if (issuer.niu) doc.text(`NIU : ${issuer.niu}`, { width: 100 * MM });
    if (!isPurchase) {
      if (entity.rccm) doc.text(`RCCM : ${entity.rccm}`);
      doc.text(
        `Régime : ${REGIME_LABELS[entity.taxRegime] ?? entity.taxRegime}` +
          (entity.taxCenter ? ` · ${entity.taxCenter}` : ''),
        { width: 100 * MM },
      );
    }
    const leftBottom = doc.y;

    const title = isPurchase
      ? isCreditNote
        ? 'AVOIR FOURNISSEUR'
        : 'FACTURE FOURNISSEUR'
      : isCreditNote
        ? 'AVOIR'
        : 'FACTURE';

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18);
    doc.text(title, 120 * MM, top, { width: 75 * MM, align: 'right' });
    doc.font('Helvetica').fontSize(9.5);
    const meta: string[] = [
      `N° ${invoice.number ?? '(brouillon — non numérotée)'}`,
      `Date : ${this.formatDate(invoice.issuedAt)}`,
    ];
    if (invoice.dueAt) meta.push(`Échéance : ${this.formatDate(invoice.dueAt)}`);
    if (isPurchase && invoice.supplierReference) {
      meta.push(`Réf. fournisseur : ${invoice.supplierReference}`);
    }
    if (isCreditNote && invoice.originalInvoice?.number) {
      meta.push(
        `Sur facture n° ${invoice.originalInvoice.number} ` +
          `du ${this.formatDate(invoice.originalInvoice.issuedAt)}`,
      );
    }
    for (const line of meta) {
      doc.text(line, 120 * MM, doc.y, { width: 75 * MM, align: 'right' });
    }

    doc.y = Math.max(leftBottom, doc.y) + 8 * MM;

    // ---- Destinataire ----
    // Identité FIGÉE à la validation, pas la fiche actuelle : une
    // facture émise ne change jamais.
    const recipient = isPurchase
      ? {
          label: 'Enregistrée par',
          name: entity.legalName,
          address: `${entity.address}, ${entity.city}`,
          niu: entity.niu,
        }
      : {
          label: 'Client',
          name: invoice.partyName ?? party?.name ?? '—',
          address:
            invoice.partyAddress ??
            ([party?.address, party?.city].filter(Boolean).join(', ') || null),
          niu: invoice.partyNiu ?? party?.niu ?? null,
        };

    const boxTop = doc.y;
    doc.font('Helvetica').fontSize(8).fillColor(SOFT);
    doc.text(recipient.label.toUpperCase(), 110 * MM, boxTop + 3 * MM, {
      width: 82 * MM,
    });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    doc.text(recipient.name, { width: 82 * MM });
    doc.font('Helvetica').fontSize(9);
    if (recipient.address) doc.text(recipient.address, { width: 82 * MM });
    if (recipient.niu) doc.text(`NIU : ${recipient.niu}`, { width: 82 * MM });
    const boxBottom = doc.y + 3 * MM;
    doc
      .lineWidth(0.5)
      .strokeColor(LINE)
      .rect(107 * MM, boxTop, 88 * MM, boxBottom - boxTop)
      .stroke();

    doc.y = boxBottom + 8 * MM;

    // ---- Lignes ----
    const cols = [
      { key: 'label', title: 'Désignation', x: LEFT, width: 78 * MM, align: 'left' as const },
      { key: 'qty', title: 'Qté', x: 94 * MM, width: 16 * MM, align: 'right' as const },
      { key: 'pu', title: 'P.U. HT', x: 111 * MM, width: 26 * MM, align: 'right' as const },
      { key: 'vat', title: 'TVA', x: 138 * MM, width: 20 * MM, align: 'right' as const },
      { key: 'total', title: 'Total HT', x: 159 * MM, width: 36 * MM, align: 'right' as const },
    ];

    const drawHeader = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SOFT);
      for (const col of cols) {
        doc.text(col.title, col.x, y, { width: col.width, align: col.align });
      }
      const lineY = doc.y + 2;
      doc.moveTo(LEFT, lineY).lineTo(RIGHT, lineY).strokeColor(INK).lineWidth(0.7).stroke();
      doc.y = lineY + 4;
    };

    drawHeader();

    for (const line of invoice.lines) {
      const label =
        line.label +
        (line.description ? `\n${line.description}` : '') +
        (line.discountPct ? `\nRemise ${this.formatPercent(line.discountPct)}` : '');

      doc.font('Helvetica').fontSize(9);
      const rowHeight = Math.max(
        doc.heightOfString(label, { width: cols[0].width }),
        12,
      );

      if (doc.y + rowHeight > doc.page.height - PAGE_MARGIN - 20 * MM) {
        doc.addPage();
        if (isDraft) this.watermark(doc, 'BROUILLON');
        drawHeader();
      }

      const y = doc.y;
      const values: Record<string, string> = {
        label,
        qty: this.formatQty(line.quantity),
        pu: this.formatMoney(line.unitPrice, true),
        vat: VAT_LABELS[line.vatRate]?.replace('TVA ', '') ?? line.vatRate,
        total: this.formatMoney(line.lineExclVat, true),
      };
      doc.fillColor(INK);
      for (const col of cols) {
        doc.text(values[col.key], col.x, y, { width: col.width, align: col.align });
      }
      doc.y = y + rowHeight + 4;
      doc.moveTo(LEFT, doc.y - 2).lineTo(RIGHT, doc.y - 2).strokeColor(LINE).lineWidth(0.4).stroke();
    }

    // ---- Totaux et ventilation ----
    if (doc.y > doc.page.height - PAGE_MARGIN - 70 * MM) doc.addPage();
    doc.y += 4 * MM;
    const summaryTop = doc.y;

    // Ventilation TVA par taux (mention obligatoire), à gauche
    const breakdown = this.breakdownByRate(invoice.lines);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SOFT);
    doc.text('VENTILATION DE LA TVA', LEFT, summaryTop, { width: 85 * MM });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    for (const row of breakdown) {
      doc.text(
        `${row.label} — base ${this.formatMoney(row.base)} · TVA ${this.formatMoney(row.vat)}`,
        LEFT,
        doc.y + 1,
        { width: 85 * MM },
      );
    }
    const breakdownBottom = doc.y;

    // Totaux à droite
    const totals: Array<[string, number, boolean]> = [
      ['Total HT', invoice.subtotalExclVat, false],
      ['TVA', invoice.vatAmount, false],
      [isCreditNote ? 'Total TTC de l’avoir' : 'Total TTC', invoice.totalInclVat, true],
    ];
    let y = summaryTop;
    for (const [label, amount, strong] of totals) {
      doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9.5);
      doc.fillColor(strong ? INK : SOFT).text(label, 115 * MM, y, { width: 40 * MM });
      doc.fillColor(INK).text(this.formatMoney(amount), 150 * MM, y, {
        width: 45 * MM,
        align: 'right',
      });
      y = doc.y + (strong ? 0 : 2);
      if (label === 'TVA') {
        doc.moveTo(115 * MM, y).lineTo(RIGHT, y).strokeColor(INK).lineWidth(0.7).stroke();
        y += 4;
      }
    }

    doc.y = Math.max(breakdownBottom, y) + 6 * MM;

    if (!isPurchase) {
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text(
        `${isCreditNote ? 'Arrêté le présent avoir' : 'Arrêtée la présente facture'} ` +
          `à la somme de ${amountInWords(Math.round(invoice.totalInclVat / 100))} ` +
          'francs CFA TTC.',
        LEFT,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    }

    // ---- Mentions ----
    for (const text of [invoice.terms, invoice.notes]) {
      if (!text) continue;
      doc.moveDown(0.8);
      doc.fontSize(8.5).fillColor(SOFT).text(text, LEFT, doc.y, { width: CONTENT_WIDTH });
    }

    // ---- Emplacement réservé : cachet fiscal / QR code ----
    // ⚠️ Contenu volontairement non inventé : dépend du format
    // imposé aux éditeurs homologués par la DGI.
    if (invoice.fiscalStamp) {
      doc.moveDown(1);
      doc.fontSize(8).fillColor(INK).text(`Référence de certification : ${invoice.fiscalStamp}`);
    }

    this.footer(doc, `Document émis avec ${BRAND.name}`);

    const filename = `${isCreditNote ? 'avoir' : 'facture'}-${
      invoice.number ?? `brouillon-${invoice.id.slice(0, 8)}`
    }.pdf`;
    return { buffer: await this.finish(doc), filename };
  }

  // ----------------------------------------------------------
  //  Déclaration TVA
  // ----------------------------------------------------------

  async declarationPdf(
    entityId: string,
    declarationId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const declaration = await this.prisma.taxDeclaration.findFirst({
      where: { id: declarationId, entityId, deletedAt: null },
      include: {
        entity: true,
        invoices: {
          select: {
            number: true,
            direction: true,
            type: true,
            partyName: true,
            partyNiu: true,
            issuedAt: true,
            subtotalExclVat: true,
            vatAmount: true,
          },
          orderBy: [{ direction: 'desc' }, { issuedAt: 'asc' }],
        },
      },
    });

    if (!declaration) throw new NotFoundException('Déclaration introuvable');

    const periodLabel = formatPeriod({
      year: declaration.periodYear,
      month: declaration.periodMonth,
    });
    const doc = this.createDocument(`Déclaration TVA ${periodLabel}`);
    const entity = declaration.entity;
    const filed =
      declaration.status === 'SUBMITTED' || declaration.status === 'PAID';

    if (!filed) this.watermark(doc, 'DOCUMENT DE TRAVAIL');

    doc.font('Helvetica').fontSize(8).fillColor(SOFT);
    doc.text(`${BRAND.name} — ${BRAND.tagline}`, LEFT, doc.y);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('DÉCLARATION DE TVA');
    doc.font('Helvetica').fontSize(11).text(periodLabel);
    doc.moveDown(1);

    doc.fontSize(9.5);
    const identity: Array<[string, string | null]> = [
      ['Contribuable', entity.legalName],
      ['NIU', entity.niu],
      ['Régime', REGIME_LABELS[entity.taxRegime] ?? entity.taxRegime],
      ['Centre des impôts', entity.taxCenter],
      ['Date limite de dépôt', this.formatDate(declaration.dueDate)],
      [
        'Dépôt',
        declaration.submittedAt
          ? `le ${this.formatDate(declaration.submittedAt)}` +
            (declaration.receiptRef ? ` · accusé ${declaration.receiptRef}` : '')
          : 'non déposée',
      ],
    ];
    for (const [label, value] of identity) {
      if (!value) continue;
      const y = doc.y;
      doc.fillColor(SOFT).text(label, LEFT, y, { width: 45 * MM });
      doc.fillColor(INK).text(value, LEFT + 45 * MM, y, { width: 135 * MM });
    }

    doc.moveDown(1.2);

    // ---- Liquidation ----
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Liquidation', LEFT);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10);

    const rows: Array<[string, number]> = [
      ['Chiffre d’affaires HT', declaration.turnoverExclVat],
      ['TVA collectée sur ventes', declaration.vatCollected],
      ['TVA déductible sur achats', declaration.vatDeductible],
      ['Crédit antérieur reporté', declaration.vatCredit],
    ];

    for (const [label, value] of rows) {
      const y = doc.y;
      doc.text(label, LEFT, y);
      doc.text(this.formatMoney(value), 120 * MM, y, { width: 75 * MM, align: 'right' });
      doc.moveDown(0.3);
    }

    doc.moveTo(LEFT, doc.y + 3).lineTo(RIGHT, doc.y + 3).strokeColor(INK).lineWidth(0.7).stroke();
    doc.moveDown(0.7);

    doc.font('Helvetica-Bold').fontSize(12);
    const resultY = doc.y;
    if (declaration.vatDue > 0) {
      doc.text('TVA NETTE À PAYER', LEFT, resultY);
      doc.text(this.formatMoney(declaration.vatDue), 120 * MM, resultY, {
        width: 75 * MM,
        align: 'right',
      });
    } else {
      doc.text('CRÉDIT REPORTABLE', LEFT, resultY);
      doc.text(this.formatMoney(declaration.carryForward), 120 * MM, resultY, {
        width: 75 * MM,
        align: 'right',
      });
    }

    if (declaration.type === 'VAT_NIL') {
      doc.moveDown(1);
      doc
        .fontSize(10)
        .font('Helvetica-Oblique')
        .text('Aucune opération imposable sur la période. Déclaration « néant ».', LEFT);
    }

    // ---- Détail des opérations ----
    if (declaration.invoices.length > 0) {
      doc.addPage();
      if (!filed) this.watermark(doc, 'DOCUMENT DE TRAVAIL');
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Détail des opérations', LEFT);
      doc.moveDown(0.6).fontSize(8).font('Helvetica');

      for (const inv of declaration.invoices) {
        const sign = inv.type === 'CREDIT_NOTE' ? '−' : '';
        const kind =
          (inv.direction === 'SALE' ? 'Vente' : 'Achat') +
          (inv.type === 'CREDIT_NOTE' ? ' (avoir)' : '');
        doc.text(
          `${this.formatDate(inv.issuedAt)} · ${inv.number ?? '—'} · ${kind} · ` +
            `${inv.partyName ?? '—'}${inv.partyNiu ? ` (${inv.partyNiu})` : ''} · ` +
            `HT ${sign}${this.formatMoney(inv.subtotalExclVat, true)} · ` +
            `TVA ${sign}${this.formatMoney(inv.vatAmount, true)}`,
          LEFT,
          doc.y,
          { width: CONTENT_WIDTH },
        );
      }
    }

    this.footer(doc, BRAND.documentFooter);

    return {
      buffer: await this.finish(doc),
      filename: `declaration-tva-${declaration.periodYear}-${String(
        declaration.periodMonth,
      ).padStart(2, '0')}.pdf`,
    };
  }

  // ----------------------------------------------------------
  //  Mise en page
  // ----------------------------------------------------------

  private createDocument(title: string): Doc {
    return new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true, // nécessaire au pied de page sur chaque feuille
      info: { Title: title, Producer: BRAND.name, Creator: BRAND.name },
    });
  }

  private watermark(doc: Doc, text: string) {
    const { x, y } = { x: doc.x, y: doc.y };
    doc.save();
    doc
      .rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .font('Helvetica-Bold')
      .fontSize(text.length > 12 ? 48 : 80)
      .fillColor('#94221a')
      .opacity(0.08)
      .text(text, 0, doc.page.height / 2 - 40, {
        width: doc.page.width,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
    doc.x = x;
    doc.y = y;
  }

  /** Pied de page sur toutes les feuilles, avec pagination. */
  private footer(doc: Doc, text: string) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // écrire dans la marge sans saut de page
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(SOFT)
        .text(
          `${text}${range.count > 1 ? ` — page ${i + 1}/${range.count}` : ''}`,
          LEFT,
          doc.page.height - PAGE_MARGIN + 3 * MM,
          { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
        );
      doc.page.margins.bottom = bottom;
    }
  }

  private finish(doc: Doc): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  // ----------------------------------------------------------
  //  Formatage
  // ----------------------------------------------------------

  /** Centimes de FCFA -> "1 250 000 FCFA" */
  private formatMoney(cents: number, bare = false): string {
    const francs = Math.round(cents / 100);
    // Espace simple : les polices PDF standard n'ont pas l'espace fine.
    const text = francs.toLocaleString('fr-FR').replace(/[  ]/g, ' ');
    return bare ? text : `${text} FCFA`;
  }

  /** Millièmes -> "1,5" */
  private formatQty(thousandths: number): string {
    const value = thousandths / 1000;
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/0+$/, '').replace('.', ',');
  }

  private formatPercent(hundredths: number): string {
    return `${String(hundredths / 100).replace('.', ',')} %`;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  }

  private breakdownByRate(
    lines: Array<{ vatRate: string; lineExclVat: number; lineVat: number }>,
  ) {
    const map = new Map<string, { base: number; vat: number }>();
    for (const line of lines) {
      const current = map.get(line.vatRate) ?? { base: 0, vat: 0 };
      current.base += line.lineExclVat;
      current.vat += line.lineVat;
      map.set(line.vatRate, current);
    }

    return [...map.entries()].map(([rate, v]) => ({
      label: VAT_LABELS[rate] ?? rate,
      base: v.base,
      vat: v.vat,
    }));
  }
}
