'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Alert, Button, Loading, PageHeader, Panel, errorMessage } from '@/components/ui';
import { MonthRevenue, RevenueChart, StatTile } from '@/components/admin';

interface Stats {
  organizations: number;
  newThisMonth: number;
  subscriptions: {
    trialing: number;
    active: number;
    paying: number;
    pastDue: number;
    suspended: number;
    cancelled: number;
  };
  mrr: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  expiringSoon: number;
  trialsEndingSoon: number;
  pendingRequests: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenue, setRevenue] = useState<MonthRevenue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<Stats>('/admin/stats'), api.get<MonthRevenue[]>('/admin/revenue?months=12')])
      .then(([s, r]) => {
        setStats(s);
        setRevenue(r);
      })
      .catch((err) => setError(errorMessage(err, 'Chargement impossible')));
  }, []);

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (err) {
      setError(errorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(null);
    }
  }

  const remindTrials = () =>
    run('trials', async () => {
      const r = await api.post<{ sent: number; eligible: number; lastError: string | null }>('/admin/trial-reminders', {});
      if (!r.eligible) return 'Aucun client en essai à relancer (déjà relancés dans les dernières 24 h ou déjà abonnés).';
      return `${r.sent} relance(s) envoyée(s) sur ${r.eligible}.${r.lastError ? ` Échec : ${r.lastError}` : ''}`;
    });

  if (!stats || !revenue) {
    return error ? (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Alert tone="error">{error}</Alert>
      </div>
    ) : (
      <Loading />
    );
  }

  const trend =
    stats.revenueLastMonth > 0
      ? Math.round(((stats.revenueThisMonth - stats.revenueLastMonth) / stats.revenueLastMonth) * 100)
      : null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <PageHeader title="Tableau de bord" subtitle="Vue d’ensemble de vos clients et de vos revenus." />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <section aria-label="Chiffres clés" className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Encaissé ce mois-ci"
          value={formatMoney(stats.revenueThisMonth)}
          hint={
            trend === null
              ? `Mois dernier : ${formatMoney(stats.revenueLastMonth)}`
              : `${trend >= 0 ? '+' : ''}${trend} % par rapport au mois dernier`
          }
        />
        <StatTile label="Revenu mensuel récurrent" value={formatMoney(stats.mrr)} hint={`${stats.subscriptions.paying} abonnement(s) payant(s)`} />
        <StatTile label="Clients" value={String(stats.organizations)} hint={`+${stats.newThisMonth} ce mois-ci`} />
        <StatTile label="En essai" value={String(stats.subscriptions.trialing)} hint={`${stats.trialsEndingSoon} se terminent sous 7 jours`} />
        <StatTile
          label="Échéances sous 7 jours"
          value={String(stats.expiringSoon)}
          tone={stats.expiringSoon ? 'warning' : 'default'}
          hint="Abonnements payants à renouveler"
        />
        <StatTile
          label="Impayés"
          value={String(stats.subscriptions.pastDue)}
          tone={stats.subscriptions.pastDue ? 'warning' : 'default'}
          hint="En période de grâce"
        />
        <StatTile label="Suspendus" value={String(stats.subscriptions.suspended)} hint={`${stats.subscriptions.cancelled} résilié(s)`} />
        <StatTile
          label="Paiements à traiter"
          value={String(stats.pendingRequests)}
          tone={stats.pendingRequests ? 'warning' : 'default'}
          hint="Liens à envoyer ou références à vérifier"
        />
      </section>

      <Panel title="Encaissements des 12 derniers mois">
        <div className="p-4">
          <RevenueChart data={revenue} />
        </div>
      </Panel>

      <Panel title="Actions rapides">
        <div className="p-4 flex flex-wrap gap-2">
          <Button onClick={() => void remindTrials()} disabled={busy !== null}>
            {busy === 'trials' ? 'Envoi…' : `Relancer les clients en essai (${stats.subscriptions.trialing})`}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void run('csv-clients', async () => {
                await api.download('/admin/export/clients.csv', 'numera-clients.csv');
                return 'Export des clients téléchargé.';
              })
            }
          >
            Exporter les clients (CSV)
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void run('csv-payments', async () => {
                await api.download('/admin/export/payments.csv', 'numera-paiements.csv');
                return 'Export des paiements téléchargé.';
              })
            }
          >
            Exporter les paiements (CSV)
          </Button>
          <Link
            href="/admin/emails"
            className="inline-flex items-center justify-center px-4 h-10 rounded-[4px] border border-line text-sm font-medium hover:bg-surface"
          >
            Écrire aux clients
          </Link>
        </div>
      </Panel>
    </div>
  );
}
