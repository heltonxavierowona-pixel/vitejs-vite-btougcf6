'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { Alert, Button, Field, Input, PageHeader, Panel, Select, Textarea, errorMessage } from '@/components/ui';

const AUDIENCES = [
  { value: 'all', label: 'Tous les clients' },
  { value: 'active', label: 'Clients payants' },
  { value: 'trialing', label: 'Clients en essai' },
  { value: 'expiring', label: 'Échéance dans les 7 jours' },
  { value: 'past_due', label: 'Clients en impayé' },
  { value: 'suspended', label: 'Clients suspendus' },
  { value: 'cancelled', label: 'Clients résiliés' },
  { value: 'free', label: 'Formule gratuite' },
];

/** Envoi d'un e-mail à un groupe de clients (un e-mail par client). */
export default function AdminEmailsPage() {
  const [segment, setSegment] = useState('active');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('Bonjour,\n\n');
  const [preview, setPreview] = useState<{ count: number; truncated: boolean; sample: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    api
      .get<{ count: number; truncated: boolean; sample: string[] }>(`/admin/emails/recipients?segment=${segment}`)
      .then(setPreview)
      .catch((err) => setError(errorMessage(err, 'Destinataires indisponibles')));
  }, [segment]);

  async function send() {
    setBusy('send');
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ sent: number; failed: string[]; total: number; lastError: string | null }>('/admin/emails', {
        segment,
        subject,
        message,
      });
      setNotice(
        `${r.sent} e-mail(s) envoyé(s) sur ${r.total}.` +
          (r.failed.length ? ` Échecs : ${r.failed.join(', ')}${r.lastError ? ` (${r.lastError})` : ''}.` : ''),
      );
      if (!r.failed.length) {
        setSubject('');
        setMessage('Bonjour,\n\n');
      }
    } catch (err) {
      setError(errorMessage(err, 'Envoi impossible.'));
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  async function remindTrials() {
    setBusy('trials');
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ sent: number; eligible: number; lastError: string | null }>('/admin/trial-reminders', {});
      setNotice(
        r.eligible
          ? `${r.sent} relance(s) envoyée(s) sur ${r.eligible}.${r.lastError ? ` Échec : ${r.lastError}` : ''}`
          : 'Aucun client en essai à relancer (déjà relancés dans les dernières 24 h ou déjà abonnés).',
      );
    } catch (err) {
      setError(errorMessage(err, 'Relance impossible.'));
    } finally {
      setBusy(null);
    }
  }

  const valid = subject.trim().length >= 3 && message.trim().length >= 10 && !!preview?.count && !preview.truncated;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader title="E-mails aux clients" subtitle="Chaque client reçoit son propre e-mail : personne ne voit l’adresse des autres." />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <Panel title="Relance des clients en essai">
        <div className="p-4 space-y-3 text-sm">
          <p className="text-inksoft">
            Envoie à chaque client en essai qui ne s’est pas encore abonné un rappel de la fin de son essai, avec le
            lien vers la page Abonnement. Un client déjà relancé dans les dernières 24 h est ignoré.
          </p>
          <Button onClick={() => void remindTrials()} disabled={busy !== null}>
            {busy === 'trials' ? 'Envoi…' : 'Relancer les clients en essai'}
          </Button>
        </div>
      </Panel>

      <Panel title="Nouveau message">
        <form
          className="p-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
        >
          <Field label="Destinataires">
            <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-inksoft -mt-2" aria-live="polite">
            {!preview
              ? 'Calcul des destinataires…'
              : preview.truncated
                ? 'Plus de 100 destinataires : choisissez un groupe plus restreint (limite d’envoi de Gmail).'
                : preview.count === 0
                  ? 'Aucun client dans ce groupe.'
                  : `${preview.count} destinataire(s) : ${preview.sample.join(', ')}${preview.count > preview.sample.length ? '…' : ''}`}
          </p>
          <Field label="Objet">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={150} />
          </Field>
          <Field label="Message" hint="Texte simple. La signature « L’équipe Numera » est ajoutée automatiquement.">
            <Textarea rows={10} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} maxLength={5000} />
          </Field>

          {confirming ? (
            <div className="rounded-[4px] border border-line bg-surface p-3 space-y-3">
              <p className="text-sm">
                Envoyer « {subject.trim()} » à <strong>{preview?.count}</strong> client(s) ?
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void send()} disabled={busy !== null}>
                  {busy === 'send' ? 'Envoi en cours…' : 'Confirmer l’envoi'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={busy !== null}>
                  Modifier
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" disabled={!valid || busy !== null}>
              Envoyer…
            </Button>
          )}
        </form>
      </Panel>
    </div>
  );
}
