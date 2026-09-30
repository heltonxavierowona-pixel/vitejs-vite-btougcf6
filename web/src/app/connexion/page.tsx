'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useAuth } from '@/lib/auth-context';
import { brand } from '@/lib/brand';
import { Alert, Button, Field, Input, errorMessage } from '@/components/ui';
import { Logo } from '@/components/brand';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (submitting || !email || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err, 'Connexion impossible. Vérifiez votre réseau.'));
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="sr-only">Connexion à {brand.name}</h1>
        <Logo variant="full" height={44} priority />
        <p className="mt-4 text-sm text-inksoft">{brand.description}</p>

        <form
          onSubmit={handleSubmit}
          className="mt-7 bg-paper border border-line rounded-[5px] p-5 space-y-4"
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

          <Field label="Mot de passe">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          <div className="-mt-2 text-right">
            <Link href="/mot-de-passe-oublie" className="text-sm text-primary">
              Mot de passe oublié ?
            </Link>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || !email || !password}
          >
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>

        <p className="mt-5 text-sm text-inksoft text-center">
          Pas encore de compte ?{' '}
          <Link href="/inscription" className="text-primary font-medium">
            Créer un compte
          </Link>
        </p>
      </div>
    </main>
  );
}
