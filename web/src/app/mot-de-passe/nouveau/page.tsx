'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { Alert, Button, Field, Input, Loading, errorMessage } from '@/components/ui';
import { Logo } from '@/components/brand';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

/** Choix du nouveau mot de passe depuis le lien reçu par e-mail. */
function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || password.length < 10 || password !== confirm) return;
    setError(null);
    setSubmitting(true);
    try {
      const { message } = await api.post<{ message: string }>('/auth/reset-password', {
        token,
        password,
      });
      setDone(message);
    } catch (err) {
      setError(errorMessage(err, 'Modification impossible. Vérifiez votre connexion.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <Logo variant="full" height={44} priority />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">Nouveau mot de passe</h1>

        {!token ? (
          <div className="mt-6 space-y-4">
            <Alert tone="error">Ce lien est incomplet. Faites une nouvelle demande.</Alert>
            <Link href="/mot-de-passe-oublie" className="text-sm text-primary font-medium">
              Recevoir un nouveau lien
            </Link>
          </div>
        ) : done ? (
          <div className="mt-6 space-y-4">
            <Alert tone="info">{done}</Alert>
            <Link
              href="/connexion"
              className="flex items-center justify-center h-10 rounded-[4px] bg-primary text-white text-sm font-medium hover:bg-primaryhover"
            >
              Se connecter
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-6 bg-paper border border-line rounded-[5px] p-5 space-y-4"
          >
            {error && (
              <Alert tone="error">
                {error}{' '}
                {/expiré|utilisé|invalide/i.test(error) && (
                  <Link href="/mot-de-passe-oublie" className="underline font-medium">
                    Nouvelle demande
                  </Link>
                )}
              </Alert>
            )}
            <Field
              label="Nouveau mot de passe"
              hint="10 caractères minimum."
              error={tooShort ? 'Au moins 10 caractères.' : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                maxLength={128}
              />
            </Field>
            <Field
              label="Confirmez le mot de passe"
              error={mismatch ? 'Les deux mots de passe sont différents.' : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || password.length < 10 || password !== confirm}
            >
              {submitting ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
