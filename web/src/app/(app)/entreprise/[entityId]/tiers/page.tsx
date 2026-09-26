'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { api, type Party } from '@/lib/api';
import { canEdit, canWrite, useAuth } from '@/lib/auth-context';
import {
  Alert,
  Button,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  errorMessage,
} from '@/components/ui';

type Tab = 'customers' | 'suppliers';

export default function PartiesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Parties />
    </Suspense>
  );
}

function Parties() {
  const params = useParams<{ entityId: string }>();
  const searchParams = useSearchParams();
  const entityId = params.entityId;
  const { current } = useAuth();
  const writable = canWrite(current?.role);

  const [tab, setTab] = useState<Tab>(
    searchParams.get('onglet') === 'suppliers' ? 'suppliers' : 'customers',
  );
  const [items, setItems] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Party | 'new' | null>(
    searchParams.get('nouveau') && writable ? 'new' : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ pageSize: '200' });
      if (search.trim()) query.set('search', search.trim());
      const data = await api.get<{ items: Party[] }>(
        `/entities/${entityId}/${tab}?${query}`,
      );
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [entityId, tab, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const isCustomer = tab === 'customers';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader
        title="Clients et fournisseurs"
        action={
          writable ? (
            <Button onClick={() => setEditing('new')}>
              {isCustomer ? 'Nouveau client' : 'Nouveau fournisseur'}
            </Button>
          ) : undefined
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-1 border-b border-line">
        {(
          [
            ['customers', 'Clients'],
            ['suppliers', 'Fournisseurs'],
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

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher par nom ou NIU"
        className="w-full h-9 px-3 bg-paper border border-line rounded-[4px] text-sm focus:border-primary focus:outline-none"
      />

      <Panel>
        {loading ? (
          <p className="px-4 py-8 text-sm text-inksoft text-center">
            Chargement…
          </p>
        ) : items.length === 0 ? (
          <Empty
            title={
              search
                ? 'Aucun résultat.'
                : isCustomer
                  ? 'Aucun client enregistré.'
                  : 'Aucun fournisseur enregistré.'
            }
            action={
              !search && writable ? (
                <Button onClick={() => setEditing('new')}>
                  Ajouter le premier
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((party) => (
              <li key={party.id}>
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => setEditing(party)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {party.name}
                    </span>
                    <span className="block text-xs text-inksoft tabular">
                      {party.niu ?? 'Sans NIU'}
                      {party.city && ` · ${party.city}`}
                    </span>
                  </div>
                  {party.isVatSubject && (
                    <span className="text-xs text-inksoft shrink-0">
                      Assujetti
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <PartyDialog
          entityId={entityId}
          tab={tab}
          party={editing === 'new' ? null : editing}
          canDelete={canEdit(current?.role)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------

function PartyDialog({
  entityId,
  tab,
  party,
  canDelete,
  onClose,
  onSaved,
}: {
  entityId: string;
  tab: Tab;
  party: Party | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCustomer = tab === 'customers';
  const [form, setForm] = useState({
    name: party?.name ?? '',
    niu: party?.niu ?? '',
    isVatSubject: party?.isVatSubject ?? false,
    address: party?.address ?? '',
    city: party?.city ?? '',
    phone: party?.phone ?? '',
    email: party?.email ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const niuRequired = isCustomer && form.isVatSubject;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // En modification, une chaîne vide efface le champ côté serveur.
      const optional = (value: string) =>
        party ? value.trim() : value.trim() || undefined;
      const body = {
        name: form.name.trim(),
        niu: optional(form.niu),
        isVatSubject: form.isVatSubject,
        address: optional(form.address),
        city: optional(form.city),
        phone: optional(form.phone),
        email: form.email.trim() || undefined,
      };

      if (party) {
        await api.put(`/entities/${entityId}/${tab}/${party.id}`, body);
      } else {
        await api.post(`/entities/${entityId}/${tab}`, body);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Enregistrement impossible.'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!party) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/entities/${entityId}/${tab}/${party.id}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Suppression impossible.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        party ? 'Modifier la fiche' : isCustomer ? 'Nouveau client' : 'Nouveau fournisseur'
      }
      onClose={onClose}
    >
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Nom ou raison sociale">
          <Input
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </Field>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isVatSubject}
            onChange={(e) => set('isVatSubject')(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            Assujetti à la TVA
            {isCustomer && (
              <span className="block text-xs text-inksoft">
                Le NIU devient alors obligatoire sur vos factures.
              </span>
            )}
          </span>
        </label>

        <Field
          label="NIU"
          hint={
            form.isVatSubject && isCustomer
              ? 'Obligatoire pour ce client'
              : 'Facultatif'
          }
        >
          <Input
            value={form.niu}
            onChange={(e) =>
              set('niu')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }
          />
        </Field>

        <Field label="Adresse" hint="Facultatif">
          <Input
            value={form.address}
            onChange={(e) => set('address')(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ville">
            <Input
              value={form.city}
              onChange={(e) => set('city')(e.target.value)}
            />
          </Field>
          <Field label="Téléphone">
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone')(e.target.value)}
            />
          </Field>
        </div>

        <Field label="E-mail" hint="Facultatif">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
          />
        </Field>

        <div className="flex gap-2 justify-end pt-1">
          {party && canDelete && (
            <Button
              variant="ghost"
              className="text-critical mr-auto"
              onClick={remove}
              disabled={busy}
            >
              Supprimer
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={save}
            disabled={busy || !form.name.trim() || (niuRequired && form.niu.length < 5)}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
    </Modal>
  );
}
