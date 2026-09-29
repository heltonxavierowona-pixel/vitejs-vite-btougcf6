'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth-context';
import { formatDate, formatMoney } from '@/lib/format';
import {
  Alert,
  Button,
  Loading,
  Modal,
  PageHeader,
  Panel,
  errorMessage,
} from '@/components/ui';

type Provider = 'STRIPE' | 'FLUTTERWAVE';

interface Plan {
  code: string;
  label: string;
  priceMonthly: number;
  maxEntities: number | null;
  maxUsers: number | null;
  trialDays: number;
  features: string[];
}

interface Subscription {
  plan: Plan;
  status: string;
  canWrite: boolean;
  provider: Provider | 'MANUAL' | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  gracePeriodEnd: string | null;
  daysLeft: number;
  needsRenewal: boolean;
  usage: {
    entities: number;
    maxEntities: number | null;
    users: number;
    maxUsers: number | null;
  };
}

const statusLabel: Record<string, string> = {
  TRIALING: 'Période d’essai',
  ACTIVE: 'Actif',
  PAST_DUE: 'Paiement en attente',
  SUSPENDED: 'Suspendu',
  CANCELLED: 'Résilié',
};

const providerLabel: Record<Provider, string> = {
  STRIPE: 'Carte bancaire',
  FLUTTERWAVE: 'Mobile Money',
};

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SubscriptionView />
    </Suspense>
  );
}

