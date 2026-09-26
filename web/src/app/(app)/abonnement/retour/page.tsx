'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Alert, Button, Loading, errorMessage } from '@/components/ui';

/**
 * Retour du navigateur après le paiement Flutterwave.
 *
 * Flutterwave ajoute ?status=…&tx_ref=…&transaction_id=… à l'URL.
 * Ce paramètre n'est PAS une preuve : l'API revérifie la
 * transaction auprès du fournisseur avant d'activer quoi que ce
 * soit. Le webhook fait la même chose en parallèle ; l'opération
 * est idempotente côté serveur.
 */
function PaymentReturn() {
  const searchParams = useSearchParams();
  const { current } = useAuth();
  const [state, setState] = useState<'checking' | 'success' | 'failed'>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const status = searchParams.get('status');
  const txRef = searchParams.get('tx_ref');
  const transactionId = searchParams.get('transaction_id');

  useEffect(() => {
    if (!current || started.current) return;
    started.current = true;

    if (status === 'cancelled') {
      setState('failed');
      setMessage('Paiement annulé. Aucun montant n’a été débité.');
      return;
    }
    if (!txRef || !transactionId) {
      setState('failed');
      setMessage('Informations de paiement manquantes dans l’adresse de retour.');
      return;
    }

    api
      .post<{ success: boolean; reason?: string }>(
        `/organizations/${current.organizationId}/subscription/confirm`,
        { txRef, transactionId },
      )
      .then((result) => {
        setState(result.success ? 'success' : 'failed');
        if (!result.success) {
          setMessage(result.reason ?? 'Le paiement n’a pas abouti.');
        }
      })
      .catch((err) => {
        setState('failed');
        setMessage(errorMessage(err, 'Vérification du paiement impossible.'));
      });
  }, [current, status, txRef, transactionId]);

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Paiement de l’abonnement</h1>

      {state === 'checking' && <Loading label="Vérification du paiement auprès de l’opérateur…" />}

      {state === 'success' && (
        <Alert tone="info">
          Paiement confirmé : votre abonnement est actif. Merci !
        </Alert>
      )}

      {state === 'failed' && (
        <Alert tone="error">
          {message} Si votre compte Mobile Money a été débité, la confirmation
          peut prendre quelques minutes : rechargez la page Abonnement plus tard
          ou contactez le support en indiquant la référence{' '}
          <span className="tabular">{txRef ?? '—'}</span>.
        </Alert>
      )}

      {state !== 'checking' && (
        <Link href="/abonnement">
          <Button variant="secondary">Retour à l’abonnement</Button>
        </Link>
      )}
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PaymentReturn />
    </Suspense>
  );
}
