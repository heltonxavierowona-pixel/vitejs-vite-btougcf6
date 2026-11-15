'use client';

import { useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { Alert, Button, Field, Input, errorMessage } from '@/components/ui';
import { Logo } from '@/components/brand';

/** Demande d'un lien de réinitialisation du mot de passe. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !email) return;
    setError(null);
    setSubmitting(true);
    try {
      const { message } = await api.post<{ message: string }>('/auth/forgot-password', {
        email: email.trim(),
      });
      setSent(message);
    } catch (err) {
      setError(errorMessage(err, 'Envoi impossible. Vérifiez votre connexion.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <Logo variant="full" height={44} priority />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-inksoft">
          Indiquez l’adresse e-mail de votre compte : nous vous envoyons un lien pour choisir un
          nouveau mot de passe.
        </p>

        {sent ? (
          <div className="mt-6 space-y-4">
            <Alert tone="info">{sent}</Alert>
            <p className="text-sm text-inksoft">
              Le lien est valable une heure. Rien reçu ?{' '}
              <button type="button" className="text-primary underline" onClick={() => setSent(null)}>
                Renvoyer
              </button>
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-6 bg-paper border border-line rounded-[5px] p-5 space-y-4"
          >
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Adresse e-mail">
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" className="w-full" disabled={submitting || !email}>
              {submitting ? 'Envoi…' : 'Recevoir le lien'}
            </Button>
          </form>
        )}

        <p className="mt-5 text-sm text-center">
          <Link href="/connexion" className="text-primary font-medium">
            ← Retour à la connexion
          </Link>
        </p>
      </div>
    </main>
  );
}
