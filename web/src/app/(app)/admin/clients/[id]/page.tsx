'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Modal,
  Panel,
  Select,
  Textarea,
  errorMessage,
} from '@/components/ui';
import { ClientRow, StatusBadge } from '@/components/admin';

interface ClientDetail extends ClientRow {
  members: { role: string; name: string; email: string; phone: string | null; lastLoginAt: string | null }[];
  entities: { id: string; legalName: string; niu: string; city: string; isActive: boolean }[];
  payments: {
    id: string;
    provider: string;
    status: string;
    amount: number;
    txRef: string;
    providerTxId: string | null;
    paidAt: string | null;
    createdAt: string;
    failureReason: string | null;
    note: string | null;
  }[];
  paymentRequests: { id: string; planLabel: string; amount: number; status: string; kind: string; transactionRef: string | null; createdAt: string }[];
  availablePlans: { code: string; label: string; priceMonthly: number }[];
}

const providerLabel: Record<string, string> = {
  NEERO: 'Neero',
  NOTCHPAY: 'Notch Pay',
  STRIPE: 'Carte',
  FLUTTERWAVE: 'Flutterwave',
  MANUAL: 'Manuel',
};

const paymentStatus: Record<string, string> = {
  PENDING: 'En attente',
  SUCCEEDED: 'Payé',
  FAILED: 'Échoué',
  REFUNDED: 'Remboursé',
  EXPIRED: 'Expiré',
  CANCELED: 'Annulé',
};

const requestStatus: Record<string, string> = {
  AWAITING_LINK: 'Lien à envoyer',
  LINK_SENT: 'Lien envoyé',
  REFERENCE_SUBMITTED: 'À vérifier',
  VALIDATED: 'Validé',
  CANCELLED: 'Annulé',
};

const roleLabel: Record<string, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  ACCOUNTANT: 'Comptable',
  OPERATOR: 'Opérateur',
  VIEWER: 'Lecture',
};

type Dialog = 'extend' | 'plan' | 'suspend' | 'email' | null;

