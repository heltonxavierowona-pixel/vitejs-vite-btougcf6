'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Alert, Button, Empty, Input, Loading, PageHeader, Panel, errorMessage } from '@/components/ui';
import { ClientRow, StatusBadge } from '@/components/admin';

const SEGMENTS = [
  { value: 'all', label: 'Tous' },
  { value: 'trialing', label: 'En essai' },
  { value: 'active', label: 'Payants' },
  { value: 'expiring', label: 'Échéance < 7 j' },
  { value: 'past_due', label: 'Impayés' },
  { value: 'suspended', label: 'Suspendus' },
  { value: 'cancelled', label: 'Résiliés' },
  { value: 'free', label: 'Gratuits' },
];

export default function AdminClientsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: ClientRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recherche lancée 300 ms après la dernière frappe.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ segment, page: String(page), ...(query && { search: query }) });
      setData(await api.get(`/admin/clients?${params}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    }
  }, [segment, page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <PageHeader
        title="Clients"
        subtitle={data ? `${data.total} client${data.total > 1 ? 's' : ''}` : undefined}
        action={
          <Button
            variant="secondary"
            onClick={() => void api.download('/admin/export/clients.csv', 'numera-clients.csv').catch((err) => setError(errorMessage(err)))}
          >
            Exporter (CSV)
          </Button>
        }
      />

      <div className="space-y-3">
        <Input
          type="search"
          placeholder="Rechercher : entreprise, e-mail, téléphone, NIU…"
          aria-label="Rechercher un client"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Filtrer par statut">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={segment === s.value}
              onClick={() => {
                setSegment(s.value);
                setPage(1);
              }}
              className={`px-3 h-8 rounded-full text-sm whitespace-nowrap border ${
                segment === s.value ? 'bg-primary text-white border-primary' : 'bg-paper border-line text-inksoft hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Panel>
          <Empty title="Aucun client ne correspond." />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {data.items.map((client) => (
              <li key={client.id}>
                <Link href={`/admin/clients/${client.id}`} className="block p-4 hover:bg-surface">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{client.name}</p>
                      <p className="text-xs text-inksoft truncate">
                        {client.type === 'CABINET' ? 'Cabinet' : 'Entreprise'}
                        {client.owner && ` · ${client.owner.name}`} · {client.email}
                      </p>
                    </div>
                    <StatusBadge status={client.subscription?.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <span>
                      <span className="text-inksoft">Formule </span>
                      {client.subscription?.planLabel ?? '—'}
                    </span>
                    {client.subscription && client.subscription.priceAmount > 0 && (
                      <span className="tabular">{formatMoney(client.subscription.priceAmount)} / mois</span>
                    )}
                    {client.subscription && (
                      <span>
                        <span className="text-inksoft">Échéance </span>
                        {formatDate(client.subscription.currentPeriodEnd)}
                      </span>
                    )}
                    <span className="text-inksoft">Inscrit le {formatDate(client.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Précédents
          </Button>
          <span className="text-sm text-inksoft">
            Page {page} / {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Suivants →
          </Button>
        </div>
      )}
    </div>
  );
}
