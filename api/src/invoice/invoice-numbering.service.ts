import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDirection, InvoiceType, Prisma } from '@prisma/client';

/**
 * ============================================================
 *  NUMÉROTATION DES FACTURES
 * ============================================================
 *
 *  RÈGLES :
 *  1. Le numéro est attribué à la VALIDATION, jamais à la
 *     création. Un brouillon abandonné ne doit pas laisser de
 *     trou dans la séquence — un trou est un point de contrôle
 *     fiscal.
 *  2. Trois séquences PAR ENTITÉ, jamais globales :
 *       - factures de vente   FA-2026-00042
 *       - avoirs de vente     AV-2026-00003
 *       - achats (factures et avoirs fournisseurs), numéro
 *         d'enregistrement interne   AC-2026-00017
 *     Les achats ont leur propre séquence : un document reçu
 *     d'un fournisseur ne doit jamais consommer un numéro de la
 *     série des ventes.
 *  3. L'incrément se fait dans la MÊME transaction que la
 *     validation, avec verrou de ligne, pour éviter deux
 *     factures portant le même numéro en cas de saisie
 *     simultanée par deux collaborateurs.
 * ============================================================
 */

type Sequence = 'INVOICE' | 'CREDIT_NOTE' | 'PURCHASE';

const COLUMNS: Record<Sequence, { prefix: string; counter: string }> = {
  INVOICE: { prefix: 'invoicePrefix', counter: 'invoiceNextNumber' },
  CREDIT_NOTE: { prefix: 'creditNotePrefix', counter: 'creditNoteNextNum' },
  PURCHASE: { prefix: 'purchasePrefix', counter: 'purchaseNextNum' },
};

@Injectable()
export class InvoiceNumberingService {
  /**
   * Réserve le prochain numéro pour une entité.
   * DOIT être appelé à l'intérieur d'une transaction Prisma.
   */
  async nextNumber(
    tx: Prisma.TransactionClient,
    entityId: string,
    direction: InvoiceDirection,
    type: InvoiceType,
    issuedAt: Date,
  ): Promise<string> {
    const sequence: Sequence =
      direction === InvoiceDirection.PURCHASE
        ? 'PURCHASE'
        : type === InvoiceType.CREDIT_NOTE
          ? 'CREDIT_NOTE'
          : 'INVOICE';
    const { prefix: prefixColumn, counter: counterColumn } = COLUMNS[sequence];

    // Incrément atomique + verrou de ligne en une seule requête :
    // UPDATE ... RETURNING sérialise les validations concurrentes
    // sur la même entité. Les noms de colonnes viennent d'une
    // table fixe ci-dessus, jamais de l'utilisateur.
    const rows = await tx.$queryRawUnsafe<
      Array<{ prefix: string; current: number }>
    >(
      `UPDATE "entities"
          SET "${counterColumn}" = "${counterColumn}" + 1
        WHERE id = $1
        RETURNING "${prefixColumn}" AS prefix, "${counterColumn}" - 1 AS current`,
      entityId,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Entité introuvable');
    }

    const { prefix, current } = rows[0];
    const year = issuedAt.getUTCFullYear();
    const serial = String(current).padStart(5, '0');

    return `${prefix}-${year}-${serial}`;
  }
}
