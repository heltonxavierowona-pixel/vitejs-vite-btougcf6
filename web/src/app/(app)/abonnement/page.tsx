'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth-context';
import { formatDate, formatMoney } from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  errorMessage,
} from '@/components/ui';

type Provider = 'NOTCHPAY' | 'STRIPE' | 'FLUTTERWAVE';

interface Plan {
  code: string;
  label: string;
  priceMonthly: number;
  maxEntities: number | null;
  maxUsers: number | null;
  trialDays: number;
  features: string[];
}

type PaymentMode = 'manual' | 'online';

interface PaymentRequest {
  id: string;
  plan: string;
  planLabel: string;
  amount: number;
  kind: 'NEW' | 'RENEWAL';
  status: 'AWAITING_LINK' | 'LINK_SENT' | 'REFERENCE_SUBMITTED';
  paymentLink: string | null;
  transactionRef: string | null;
  rejectionReason: string | null;
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
  paymentRequest: PaymentRequest | null;
  usage: {
    entities: number;
    maxEntities: number | null;
    users: number;
    maxUsers: number | null;
  };
}

/** Libellé du bouton de paiement, par prestataire. */
const payLabel: Record<Provider, string> = {
  NOTCHPAY: '(Mobile Money ou carte)',
  STRIPE: 'par carte',
  FLUTTERWAVE: 'par Mobile Money',
};

const statusLabel: Record<string, string> = {
  TRIALING: 'Période d’essai',
  ACTIVE: 'Actif',
  PAST_DUE: 'Paiement en attente',
  SUSPENDED: 'Suspendu',
  CANCELLED: 'Résilié',
};