function SubscriptionView() {
  const { current } = useAuth();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    searchParams.get('paiement') === 'annule'
      ? 'Paiement annulé : aucun montant n’a été débité.'
      : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const base = `/organizations/${current?.organizationId}/subscription`;

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const [catalog, sub] = await Promise.all([
        api.get<{ providers: Provider[]; plans: Plan[] }>(`${base}/plans`),
        api.get<Subscription | null>(base),
      ]);
      setPlans(catalog.plans);
      setProviders(catalog.providers);
      setSubscription(sub);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [current, base]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Redirige vers la page de paiement hébergée par le prestataire. */
  async function subscribe(planCode: string, provider?: Provider) {
    setBusy(`${planCode}-${provider ?? ''}`);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ paymentUrl: string | null }>(`${base}/checkout`, {
        plan: planCode,
        ...(provider && { provider }),
      });
      if (result.paymentUrl) {
        // On ne manipule jamais les identifiants de carte ou de
        // Mobile Money : tout se passe chez Stripe ou Flutterwave.
        window.location.href = result.paymentUrl;
        return;
      }
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Paiement impossible.'));
    }
    setBusy(null);
  }

  async function action(key: string, path: string, message?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await api.post(`${base}/${path}`);
      await load();
      if (message) setNotice(message);
    } catch (err) {
      setError(errorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  }

  async function openPortal() {
    setBusy('portal');
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>(`${base}/portal`);
      window.location.href = url;
    } catch (err) {
      setError(errorMessage(err, 'Portail indisponible.'));
      setBusy(null);
    }
  }

  if (loading) return <Loading />;

  const admin = isAdmin(current?.role);
  const byCard = !!subscription?.stripeSubscriptionId;
  const canCancel =
    admin &&
    subscription &&
    subscription.status !== 'CANCELLED' &&
    subscription.status !== 'TRIALING' &&
    subscription.plan.priceMonthly > 0 &&
    !subscription.cancelAtPeriodEnd;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader title="Abonnement" />

      {!admin && (
        <Alert tone="info">
          Seul un administrateur de l’organisation peut changer de formule.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      {subscription && (
        <Panel title="Votre formule">
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{subscription.plan.label}</span>
              <span className="text-sm text-inksoft">
                {statusLabel[subscription.status] ?? subscription.status}
                {subscription.provider && subscription.provider !== 'MANUAL' &&
                  ` · ${providerLabel[subscription.provider]}`}
              </span>
            </div>

            <p className="text-sm text-inksoft">
              {subscription.status === 'TRIALING' ? (
                <>
                  Essai gratuit jusqu’au {formatDate(subscription.currentPeriodEnd)}
                  {subscription.daysLeft > 0 &&
                    ` · ${subscription.daysLeft} jour${subscription.daysLeft > 1 ? 's' : ''}`}
                  . Choisissez une formule avant la fin pour ne pas être interrompu.
                </>
              ) : subscription.status === 'PAST_DUE' && subscription.gracePeriodEnd ? (
                <>Accès maintenu jusqu’au {formatDate(subscription.gracePeriodEnd)}.</>
              ) : subscription.cancelAtPeriodEnd ? (
                <>
                  Résiliation programmée : l’abonnement s’arrêtera le{' '}
                  {formatDate(subscription.currentPeriodEnd)}, sans nouveau prélèvement.
                </>
              ) : byCard && subscription.status === 'ACTIVE' ? (
                <>
                  Renouvellement automatique le {formatDate(subscription.currentPeriodEnd)}{' '}
                  par carte bancaire.
                </>
              ) : (
                <>
                  Valable jusqu’au {formatDate(subscription.currentPeriodEnd)}
                  {subscription.daysLeft > 0 &&
                    ` · ${subscription.daysLeft} jour${subscription.daysLeft > 1 ? 's' : ''}`}
                </>
              )}
            </p>

            <div className="flex gap-6 text-sm tabular pt-1">
              <span>
                <span className="text-inksoft">Dossiers </span>
                {subscription.usage.entities}
                {subscription.usage.maxEntities !== null &&
                  ` / ${subscription.usage.maxEntities}`}
              </span>
              <span>
                <span className="text-inksoft">Utilisateurs </span>
                {subscription.usage.users}
                {subscription.usage.maxUsers !== null && ` / ${subscription.usage.maxUsers}`}
              </span>
            </div>

            {admin && (byCard || canCancel || subscription.cancelAtPeriodEnd) && (
              <div className="flex flex-wrap gap-2 pt-2">
                {subscription.stripeCustomerId && (
                  <Button variant="secondary" onClick={openPortal} disabled={busy !== null}>
                    {busy === 'portal' ? 'Ouverture…' : 'Carte bancaire et factures'}
                  </Button>
                )}
                {subscription.cancelAtPeriodEnd && byCard && (
                  <Button
                    onClick={() => action('resume', 'resume', 'Résiliation annulée.')}
                    disabled={busy !== null}
                  >
                    Annuler la résiliation
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="ghost"
                    className="text-critical"
                    onClick={() => setConfirmCancel(true)}
                    disabled={busy !== null}
                  >
                    Résilier
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      {subscription?.status === 'PAST_DUE' && (
        <Alert tone="warning">
          {byCard
            ? 'Le dernier prélèvement sur votre carte a échoué. Mettez à jour votre carte pour éviter la suspension.'
            : 'Votre paiement n’a pas été reçu. Renouvelez pour éviter la suspension de votre accès.'}
        </Alert>
      )}

      {subscription && !subscription.canWrite && (
        <Alert tone="error">
          Votre accès est suspendu : vos factures et déclarations restent consultables,
          mais la saisie est bloquée. Renouvelez votre abonnement pour reprendre.
        </Alert>
      )}

      <Panel title="Formules disponibles">
        <ul className="divide-y divide-line">
          {plans.map((plan) => {
            const isCurrent =
              subscription?.plan.code === plan.code &&
              subscription.status !== 'TRIALING' &&
              subscription.status !== 'CANCELLED';
            // Renouvellement manuel (Mobile Money) : proposé à l'approche
            // de l'échéance. La carte, elle, se renouvelle toute seule.
            const renewable =
              isCurrent && !byCard && subscription!.needsRenewal && plan.priceMonthly > 0;
            const offered = plan.priceMonthly === 0 ? [] : providers;

            return (
              <li key={plan.code} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{plan.label}</span>
                  <span className="text-lg font-semibold tabular">
                    {plan.priceMonthly === 0
                      ? 'Gratuit'
                      : `${formatMoney(plan.priceMonthly)} / mois`}
                  </span>
                </div>

                <ul className="mt-2 space-y-0.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-sm text-inksoft">
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!admin ? null : isCurrent && !renewable ? (
                    <span className="text-sm text-safe">Formule actuelle</span>
                  ) : plan.priceMonthly === 0 && byCard ? (
                    <span className="text-sm text-inksoft">
                      Résiliez d’abord votre abonnement par carte.
                    </span>
                  ) : plan.priceMonthly === 0 ? (
                    <Button
                      variant="secondary"
                      onClick={() => subscribe(plan.code)}
                      disabled={busy !== null}
                    >
                      Choisir
                    </Button>
                  ) : offered.length === 0 ? (
                    <span className="text-sm text-inksoft">
                      Paiement en ligne bientôt disponible.
                    </span>
                  ) : (
                    offered
                      // Pendant un abonnement par carte, le changement de
                      // formule se fait aussi par carte.
                      .filter((provider) => !byCard || provider === 'STRIPE')
                      .map((provider) => (
                        <Button
                          key={provider}
                          variant={provider === 'STRIPE' ? 'primary' : 'secondary'}
                          onClick={() => subscribe(plan.code, provider)}
                          disabled={busy !== null}
                        >
                          {busy === `${plan.code}-${provider}`
                            ? 'Ouverture…'
                            : `${renewable ? 'Renouveler' : 'Payer'} par ${
                                provider === 'STRIPE' ? 'carte' : 'Mobile Money'
                              }`}
                        </Button>
                      ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Alert tone="info">
        {providers.includes('STRIPE') &&
          'Par carte bancaire (Visa, Mastercard) : paiement sécurisé par Stripe, renouvelé automatiquement chaque mois et résiliable à tout moment. '}
        {providers.includes('FLUTTERWAVE') &&
          'Par MTN Mobile Money ou Orange Money : le Mobile Money ne permet pas le prélèvement automatique, vous recevrez un rappel avant chaque échéance. '}
        Les montants sont facturés en FCFA.
      </Alert>

      {confirmCancel && subscription && (
        <Modal title="Résilier l’abonnement" onClose={() => setConfirmCancel(false)}>
          <p className="text-sm">
            {byCard
              ? `Aucun nouveau prélèvement ne sera effectué. Vous gardez l’accès jusqu’au ${formatDate(subscription.currentPeriodEnd)}, puis vos données resteront consultables.`
              : `Vous gardez l’accès jusqu’au ${formatDate(subscription.currentPeriodEnd)}, puis vos données resteront consultables.`}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Garder mon abonnement
            </Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => action('cancel', 'cancel', 'Résiliation enregistrée.')}
            >
              Résilier
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
