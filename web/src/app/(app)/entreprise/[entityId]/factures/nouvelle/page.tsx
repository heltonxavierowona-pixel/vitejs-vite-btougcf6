'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { canEdit, useAuth } from '@/lib/auth-context';
import { InvoiceForm } from '@/components/invoice-form';
import { Loading } from '@/components/ui';

function NewInvoice() {
  const params = useParams<{ entityId: string }>();
  const searchParams = useSearchParams();
  const { current } = useAuth();

  const direction = searchParams.get('sens') === 'achat' ? 'PURCHASE' : 'SALE';

  return (
    <InvoiceForm
      // Changer de sens remet le formulaire à zéro.
      key={direction}
      entityId={params.entityId}
      direction={direction}
      canValidate={canEdit(current?.role)}
    />
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewInvoice />
    </Suspense>
  );
}
