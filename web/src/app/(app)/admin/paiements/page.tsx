'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, formatMoney } from '@/lib/format';
import {
  Alert,
  Button,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  errorMessage,
} from '@/components/ui';

type Status = 'AWAITING_LINK' | 'LINK_SENT' | 'REFERENCE_SUBMITTED' | 'VALIDATED' | 'CANCELLED';

interface PaymentRequest {
  id: string;
  plan: string;
  planLabel: string;
  amount: number;
  kind: 'NEW' | 'RENEWAL';
  status: Status;
  paymentLink: string | null;
  transactionRef: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  whatsappUrl: string | null;
  requester: { name: string; email: string } | null;
  organization: {
    name: string;
    type: 'ENTREPRISE' | 'CABINET';
    billingEmail: string;
    billingPhone: string;
    subscription: { status: string; currentPeriodEnd: string } | null;
  };
}

interface NotificationStatus {
  telegramBot: boolean;
  telegramChat: boolean;
  whatsapp?: boolean;
  email: boolean;
}

const statusLabel: Record<Status, string> = {
  AWAITING_LINK: 'Lien à envoyer',
  LINK_SENT: 'En attente du paiement',
  REFERENCE_SUBMITTED: 'À vérifier',
  VALIDATED: 'Validé',
  CANCELLED: 'Annulé',
};

const statusTone: Record<Status, string> = {
  AWAITING_LINK: 'bg-soonbg text-soon',
  LINK_SENT: 'bg-surface text-inksoft',
  REFERENCE_SUBMITTED: 'bg-criticalbg text-critical',
  VALIDATED: 'bg-primarysoft text-primary',
  CANCELLED: 'bg-surface text-inksoft',
};

