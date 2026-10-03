'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { canWrite, useAuth } from '@/lib/auth-context';
import {
  formatDate,
  formatMoney,
  invoiceStatusLabel,
} from '@/lib/format';
import { Alert, Button, Empty, Loading, PageHeader, Panel, errorMessage } from '@/components/ui';

interface InvoiceRow {
  id: string;
  number: string | null;
  direction: 'SALE' | 'PURCHASE';
  type: string;
  status: string;
  partyName: string | null;
  issuedAt: string;
  totalInclVat: number;
  paidAmount: number;
}

type Tab = 'SALE' | 'PURCHASE';

const PAGE_SIZE = 25;

function InvoiceList() {
  const params = useParams<{ entityId: string }>();
  const searchParams = useSearchParams();
  const entityId = params.entityId;
  const { current } = useAuth();

  const [tab, setTabState] = useState<Tab>(
    searchParams.get('sens') === 'achat' ? 'PURCHASE' : 'SALE',
  );
  const [status, setStatusState] = useState(searchParams.get('statut') ?? '');
  const [search, setSearchState] = useState('');
  const [page, setPage] = useState(1);

  // Tout changement de filtre repart de la première page.
  const setTab = (value: Tab) => {
    setPage(1);
    setTabState(value);
  };
  const setStatus = (value: string) => {
    setPage(1);
    setStatusState(value);
  };
  const setSearch = (value: string) => {
    setPage(1);
    setSearchState(value);
  };
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        direction: tab,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (status) query.set('status', status);
      if (search.trim()) query.set('search', search.trim());

      const data = await api.get<{ items: InvoiceRow[]; total: number }>(
        `/entities/${entityId}/invoices?${query}`,
      );
      // Page suivante : on ajoute à la liste au lieu de la remplacer.
      setRows((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [entityId, tab, status, search, page]);

  // Léger délai sur la recherche pour ne pas requêter à chaque frappe.
  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const newHref = `/entreprise/${entityId}/factures/nouvelle${
    tab === 'PURCHASE' ? '?sens=achat' : ''
  }`;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <PageHeader
        title="Factures"
        action={
          canWrite(current?.role) ? (
            <Link href={newHref}>
              <Button>
                {tab === 'SALE' ? 'Nouvelle facture' : 'Saisir un achat'}
              </Button>
            </Link>
          ) : undefined
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {/* Ventes / Achats */}
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ['SALE', 'Ventes'],
            ['PURCHASE', 'Achats'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 h-10 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-inksoft hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un numéro ou un nom"
          className="flex-1 min-w-48 h-9 px-3 bg-paper border border-line rounded-[4px] text-sm focus:border-primary focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 px-2 bg-paper border border-line rounded-[4px] text-sm"
        >
          <option value="">Tous les statuts</option>
          <option value="DRAFT">Brouillon</option>
          <option value="VALIDATED">Validée</option>
          <option value="PAID">Payée</option>
          <option value="PARTIALLY_PAID">Partiellement payée</option>
          <option value="CANCELLED">Annulée</option>
        </select>
      </div>

      <Panel>
        {loading && rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-inksoft text-center">
            Chargement…
          </p>
        ) : rows.length === 0 ? (
          <Empty
            title={
              search || status
                ? 'Aucune facture ne correspond à cette recherche.'
                : 'Aucune facture pour l’instant.'
            }
            action={
              !search && !status && canWrite(current?.role) ? (
                <Link href={newHref}>
                  <Button>Créer la première</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const isCreditNote = row.type === 'CREDIT_NOTE';
                return (
                  <li key={row.id}>
                    <Link
                      href={`/entreprise/${entityId}/factures/${row.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <span className="block text-sm truncate">
                          {row.partyName ?? '—'}
                          {isCreditNote && (
                            <span className="text-inksoft"> · avoir</span>
                          )}
                        </span>
                        <span className="block text-xs text-inksoft tabular">
                          {row.number ?? 'Brouillon'} ·{' '}
                          {formatDate(row.issuedAt)}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="block text-sm font-medium tabular">
                          {isCreditNote && '−'}
                          {formatMoney(row.totalInclVat)}
                        </span>
                        <span
                          className={`block text-xs ${
                            row.status === 'DRAFT'
                              ? 'text-soon'
                              : 'text-inksoft'
                          }`}
                        >
                          {invoiceStatusLabel[row.status] ?? row.status}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between px-4 py-2.5 border-t border-line">
              <span className="text-xs text-inksoft tabular">
                {rows.length} sur {total}
              </span>
              {rows.length < total && (
                <Button
                  variant="ghost"
                  className="h-8 px-3"
                  disabled={loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {loading ? 'Chargement…' : 'Afficher plus'}
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

export default function InvoiceListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoiceList />
    </Suspense>
  );
}