const providerLabel: Record<Provider, string> = {
  NOTCHPAY: 'Notch Pay',
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
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('manual');
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
        api.get<{ paymentMode?: PaymentMode; providers: Provider[]; plans: Plan[] }>(
          `${base}/plans`,
        ),
        api.get<Subscription | null>(base),
      ]);
      setPlans(catalog.plans);
      setProviders(catalog.providers);
      setPaymentMode(catalog.paymentMode ?? 'online');
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

  // Les boutons de paiement sont en bas de page : sans cela, le
  // message d'erreur s'affiche hors de l'écran sur téléphone.
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || notice) {
      messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error, notice]);

  /** Redirige vers la page de paiement hébergée par le prestataire. */
  async function subscribe(planCode: string, provider?: Provider) {
    setBusy(`${planCode}-${provider ?? ''}`);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ paymentUrl: string | null; message?: string }>(
        `${base}/checkout`,
        { plan: planCode, ...(provider && { provider }) },
      );
      if (result.paymentUrl) {
        // On ne manipule jamais les identifiants de carte ou de
        // Mobile Money : tout se passe chez le prestataire de paiement.
        window.location.href = result.paymentUrl;
        return;
      }
      await load();
      if (result.message) setNotice(result.message);
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
  const manual = paymentMode === 'manual';
  const request = subscription?.paymentRequest ?? null;
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

      <div ref={messageRef} className="space-y-5 empty:hidden" role="status" aria-live="polite">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}
      </div>

      {subscription && (
        <Panel title="Votre formule">
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{subscription.plan.label}</span>
              <span className="text-sm text-inksoft">
                {request && (
                  <span className="text-soon font-medium">En attente de paiement · </span>
                )}
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

      {request && (
        <PaymentRequestPanel
          request={request}
          admin={admin}
          base={base}
          onChange={async (message) => {
            await load();
            setError(null);
            setNotice(message);
          }}
          onError={setError}
        />
      )}

      {subscription?.status === 'PAST_DUE' && (
        <Alert tone="warning">
          {byCard
            ? 'Le dernier prélèvement sur votre carte a échoué. Mettez à jour votre carte pour éviter la suspension.'
            : request
              ? 'Votre abonnement est échu : réglez votre paiement pour éviter la suspension de votre accès.'
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
                  ) : manual ? (
                    request?.plan === plan.code ? (
                      <span className="text-sm text-soon">Demande en cours</span>
                    ) : (
                      <Button
                        variant={renewable || !isCurrent ? 'primary' : 'secondary'}
                        onClick={() => subscribe(plan.code)}
                        disabled={
                          busy !== null ||
                          (!!request && request.status !== 'AWAITING_LINK')
                        }
                      >
                        {busy === `${plan.code}-`
                          ? 'Envoi…'
                          : renewable
                            ? 'Renouveler'
                            : request
                              ? 'Choisir cette formule'
                              : 'S’abonner'}
                      </Button>
                    )
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
                          variant={provider === offered[0] ? 'primary' : 'secondary'}
                          onClick={() => subscribe(plan.code, provider)}
                          disabled={busy !== null}
                        >
                          {busy === `${plan.code}-${provider}`
                            ? 'Ouverture…'
                            : `${renewable ? 'Renouveler' : 'Payer'} ${payLabel[provider]}`}
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
        {manual &&
          'Paiement par Mobile Money (MTN, Orange), grâce à un lien de paiement sécurisé que nous vous envoyons par e-mail ou WhatsApp. Après le paiement, saisissez la référence de transaction ici : votre accès est activé dès vérification. Chaque mois se paie à l’avance, sans prélèvement automatique. '}
        {providers.includes('NOTCHPAY') &&
          'Paiement sécurisé par Notch Pay : MTN Mobile Money, Orange Money ou carte bancaire. Chaque mois se paie à l’avance : aucun prélèvement automatique, un rappel vous est envoyé avant chaque échéance. '}
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

// ------------------------------------------------------------

const requestSteps = ['Demande reçue', 'Lien envoyé', 'Vérification'];

/** Demande de paiement manuelle (lien Neero) en cours. */
function PaymentRequestPanel({
  request,
  admin,
  base,
  onChange,
  onError,
}: {
  request: PaymentRequest;
  admin: boolean;
  base: string;
  onChange: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const step =
    request.status === 'AWAITING_LINK' ? 0 : request.status === 'LINK_SENT' ? 1 : 2;

  async function post(path: string, body: object | undefined, message: string) {
    setBusy(true);
    try {
      await api.post(`${base}/payment-request/${path}`, body);
      setReference('');
      await onChange(message);
    } catch (err) {
      onError(errorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={request.kind === 'RENEWAL' ? 'Renouvellement en attente de paiement' : 'En attente de paiement'}
    >
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">{request.planLabel}</span>
          <span className="font-semibold tabular">{formatMoney(request.amount)}</span>
        </div>

        <ol className="grid grid-cols-3 gap-2 text-xs" aria-label="Étapes du paiement">
          {requestSteps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`border-t-2 pt-1.5 ${
                index < step
                  ? 'border-safe text-safe'
                  : index === step
                    ? 'border-primary text-primary font-medium'
                    : 'border-line text-inksoft'
              }`}
            >
              {label}
            </li>
          ))}
        </ol>

        {request.status === 'AWAITING_LINK' && (
          <p className="text-sm">
            Votre lien de paiement vous sera envoyé sous quelques heures, par e-mail ou
            WhatsApp. Il apparaîtra aussi sur cette page.
          </p>
        )}

        {request.status === 'LINK_SENT' && request.paymentLink && (
          <>
            {request.rejectionReason && (
              <Alert tone="warning">
                Référence non confirmée : {request.rejectionReason} Vérifiez-la puis
                saisissez-la de nouveau.
              </Alert>
            )}
            <div>
              <p className="text-sm mb-2">1. Payez avec votre lien sécurisé :</p>
              <a
                href={request.paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 h-10 rounded-[4px] bg-primary text-white text-sm font-medium hover:bg-primaryhover"
              >
                Payer {formatMoney(request.amount)}
              </a>
            </div>
            {admin && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void post(
                    'reference',
                    { transactionRef: reference },
                    'Référence envoyée : votre accès sera activé dès vérification du paiement.',
                  );
                }}
              >
                <p className="text-sm">2. Puis saisissez la référence de la transaction :</p>
                <Field
                  label="Référence de transaction"
                  hint="Elle figure dans le SMS ou le reçu de confirmation du paiement."
                >
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                    minLength={4}
                    maxLength={80}
                    autoComplete="off"
                  />
                </Field>
                <Button type="submit" disabled={busy || reference.trim().length < 4}>
                  {busy ? 'Envoi…' : 'Envoyer la référence'}
                </Button>
              </form>
            )}
          </>
        )}

        {request.status === 'REFERENCE_SUBMITTED' && (
          <p className="text-sm">
            Paiement en cours de vérification (référence{' '}
            <span className="font-medium">{request.transactionRef}</span>). Votre accès sera
            activé dès confirmation.
          </p>
        )}

        {admin && request.status !== 'REFERENCE_SUBMITTED' && (
          <Button
            variant="ghost"
            className="text-critical px-0 h-auto"
            disabled={busy}
            onClick={() => void post('cancel', undefined, 'Demande de paiement annulée.')}
          >
            Annuler la demande
          </Button>
        )}
      </div>
    </Panel>
  );
}
