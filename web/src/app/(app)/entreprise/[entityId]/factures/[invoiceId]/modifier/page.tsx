'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { api } from '@/lib/api';
import { canEdit, useAuth } from '@/lib/auth-context';
import { InvoiceForm, type EditableInvoice } from '@/components/invoice-form';
import { Alert, Loading, errorMessage } from '@/components/ui';

/** Modification d'un brouillon — une facture validée est immuable. */
export default function EditInvoicePage() {
  const { entityId, invoiceId } = useParams<{
    entityId: string;
    invoiceId: string;
  }>();
  const { current } = useAuth();
  const [invoice, setInvoice] = useState<(EditableInvoice & { status: string }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<EditableInvoice & { status: string }>(
        `/entities/${entityId}/invoices/${invoiceId}`,
      )
      .then(setInvoice)
      .catch((err) => setError(errorMessage(err, 'Facture introuvable')));
  }, [entityId, invoiceId]);

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!invoice) return <Loading />;

  if (invoice.status !== 'DRAFT') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Alert tone="warning">
          Cette facture est validée et ne peut plus être modifiée.{' '}
          <Link
            href={`/entreprise/${entityId}/factures/${invoiceId}`}
            className="font-medium underline"
          >
            Émettre un avoir depuis sa fiche
          </Link>
        </Alert>
      </div>
    );
  }

  return (
    <InvoiceForm
      entityId={entityId}
      direction={invoice.direction}
      invoice={invoice}
      canValidate={canEdit(current?.role)}
    />
  );
}
