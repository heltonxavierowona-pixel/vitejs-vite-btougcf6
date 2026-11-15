'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { legalFormLabel, taxRegimeLabel } from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  errorMessage,
} from '@/components/ui';

/**
 * Ajout d'une entreprise cliente au portefeuille du cabinet.
 *
 * Le NIU est unique au niveau national : si le dossier existe
 * déjà ailleurs sur la plateforme, l'API refuse la création.
 * On affiche alors le message tel quel plutôt que de le masquer.
 */
export default function NewFolderPage() {
  const router = useRouter();
  const { current } = useAuth();

  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    niu: '',
    rccm: '',
    legalForm: 'SARL',
    taxRegime: 'RSI',
    taxCenter: '',
    isVatSubject: true,
    address: '',
    city: '',
    phone: '',
    email: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const entity = await api.post<{ id: string }>(
        `/organizations/${current.organizationId}/entities`,
        {
          legalName: form.legalName,
          tradeName: form.tradeName || undefined,
          niu: form.niu,
          rccm: form.rccm || undefined,
          legalForm: form.legalForm,
          taxRegime: form.taxRegime,
          taxCenter: form.taxCenter || undefined,
          isVatSubject: form.isVatSubject,
          address: form.address,
          city: form.city,
          phone: form.phone,
          email: form.email || undefined,
        },
      );
      router.push(`/entreprise/${entity.id}`);
    } catch (err) {
      setError(errorMessage(err, 'Création impossible.'));
      setBusy(false);
    }
  }

  const complete =
    form.legalName.trim() &&
    form.niu.length >= 5 &&
    form.address.trim().length >= 2 &&
    form.city.trim().length >= 2 &&
    form.phone.trim().length >= 6;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto">
      <PageHeader
        title="Ajouter un dossier"
        subtitle="Ces informations figureront sur les factures et déclarations de cette entreprise."
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Panel title="Identification">
        <div className="p-4 space-y-4">
          <Field label="Raison sociale">
            <Input
              value={form.legalName}
              onChange={(e) => set('legalName')(e.target.value)}
            />
          </Field>

          <Field label="Nom commercial" hint="Facultatif">
            <Input
              value={form.tradeName}
              onChange={(e) => set('tradeName')(e.target.value)}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="NIU">
              <Input
                value={form.niu}
                onChange={(e) =>
                  set('niu')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
              />
            </Field>
            <Field label="RCCM" hint="Facultatif">
              <Input
                value={form.rccm}
                onChange={(e) => set('rccm')(e.target.value.toUpperCase())}
              />
            </Field>
          </div>

          <Field label="Forme juridique">
            <Select
              value={form.legalForm}
              onChange={(e) => set('legalForm')(e.target.value)}
            >
              {Object.entries(legalFormLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title="Situation fiscale">
        <div className="p-4 space-y-4">
          <Field label="Régime">
            <Select
              value={form.taxRegime}
              onChange={(e) => set('taxRegime')(e.target.value)}
            >
              {Object.entries(taxRegimeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Centre des impôts" hint="Facultatif">
            <Input
              value={form.taxCenter}
              onChange={(e) => set('taxCenter')(e.target.value)}
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
              Assujettie à la TVA
              <span className="block text-xs text-inksoft">
                Détermine si ce dossier apparaît dans les rappels d’échéance
                mensuels.
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Coordonnées">
        <div className="p-4 space-y-4">
          <Field label="Adresse">
            <Input
              value={form.address}
              onChange={(e) => set('address')(e.target.value)}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
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
        </div>
      </Panel>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => router.back()}>
          Annuler
        </Button>
        <Button onClick={save} disabled={busy || !complete}>
          {busy ? 'Création…' : 'Ajouter le dossier'}
        </Button>
      </div>
    </div>
  );
}
