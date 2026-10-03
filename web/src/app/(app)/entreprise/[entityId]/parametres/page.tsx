'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth-context';
import { legalFormLabel, taxRegimeLabel } from '@/lib/format';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  errorMessage,
} from '@/components/ui';

interface EntityDetail {
  id: string;
  niu: string;
  legalName: string;
  tradeName: string | null;
  legalForm: string;
  rccm: string | null;
  taxRegime: string;
  taxCenter: string | null;
  isVatSubject: boolean;
  address: string;
  city: string;
  poBox: string | null;
  phone: string;
  email: string | null;
  activity: string | null;
  invoicePrefix: string;
  creditNotePrefix: string;
  isActive: boolean;
}

const FIELDS = [
  'legalName',
  'tradeName',
  'niu',
  'rccm',
  'legalForm',
  'taxRegime',
  'taxCenter',
  'isVatSubject',
  'address',
  'city',
  'poBox',
  'phone',
  'email',
  'activity',
  'invoicePrefix',
  'creditNotePrefix',
] as const;

type Form = Pick<EntityDetail, (typeof FIELDS)[number]>;

/** Champs facultatifs : vidés, ils sont envoyés à null (effacement). */
const OPTIONAL = new Set(['tradeName', 'rccm', 'taxCenter', 'poBox', 'email', 'activity']);

/**
 * Paramètres du dossier : identité fiscale et coordonnées
 * imprimées sur les factures. Le NIU et les préfixes de
 * numérotation se verrouillent dès la première facture émise
 * (contrôle côté serveur).
 */
export default function EntitySettingsPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const router = useRouter();
  const { current } = useAuth();
  const base = `/organizations/${current?.organizationId}/entities/${entityId}`;

  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!current) return;
    api
      .get<EntityDetail>(base)
      .then((data) => {
        setEntity(data);
        setForm(Object.fromEntries(FIELDS.map((f) => [f, data[f]])) as unknown as Form);
      })
      .catch((err) => setError(errorMessage(err, 'Chargement impossible')));
  }, [base, current]);

  if (error && !form) {
    return (
      <div className="p-6">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!form || !entity || !current) return <Loading />;

  const admin = isAdmin(current.role);
  const set =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]) => {
      setSaved(false);
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    };

  async function save() {
    if (!form || !entity) return;
    setBusy(true);
    setError(null);
    try {
      // Envoi des seuls champs modifiés (mise à jour partielle).
      const changes = Object.fromEntries(
        FIELDS.filter((f) => form[f] !== entity[f]).map((f) => {
          const value = form[f];
          if (typeof value !== 'string') return [f, value];
          const trimmed = value.trim();
          return [f, trimmed === '' && OPTIONAL.has(f) ? null : trimmed];
        }),
      );
      if (Object.keys(changes).length > 0) {
        const updated = await api.put<EntityDetail>(base, changes);
        setEntity(updated);
      }
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!entity) return;
    setBusy(true);
    setError(null);
    try {
      if (entity.isActive) {
        await api.delete(base);
        router.push('/cabinet');
      } else {
        await api.post(`${base}/restore`);
        setEntity({ ...entity, isActive: true });
      }
      setConfirmArchive(false);
    } catch (err) {
      setError(errorMessage(err, 'Action impossible.'));
      setConfirmArchive(false);
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof Form, label: string, hint?: string, max = 255) => (
    <Field label={label} hint={hint}>
      <Input
        value={(form[key] as string | null) ?? ''}
        maxLength={max}
        disabled={!admin}
        onChange={(e) => set(key)(e.target.value as never)}
      />
    </Field>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Paramètres du dossier"
        subtitle="Ces informations sont imprimées sur les factures et les déclarations."
      />

      {!admin && (
        <Alert tone="info">
          Seul un administrateur de l’organisation peut modifier ces informations.
        </Alert>
      )}
      {!entity.isActive && (
        <Alert tone="warning">
          Ce dossier est archivé : il reste consultable mais ne peut plus être modifié.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Modifications enregistrées.</Alert>}

      <Panel title="Identification">
        <div className="p-4 space-y-4">
          {text('legalName', 'Raison sociale')}
          {text('tradeName', 'Nom commercial', 'Facultatif')}
          <div className="grid sm:grid-cols-2 gap-4">
            {text('niu', 'NIU', 'Non modifiable après la première facture', 30)}
            {text('rccm', 'RCCM', 'Mention obligatoire sur vos factures (CGI art. 150)', 50)}
          </div>
          <Field label="Forme juridique">
            <Select
              value={form.legalForm}
              disabled={!admin}
              onChange={(e) => set('legalForm')(e.target.value)}
            >
              {Object.entries(legalFormLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {text('activity', 'Activité principale', 'Facultatif', 180)}
        </div>
      </Panel>

      <Panel title="Situation fiscale">
        <div className="p-4 space-y-4">
          <Field label="Régime">
            <Select
              value={form.taxRegime}
              disabled={!admin}
              onChange={(e) => set('taxRegime')(e.target.value)}
            >
              {Object.entries(taxRegimeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {text('taxCenter', 'Centre des impôts', 'Facultatif', 120)}
          <label className="flex items-center gap-2.5 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={form.isVatSubject}
              disabled={!admin}
              onChange={(e) => set('isVatSubject')(e.target.checked)}
            />
            Assujettie à la TVA
          </label>
        </div>
      </Panel>

      <Panel title="Coordonnées">
        <div className="p-4 space-y-4">
          {text('address', 'Adresse')}
          <div className="grid sm:grid-cols-3 gap-4">
            {text('city', 'Ville', undefined, 120)}
            {text('poBox', 'Boîte postale', 'Facultatif', 30)}
            {text('phone', 'Téléphone', undefined, 40)}
          </div>
          {text('email', 'E-mail', 'Facultatif', 180)}
        </div>
      </Panel>

      <Panel title="Numérotation">
        <div className="p-4 space-y-4">
          <p className="text-sm text-inksoft">
            Format : PRÉFIXE-ANNÉE-00001. Les préfixes ne peuvent plus changer une
            fois une facture émise, pour préserver la continuité de la séquence.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {text('invoicePrefix', 'Préfixe des factures', undefined, 10)}
            {text('creditNotePrefix', 'Préfixe des avoirs', undefined, 10)}
          </div>
        </div>
      </Panel>

      {admin && (
        <div className="flex flex-wrap gap-2 justify-between">
          {current.organizationType === 'CABINET' ? (
            <Button
              variant="ghost"
              className={entity.isActive ? 'text-critical' : ''}
              onClick={() => setConfirmArchive(true)}
              disabled={busy}
            >
              {entity.isActive ? 'Archiver le dossier' : 'Réactiver le dossier'}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={busy || !entity.isActive}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      )}

      {confirmArchive && (
        <Modal
          title={entity.isActive ? 'Archiver ce dossier' : 'Réactiver ce dossier'}
          onClose={() => setConfirmArchive(false)}
        >
          <p className="text-sm">
            {entity.isActive
              ? 'Le dossier sort du portefeuille actif et ne compte plus dans votre forfait. Ses factures et déclarations restent consultables. Toutes ses déclarations doivent être déposées.'
              : 'Le dossier revient dans le portefeuille actif et compte à nouveau dans votre forfait.'}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
              Annuler
            </Button>
            <Button
              variant={entity.isActive ? 'danger' : 'primary'}
              onClick={toggleArchive}
              disabled={busy}
            >
              Confirmer
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
