'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Alert, Button, Loading, errorMessage } from '@/components/ui';

/**
 * Retour du navigateur après le paiement (Neero, Notch Pay, Stripe ou Flutterwave).
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
  // Stripe ajoute ?provider=stripe&session_id=cs_… (voir StripeBillingService)
  const stripeSession =
    searchParams.get('provider') === 'stripe' ? searchParams.get('session_id') : null;
  // Notch Pay : ?provider=notchpay&ref=<notre référence>, puis ses
  // propres paramètres (reference, status…).
  const notchRef =
    searchParams.get('provider') === 'notchpay' ? searchParams.get('ref') : null;
  // Neero : ?provider=neero&ref=<notre référence>[&statut=echec].
  // L'adresse ne prouve rien : l'API relit la transaction chez Neero.
  const neeroRef =
    searchParams.get('provider') === 'neero' ? searchParams.get('ref') : null;
  const neeroFailed = searchParams.get('statut') === 'echec';

  useEffect(() => {
    if (!current || started.current) return;
    started.current = true;

    if (neeroRef) {
      // Le paiement peut être validé sur le téléphone quelques
      // secondes après le retour : on redemande jusqu'à 6 fois.
      void (async () => {
        for (let attempt = 0; attempt < (neeroFailed ? 1 : 6); attempt++) {
          try {
            const result = await api.post<{ success: boolean; reason?: string }>(
              `/organizations/${current.organizationId}/subscription/confirm-neero`,
              { txRef: neeroRef },
            );
            if (result.success) {
              setState('success');
              return;
            }
            setMessage(result.reason ?? 'Le paiement n’a pas abouti.');
            if (result.reason && !/attente/i.test(result.reason)) break;
          } catch (err) {
            setMessage(errorMessage(err, 'Vérification du paiement impossible.'));
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        setState('failed');
      })();
      return;
    }

    if (notchRef) {
      // Le paiement Mobile Money peut être validé sur le téléphone
      // quelques secondes après le retour : on revérifie jusqu'à 4 fois.
      void (async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const result = await api.post<{ success: boolean; reason?: string }>(
              `/organizations/${current.organizationId}/subscription/confirm-notchpay`,
              { txRef: notchRef },
            );
            if (result.success) {
              setState('success');
              return;
            }
            setMessage(result.reason ?? 'Le paiement n’a pas abouti.');
            if (searchParams.get('status') === 'failed' || searchParams.get('status') === 'canceled') break;
          } catch (err) {
            setMessage(errorMessage(err, 'Vérification du paiement impossible.'));
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        setState('failed');
      })();
      return;
    }

    if (stripeSession) {
      // La confirmation peut prendre quelques secondes chez Stripe :
      // on relit la session jusqu'à trois fois.
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await api.post<{ success: boolean; reason?: string }>(
              `/organizations/${current.organizationId}/subscription/confirm-stripe`,
              { sessionId: stripeSession },
            );
            if (result.success) {
              setState('success');
              return;
            }
            setMessage(result.reason ?? 'Le paiement n’a pas abouti.');
          } catch (err) {
            setMessage(errorMessage(err, 'Vérification du paiement impossible.'));
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        setState('failed');
      })();
      return;
    }

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
  }, [current, status, txRef, transactionId, stripeSession, notchRef, neeroRef, neeroFailed, searchParams]);

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Paiement de l’abonnement</h1>

      {state === 'checking' && <Loading label="Paiement en cours de vérification…" />}

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
          <span className="tabular break-all">{neeroRef ?? notchRef ?? txRef ?? stripeSession ?? '—'}</span>.
        </Alert>
      )}

      {state === 'failed' && neeroRef && (
        <Link href="/abonnement">
          <Button>Réessayer le paiement</Button>
        </Link>
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
