'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { api, type Product } from '@/lib/api';
import { canEdit, canWrite, useAuth } from '@/lib/auth-context';
import {
  amountToInput,
  formatMoney,
  parseAmount,
  vatRateLabel,
} from '@/lib/format';
import {
  Alert,
  Button,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Select,
  errorMessage,
} from '@/components/ui';

/**
 * Catalogue d'articles et prestations : accélère la saisie des
 * factures. Modifier un prix ici n'affecte jamais une facture
 * déjà émise — chaque ligne porte son propre prix.
 */
export default function CatalogPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const { current } = useAuth();
  const writable = canWrite(current?.role);

  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      setItems(await api.get<Product[]>(`/entities/${entityId}/products${query}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, [entityId, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader
        title="Catalogue"
        subtitle="Articles et prestations réutilisables dans vos factures."
        action={
          writable ? (
            <Button onClick={() => setEditing('new')}>Nouvel article</Button>
          ) : undefined
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher par libellé ou référence"
        aria-label="Rechercher dans le catalogue"
        className="w-full h-9 px-3 bg-paper border border-line rounded-[4px] text-sm focus:border-primary focus:outline-none"
      />

      <Panel>
        {loading && items.length === 0 ? (
          <p className="px-4 py-8 text-sm text-inksoft text-center">Chargement…</p>
        ) : items.length === 0 ? (
          <Empty
            title={search ? 'Aucun résultat.' : 'Votre catalogue est vide.'}
            action={
              !search && writable ? (
                <Button onClick={() => setEditing('new')}>Ajouter le premier article</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => setEditing(product)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {product.label}
                    </span>
                    <span className="block text-xs text-inksoft">
                      {product.reference ? `${product.reference} · ` : ''}
                      {product.isService ? 'Prestation' : 'Article'} ·{' '}
                      {vatRateLabel[product.vatRate]}
                    </span>
                  </div>
                  <span className="text-sm font-medium tabular shrink-0">
                    {formatMoney(product.unitPrice)}
                    <span className="text-xs text-inksoft font-normal"> HT / {product.unit}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <ProductDialog
          entityId={entityId}
          product={editing === 'new' ? null : editing}
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

function ProductDialog({
  entityId,
  product,
  canDelete,
  onClose,
  onSaved,
}: {
  entityId: string;
  product: Product | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    label: product?.label ?? '',
    reference: product?.reference ?? '',
    price: product ? amountToInput(product.unitPrice) : '',
    unit: product?.unit ?? 'unité',
    vatRate: product?.vatRate ?? 'STANDARD',
    isService: product?.isService ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        label: form.label.trim(),
        reference: form.reference.trim() || undefined,
        unitPrice: parseAmount(form.price),
        unit: form.unit.trim() || 'unité',
        vatRate: form.vatRate,
        isService: form.isService,
      };
      if (product) await api.put(`/entities/${entityId}/products/${product.id}`, body);
      else await api.post(`/entities/${entityId}/products`, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Enregistrement impossible.'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!product) return;
    setBusy(true);
    try {
      await api.delete(`/entities/${entityId}/products/${product.id}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Suppression impossible.'));
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? 'Modifier l’article' : 'Nouvel article'} onClose={onClose}>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Libellé">
        <Input value={form.label} maxLength={255} onChange={(e) => set('label')(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Prix unitaire HT (FCFA)">
          <Input
            inputMode="numeric"
            value={form.price}
            onChange={(e) => set('price')(e.target.value)}
          />
        </Field>
        <Field label="Unité">
          <Input value={form.unit} maxLength={30} onChange={(e) => set('unit')(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="TVA">
          <Select
            value={form.vatRate}
            onChange={(e) => set('vatRate')(e.target.value as Product['vatRate'])}
          >
            {Object.entries(vatRateLabel).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence" hint="Facultatif">
          <Input
            value={form.reference}
            maxLength={60}
            onChange={(e) => set('reference')(e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={form.isService}
          onChange={(e) => set('isService')(e.target.checked)}
        />
        Prestation de service
      </label>

      <div className="flex gap-2 justify-end pt-1">
        {product && canDelete && (
          <Button variant="ghost" className="text-critical mr-auto" onClick={remove} disabled={busy}>
            Supprimer
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button onClick={save} disabled={busy || !form.label.trim() || parseAmount(form.price) < 0}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Modal>
  );
}