export default function AdminClientPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setClient(await api.get<ClientDetail>(`/admin/clients/${id}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      setDialog(null);
      await load();
      setNotice(message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return error ? (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Alert tone="error">{error}</Alert>
      </div>
    ) : (
      <Loading />
    );
  }

  const sub = client.subscription;
  const suspended = sub?.status === 'SUSPENDED' || sub?.status === 'PAST_DUE';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <Link href="/admin/clients" className="text-sm text-inksoft hover:text-ink">
        ← Clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
          <p className="mt-1 text-sm text-inksoft">
            {client.type === 'CABINET' ? 'Cabinet comptable' : 'Entreprise'} · inscrit le {formatDate(client.createdAt)}
          </p>
        </div>
        <StatusBadge status={sub?.status} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <Panel title="Abonnement">
        <div className="p-4 space-y-3 text-sm">
          {sub ? (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Item label="Formule" value={`${sub.planLabel}${sub.priceAmount ? ` · ${formatMoney(sub.priceAmount)} / mois` : ''}`} />
              <Item label={sub.status === 'TRIALING' ? 'Fin de l’essai' : 'Échéance'} value={formatDate(sub.currentPeriodEnd)} />
              {sub.gracePeriodEnd && <Item label="Fin de la période de grâce" value={formatDate(sub.gracePeriodEnd)} />}
              <Item label="Moyen de paiement" value={sub.provider ? providerLabel[sub.provider] ?? sub.provider : '—'} />
              <Item label="Dernier paiement" value={client.lastPaymentAt ? formatDate(client.lastPaymentAt) : '—'} />
              {sub.lastReminderAt && <Item label="Dernière relance" value={formatDate(sub.lastReminderAt)} />}
            </dl>
          ) : (
            <p className="text-inksoft">Ce client n’a pas encore d’abonnement.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {sub && <Button onClick={() => setDialog('extend')}>Prolonger</Button>}
            {sub && (
              <Button variant="secondary" onClick={() => setDialog('plan')}>
                Changer de formule
              </Button>
            )}
            {sub && suspended && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.post(`/admin/clients/${client.id}/reactivate`);
                    return 'Compte réactivé.';
                  })
                }
              >
                Réactiver
              </Button>
            )}
            {sub && sub.status !== 'SUSPENDED' && (
              <Button variant="ghost" className="text-critical" onClick={() => setDialog('suspend')}>
                Suspendre
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('email')}>
              Envoyer un e-mail
            </Button>
            {sub?.status === 'TRIALING' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const r = await api.post<{ sent: number; eligible: number; lastError: string | null }>(
                      '/admin/trial-reminders',
                      { organizationIds: [client.id] },
                    );
                    if (!r.eligible) return 'Pas de relance : client déjà relancé dans les dernières 24 h, ou demande de paiement en cours.';
                    return r.sent ? 'Relance envoyée.' : `Relance non envoyée : ${r.lastError ?? 'erreur inconnue'}`;
                  })
                }
              >
                Relancer (fin d’essai)
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Contacts">
          <ul className="divide-y divide-line text-sm">
            {client.members.map((m) => (
              <li key={m.email} className="p-4">
                <p className="font-medium">
                  {m.name} <span className="text-xs text-inksoft font-normal">· {roleLabel[m.role] ?? m.role}</span>
                </p>
                <p className="text-inksoft break-all">{m.email}</p>
                {m.phone && (
                  <a href={`tel:${m.phone}`} className="text-primary">
                    {m.phone}
                  </a>
                )}
                <p className="text-xs text-inksoft">
                  Dernière connexion : {m.lastLoginAt ? formatDate(m.lastLoginAt) : 'jamais'}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={`Dossiers (${client.entities.length})`}>
          <ul className="divide-y divide-line text-sm">
            {client.entities.map((e) => (
              <li key={e.id} className="p-4">
                <p className="font-medium">
                  {e.legalName} {!e.isActive && <span className="text-xs text-soon">· archivé</span>}
                </p>
                <p className="text-inksoft">
                  NIU {e.niu} · {e.city}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Historique des paiements">
        {client.payments.length === 0 ? (
          <p className="p-4 text-sm text-inksoft">Aucun paiement.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-inksoft">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Montant</th>
                  <th className="px-4 py-2 font-medium">Moyen</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                  <th className="px-4 py-2 font-medium">Référence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {client.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="px-4 py-2 tabular whitespace-nowrap">{formatMoney(p.amount)}</td>
                    <td className="px-4 py-2">{providerLabel[p.provider] ?? p.provider}</td>
                    <td className="px-4 py-2">{paymentStatus[p.status] ?? p.status}</td>
                    <td className="px-4 py-2 text-xs text-inksoft break-all min-w-[12rem]">
                      {p.providerTxId?.replace(/^neero:/, '') ?? p.txRef}
                      {p.note && <span className="block">{p.note}</span>}
                      {p.failureReason && <span className="block text-critical">{p.failureReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {client.paymentRequests.length > 0 && (
        <Panel title="Demandes de paiement (liens Neero)">
          <ul className="divide-y divide-line text-sm">
            {client.paymentRequests.map((r) => (
              <li key={r.id} className="px-4 py-3 flex flex-wrap justify-between gap-2">
                <span>
                  {r.planLabel} · <span className="tabular">{formatMoney(r.amount)}</span>
                  <span className="text-xs text-inksoft"> · {r.kind === 'RENEWAL' ? 'renouvellement' : 'nouvelle'} du {formatDate(r.createdAt)}</span>
                </span>
                <span className="text-inksoft">
                  {requestStatus[r.status] ?? r.status}
                  {r.transactionRef && ` · ${r.transactionRef}`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {dialog === 'extend' && <ExtendDialog client={client} busy={busy} onClose={() => setDialog(null)} onSubmit={act} />}
      {dialog === 'plan' && <PlanDialog client={client} busy={busy} onClose={() => setDialog(null)} onSubmit={act} />}
      {dialog === 'suspend' && <SuspendDialog client={client} busy={busy} onClose={() => setDialog(null)} onSubmit={act} />}
      {dialog === 'email' && <EmailDialog client={client} busy={busy} onClose={() => setDialog(null)} onSubmit={act} />}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-inksoft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface DialogProps {
  client: ClientDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: (action: () => Promise<string>) => Promise<void>;
}

function ExtendDialog({ client, busy, onClose, onSubmit }: DialogProps) {
  const [months, setMonths] = useState('1');
  const [days, setDays] = useState('0');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const m = Number(months) || 0;
  const d = Number(days) || 0;

  return (
    <Modal title="Prolonger l’abonnement" onClose={onClose} wide>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(async () => {
            await api.post(`/admin/clients/${client.id}/extend`, {
              months: m,
              days: d,
              amount: Number(amount.replace(/\s/g, '')) || 0,
              reason: reason.trim(),
            });
            return `Abonnement prolongé de ${m ? `${m} mois` : ''}${m && d ? ' et ' : ''}${d ? `${d} jour(s)` : ''}.`;
          });
        }}
      >
        <p className="text-sm text-inksoft">
          La durée s’ajoute à l’échéance actuelle (ou à aujourd’hui si elle est passée). Un compte suspendu ou impayé
          est réactivé.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mois">
            <Input type="number" min={0} max={24} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Jours">
            <Input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field label="Montant encaissé (FCFA)" hint="Laissez vide pour un geste commercial ; sinon le paiement est enregistré.">
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Motif">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Paiement en espèces, geste commercial…" required minLength={3} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy || (m <= 0 && d <= 0) || reason.trim().length < 3}>
            {busy ? 'Enregistrement…' : 'Prolonger'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PlanDialog({ client, busy, onClose, onSubmit }: DialogProps) {
  const [plan, setPlan] = useState(client.subscription?.plan ?? client.availablePlans[0]?.code ?? '');
  return (
    <Modal title="Changer de formule" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(async () => {
            await api.post(`/admin/clients/${client.id}/plan`, { plan });
            return 'Formule modifiée. L’échéance ne change pas.';
          });
        }}
      >
        <Field label="Nouvelle formule">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {client.availablePlans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label} — {p.priceMonthly ? `${formatMoney(p.priceMonthly)} / mois` : 'gratuit'}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-inksoft">Les limites (dossiers, utilisateurs) et le prix des prochains renouvellements suivent la nouvelle formule.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy || plan === client.subscription?.plan}>
            {busy ? 'Enregistrement…' : 'Changer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SuspendDialog({ client, busy, onClose, onSubmit }: DialogProps) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Suspendre le compte" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(async () => {
            await api.post(`/admin/clients/${client.id}/suspend`, { reason: reason.trim() });
            return 'Compte suspendu : les données restent consultables, la saisie est bloquée.';
          });
        }}
      >
        <p className="text-sm">
          {client.name} gardera l’accès en lecture à ses données, mais ne pourra plus rien saisir. Un paiement ou une
          réactivation rétablit l’accès.
        </p>
        <Field label="Motif (pour votre historique)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>
            Suspendre
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EmailDialog({ client, busy, onClose, onSubmit }: DialogProps) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState(`Bonjour,\n\n`);
  return (
    <Modal title={`Écrire à ${client.name}`} onClose={onClose} wide>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(async () => {
            const r = await api.post<{ sent: number; lastError: string | null }>('/admin/emails', {
              organizationId: client.id,
              subject,
              message,
            });
            return r.sent ? `E-mail envoyé à ${client.email}.` : `E-mail non envoyé : ${r.lastError ?? 'erreur inconnue'}`;
          });
        }}
      >
        <p className="text-sm text-inksoft">Destinataire : {client.email}</p>
        <Field label="Objet">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={150} />
        </Field>
        <Field label="Message">
          <Textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} maxLength={5000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy || subject.trim().length < 3 || message.trim().length < 10}>
            {busy ? 'Envoi…' : 'Envoyer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