export default function AdminPaymentsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [scope, setScope] = useState<'open' | 'closed'>('open');
  const [requests, setRequests] = useState<PaymentRequest[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user && !user.isPlatformAdmin) router.replace('/espace');
  }, [user, router]);

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        api.get<PaymentRequest[]>(`/admin/payment-requests?scope=${scope}`),
        api.get<NotificationStatus>('/admin/notifications'),
      ]);
      setRequests(list);
      setNotifications(status);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
      setRequests([]);
    }
  }, [scope]);

  useEffect(() => {
    void load();
    // Actualisation automatique : les demandes arrivent à tout moment.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!user?.isPlatformAdmin) return <Loading />;

  const done = async (message: string) => {
    setError(null);
    setNotice(message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await load();
  };
  const fail = (err: unknown) => {
    setNotice(null);
    setError(errorMessage(err, 'Action impossible.'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const counts = (requests ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <PageHeader
        title="Paiements des abonnements"
        subtitle="Générez le lien dans Neero, collez-le ici, puis validez après vérification."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Actualiser
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <PlanLinksPanel onDone={done} onError={fail} />

      {notifications && (
        <NotificationsPanel status={notifications} onDone={done} onError={fail} />
      )}

      <div className="flex gap-1 border-b border-line" role="tablist">
        {(['open', 'closed'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={scope === value}
            onClick={() => {
              setRequests(null);
              setScope(value);
            }}
            className={`px-3 h-10 text-sm font-medium border-b-2 -mb-px ${
              scope === value ? 'border-primary text-primary' : 'border-transparent text-inksoft hover:text-ink'
            }`}
          >
            {value === 'open' ? 'À traiter' : 'Historique'}
          </button>
        ))}
      </div>

      {scope === 'open' && requests && requests.length > 0 && (
        <p className="text-sm text-inksoft">
          {[
            counts.AWAITING_LINK && `${counts.AWAITING_LINK} lien(s) à envoyer`,
            counts.REFERENCE_SUBMITTED && `${counts.REFERENCE_SUBMITTED} paiement(s) à vérifier`,
            counts.LINK_SENT && `${counts.LINK_SENT} en attente du client`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {requests === null ? (
        <Loading />
      ) : requests.length === 0 ? (
        <Panel>
          <Empty title={scope === 'open' ? 'Aucune demande à traiter.' : 'Aucune demande close.'} />
        </Panel>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} onDone={done} onError={fail} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------

function RequestCard({
  request,
  onDone,
  onError,
}: {
  request: PaymentRequest;
  onDone: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [link, setLink] = useState(request.paymentLink ?? '');
  const [editLink, setEditLink] = useState(false);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ emailed: boolean; email: string | null; whatsappUrl: string | null } | null>(null);

  const base = `/admin/payment-requests/${request.id}`;
  const org = request.organization;

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } catch (err) {
      onError(err);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const sendLink = () =>
    run('link', async () => {
      const result = await api.post<{ emailed: boolean; email: string | null; whatsappUrl: string | null }>(
        `${base}/link`,
        { paymentLink: link.trim() },
      );
      setSent(result);
      setEditLink(false);
      await onDone(
        result.emailed
          ? `Lien envoyé par e-mail à ${result.email}. ${org.name} le voit aussi sur sa page Abonnement.`
          : `Lien enregistré : ${org.name} le voit sur sa page Abonnement. E-mail non envoyé (non configuré) : utilisez WhatsApp.`,
      );
    });

  const validate = () =>
    run('validate', async () => {
      await api.post(`${base}/validate`, reference.trim() ? { transactionRef: reference.trim() } : {});
      await onDone(`Paiement validé : l’abonnement de ${org.name} est actif.`);
    });

  const reject = () =>
    run('reject', async () => {
      await api.post(`${base}/reject`, { reason: reason.trim() });
      await onDone(`Référence refusée : ${org.name} est invité à la corriger.`);
    });

  const cancel = () => {
    if (!window.confirm(`Annuler la demande de ${org.name} ?`)) return;
    void run('cancel', async () => {
      await api.post(`${base}/cancel`);
      await onDone('Demande annulée.');
    });
  };

  const whatsappUrl = sent?.whatsappUrl ?? request.whatsappUrl;
  const open = request.status !== 'VALIDATED' && request.status !== 'CANCELLED';

  return (
    <Panel>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{org.name}</p>
            <p className="text-xs text-inksoft">
              {org.type === 'CABINET' ? 'Cabinet' : 'Entreprise'}
              {request.requester && ` · ${request.requester.name}`}
              {' · '}
              {request.kind === 'RENEWAL' ? 'Renouvellement' : 'Nouvelle demande'} du{' '}
              {formatDate(request.createdAt)}
            </p>
          </div>
          <span className={`px-2 py-0.5 rounded-[3px] text-xs font-medium ${statusTone[request.status]}`}>
            {statusLabel[request.status]}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-inksoft">Offre </span>
            {request.planLabel}
          </span>
          <span className="font-semibold tabular">{formatMoney(request.amount)}</span>
          {org.billingPhone && (
            <a href={`tel:${org.billingPhone}`} className="text-primary">
              {org.billingPhone}
            </a>
          )}
          {(org.billingEmail || request.requester?.email) && (
            <span className="text-inksoft break-all">{org.billingEmail || request.requester?.email}</span>
          )}
        </div>

        {/* 1. Lien Neero */}
        {open && (request.status === 'AWAITING_LINK' || editLink) && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void sendLink();
            }}
          >
            <Field label="Lien de paiement Neero" hint={`Montant à indiquer dans Neero : ${formatMoney(request.amount)}`}>
              <Input
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                required
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy !== null || !link.trim().startsWith('https://')}>
                {busy === 'link' ? 'Envoi…' : 'Envoyer au client'}
              </Button>
              {editLink && (
                <Button type="button" variant="ghost" onClick={() => setEditLink(false)}>
                  Annuler
                </Button>
              )}
            </div>
          </form>
        )}

        {request.paymentLink && !editLink && (
          <div className="text-sm flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-inksoft">Lien :</span>
            <a href={request.paymentLink} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
              {request.paymentLink}
            </a>
            {request.status === 'LINK_SENT' && (
              <button type="button" className="text-inksoft underline" onClick={() => setEditLink(true)}>
                Modifier
              </button>
            )}
          </div>
        )}

        {whatsappUrl && request.status === 'LINK_SENT' && !editLink && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 h-10 rounded-[4px] border border-line text-sm font-medium hover:bg-surface"
          >
            Envoyer par WhatsApp
          </a>
        )}

        {/* 2. Référence du client */}
        {request.transactionRef && (
          <p className="text-sm">
            <span className="text-inksoft">Référence saisie : </span>
            <span className="font-semibold tracking-wide">{request.transactionRef}</span>
          </p>
        )}
        {request.rejectionReason && request.status === 'LINK_SENT' && (
          <p className="text-xs text-soon">Dernière référence refusée : {request.rejectionReason}</p>
        )}

        {/* 3. Vérification dans Neero */}
        {(request.status === 'LINK_SENT' || request.status === 'REFERENCE_SUBMITTED') && !editLink && (
          <div className="border-t border-line pt-3 space-y-2">
            {request.status === 'LINK_SENT' && (
              <Field
                label="Référence Neero (si le client ne l’a pas saisie)"
                hint="Validez uniquement après avoir vu le paiement dans Neero."
              >
                <Input value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
              </Field>
            )}
            {rejecting ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void reject();
                }}
              >
                <Field label="Motif communiqué au client">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Aucune transaction avec cette référence dans Neero."
                    required
                    minLength={3}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" disabled={busy !== null || reason.trim().length < 3}>
                    {busy === 'reject' ? 'Envoi…' : 'Refuser la référence'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                    Retour
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void validate()}
                  disabled={busy !== null || (request.status === 'LINK_SENT' && reference.trim().length < 4)}
                >
                  {busy === 'validate' ? 'Validation…' : 'Valider le paiement'}
                </Button>
                {request.status === 'REFERENCE_SUBMITTED' && (
                  <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy !== null}>
                    Refuser
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {open && (
          <button type="button" className="text-xs text-critical underline" onClick={cancel} disabled={busy !== null}>
            Annuler la demande
          </button>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------

function NotificationsPanel({
  status,
  onDone,
  onError,
}: {
  status: NotificationStatus;
  onDone: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const ready = status.telegramBot && status.telegramChat;

  async function run(key: string, path: string, message: (data: any) => string) {
    setBusy(key);
    try {
      const data = await api.post(path);
      await onDone(message(data));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Notifications">
      <div className="p-4 space-y-3 text-sm">
        <ul className="space-y-1">
          <li>
            {status.whatsapp ? '✅' : '⚠️'} WhatsApp :{' '}
            {status.whatsapp ? 'actif, les demandes arrivent sur votre WhatsApp.' : 'non configuré.'}
          </li>
          <li>
            {ready ? '✅' : '⚠️'} Telegram :{' '}
            {ready
              ? 'actif, vous êtes prévenu sur votre téléphone.'
              : status.telegramBot
                ? 'bot configuré, conversation à relier.'
                : 'non configuré.'}
          </li>
          <li>
            {status.email ? '✅' : '⚠️'} E-mail aux clients :{' '}
            {status.email ? 'actif.' : 'non configuré (les clients voient leur lien sur leur page Abonnement ; utilisez WhatsApp).'}
          </li>
        </ul>

        {!status.whatsapp && !ready && (
          <ol className="list-decimal pl-5 space-y-1 text-inksoft">
            <li>Enregistrez le numéro de CallMeBot dans vos contacts (voir callmebot.com).</li>
            <li>Envoyez-lui sur WhatsApp : « I allow callmebot to send me messages ». Il vous répond votre clé (APIKEY).</li>
            <li>Dans Vercel (projet numera-api), ajoutez WHATSAPP_NOTIFY_APIKEY avec cette clé, puis redéployez.</li>
          </ol>
        )}
        {status.telegramBot && !status.telegramChat && (
          <p className="text-inksoft">Ouvrez votre bot dans Telegram, envoyez-lui « /start », puis cliquez sur « Relier ».</p>
        )}

        <div className="flex flex-wrap gap-2">
          {status.telegramBot && (
            <Button
              variant={status.telegramChat ? 'secondary' : 'primary'}
              disabled={busy !== null}
              onClick={() =>
                void run('detect', '/admin/notifications/telegram/detect', (chat) => `Telegram relié à ${chat.name}.`)
              }
            >
              {busy === 'detect' ? 'Recherche…' : status.telegramChat ? 'Relier à nouveau' : 'Relier ma conversation Telegram'}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run('test', '/admin/notifications/test', (data) => data?.message ?? 'Notification de test envoyée.')}
          >
            {busy === 'test' ? 'Envoi…' : 'Envoyer un test'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------

interface PlanLink {
  plan: string;
  label: string;
  audience: 'ENTREPRISE' | 'CABINET';
  amount: number;
  paymentLink: string | null;
}

/** Liens Neero préparés : envoyés au client dès sa demande. */
function PlanLinksPanel({
  onDone,
  onError,
}: {
  onDone: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [links, setLinks] = useState<PlanLink[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Chargé une seule fois : onError change à chaque rendu du parent.
  useEffect(() => {
    api
      .get<PlanLink[]>('/admin/plan-links')
      .then(setLinks)
      .catch((err) => onError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(plan: PlanLink, value: string) {
    setBusy(plan.plan);
    try {
      const updated = await api.post<PlanLink[]>('/admin/plan-links', {
        plan: plan.plan,
        paymentLink: value.trim() || null,
      });
      setLinks(updated);
      setDrafts((d) => ({ ...d, [plan.plan]: '' }));
      await onDone(
        value.trim()
          ? `Lien enregistré pour ${plan.label} : il sera envoyé automatiquement à chaque demande.`
          : `Lien retiré pour ${plan.label} : les demandes attendront votre lien.`,
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  if (!links) return null;
  const configured = links.filter((l) => l.paymentLink).length;

  return (
    <Panel title={`Liens Neero par formule (${configured}/${links.length})`}>
      <div className="p-4 space-y-4 text-sm">
        <p className="text-inksoft">
          Créez dans Neero un lien de paiement par formule, au bon montant, et collez-le ici. Le
          client le reçoit alors instantanément, même la nuit : il ne vous reste qu’à vérifier le
          paiement et valider.
        </p>
        <ul className="divide-y divide-line border-y border-line">
          {links.map((link) => {
            const draft = drafts[link.plan] ?? '';
            return (
              <li key={link.plan} className="py-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {link.label}{' '}
                    <span className="text-xs text-inksoft">
                      · {link.audience === 'CABINET' ? 'cabinet' : 'entreprise'}
                    </span>
                  </span>
                  <span className="tabular font-semibold">{formatMoney(link.amount)}</span>
                </div>
                {link.paymentLink ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-safe">✅</span>
                    <a href={link.paymentLink} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
                      {link.paymentLink}
                    </a>
                    <button
                      type="button"
                      className="text-xs text-critical underline"
                      disabled={busy !== null}
                      onClick={() => void save(link, '')}
                    >
                      Retirer
                    </button>
                  </div>
                ) : (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(link, draft);
                    }}
                  >
                    <Input
                      type="url"
                      inputMode="url"
                      placeholder="https://… (lien Neero de cette formule)"
                      aria-label={`Lien Neero pour ${link.label}`}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [link.plan]: e.target.value }))}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={busy !== null || !draft.trim().startsWith('https://')}
                    >
                      {busy === link.plan ? 'Enregistrement…' : 'Enregistrer'}
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
