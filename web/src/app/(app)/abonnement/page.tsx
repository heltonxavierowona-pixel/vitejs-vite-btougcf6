'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth-context';
import { formatDate, formatMoney } from '@/lib/format';
import { Alert, Button, Loading, PageHeader, Panel, errorMessage } from '@/components/ui';

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

export default function SubscriptionPage() {
  const { current } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const [planList, sub] = await Promise.all([
        api.get<Plan[]>(
          `/organizations/${current.organizationId}/subscription/plans`,
        ),
        api.get<Subscription | null>(
          `/organizations/${current.organizationId}/subscription`,
        ),
      ]);
      setPlans(planList);
      setSubscription(sub);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe(planCode: string) {
    if (!current) return;
    setBusy(planCode);
    setError(null);
    try {
      const result = await api.post<{ paymentUrl: string | null }>(
        `/organizations/${current.organizationId}/subscription/checkout`,
        { plan: planCode },
      );

      if (result.paymentUrl) {
        // Le paiement se fait sur la page hébergée par le
        // prestataire — on ne manipule jamais les identifiants
        // Mobile Money du client.
        window.location.href = result.paymentUrl;
      } else {
        await load();
        setBusy(null);
      }
    } catch (err) {
      setError(errorMessage(err, 'Paiement impossible.'));
      setBusy(null);
    }
  }

  if (loading) return <Loading />;

  const admin = isAdmin(current?.role);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader title="Abonnement" />

      {!admin && (
        <Alert tone="info">
          Seul un administrateur de l’organisation peut changer de formule.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {subscription && (
        <Panel title="Votre formule">
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{subscription.plan.label}</span>
              <span className="text-sm text-inksoft">
                {statusLabel[subscription.status] ?? subscription.status}
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
              ) : subscription.status === 'PAST_DUE' &&
              subscription.gracePeriodEnd ? (
                <>
                  Accès maintenu jusqu’au{' '}
                  {formatDate(subscription.gracePeriodEnd)}.
                </>
              ) : (
                <>
                  Valable jusqu’au{' '}
                  {formatDate(subscription.currentPeriodEnd)}
                  {subscription.daysLeft > 0 &&
                    ` · ${subscription.daysLeft} jour${
                      subscription.daysLeft > 1 ? 's' : ''
                    }`}
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
                {subscription.usage.maxUsers !== null &&
                  ` / ${subscription.usage.maxUsers}`}
              </span>
            </div>
          </div>
        </Panel>
      )}

      {subscription?.status === 'PAST_DUE' && (
        <Alert tone="warning">
          Votre paiement n’a pas été reçu. Renouvelez pour éviter la suspension
          de votre accès.
        </Alert>
      )}

      {subscription && !subscription.canWrite && (
        <Alert tone="error">
          Votre accès est suspendu : vos factures et déclarations restent
          consultables, mais la saisie est bloquée. Renouvelez votre abonnement
          pour reprendre.
        </Alert>
      )}

      <Panel title="Formules disponibles">
        <ul className="divide-y divide-line">
          {plans.map((plan) => {
            const isCurrent =
              subscription?.plan.code === plan.code &&
              subscription.status !== 'TRIALING';
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

                <div className="mt-3">
                  {!admin ? null : isCurrent ? (
                    subscription!.needsRenewal ? (
                      <Button
                        onClick={() => subscribe(plan.code)}
                        disabled={busy !== null}
                      >
                        {busy === plan.code ? 'Ouverture…' : 'Renouveler'}
                      </Button>
                    ) : (
                      <span className="text-sm text-safe">Formule actuelle</span>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => subscribe(plan.code)}
                      disabled={busy !== null}
                    >
                      {busy === plan.code ? 'Ouverture…' : 'Choisir'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Alert tone="info">
        Le paiement s’effectue par MTN Mobile Money, Orange Money ou carte. Le
        Mobile Money ne permet pas le prélèvement automatique : vous recevrez un
        rappel avant chaque échéance.
      </Alert>
    </div>
  );
}
