'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useAuth } from '@/lib/auth-context';
import { legalFormLabel, taxRegimeLabel } from '@/lib/format';
import { Alert, Button, Field, Input, Select, errorMessage } from '@/components/ui';
import { Logo } from '@/components/brand';

type AccountType = 'ENTREPRISE' | 'CABINET';

/**
 * Le choix entreprise / cabinet est fait ici. Il détermine le
 * dashboard affiché ensuite — c'est la seule divergence de
 * parcours entre les deux publics.
 */
export default function RegisterPage() {
  const { register } = useAuth();
  const [step, setStep] = useState<'type' | 'account' | 'company'>('type');
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    organizationName: '',
    niu: '',
    legalName: '',
    legalForm: 'SARL',
    taxRegime: 'RSI',
    isVatSubject: false,
    address: '',
    city: '',
  });

  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const accountComplete =
    form.firstName.trim() &&
    form.lastName.trim() &&
    emailValid &&
    form.password.length >= 10 &&
    form.organizationName.trim().length >= 2;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        organizationName: form.organizationName,
        organizationType: accountType,
        ...(accountType === 'ENTREPRISE' && {
          entity: {
            niu: form.niu,
            legalName: form.legalName,
            legalForm: form.legalForm,
            taxRegime: form.taxRegime,
            isVatSubject: form.isVatSubject,
            address: form.address,
            city: form.city,
            phone: form.phone,
          },
        }),
      });
    } catch (err) {
      setError(errorMessage(err, 'Inscription impossible.'));
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Logo variant="full" height={36} priority />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Créer votre compte
        </h1>
        <p className="mt-1 text-sm text-inksoft">
          Essai gratuit, sans moyen de paiement.
        </p>

        <div className="mt-7 bg-paper border border-line rounded-[5px] p-5 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          {/* ---- Étape 1 : type de compte ---- */}
          {step === 'type' && (
            <>
              <p className="text-sm text-inksoft">
                Cette réponse détermine votre espace de travail.
              </p>

              <button
                type="button"
                onClick={() => {
                  setAccountType('ENTREPRISE');
                  setStep('account');
                }}
                className="w-full text-left p-4 border border-line rounded-[4px] hover:border-primary transition-colors"
              >
                <span className="block font-medium">Mon entreprise</span>
                <span className="block mt-1 text-sm text-inksoft">
                  Je gère la facturation et la TVA de ma propre société.
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAccountType('CABINET');
                  setStep('account');
                }}
                className="w-full text-left p-4 border border-line rounded-[4px] hover:border-primary transition-colors"
              >
                <span className="block font-medium">Cabinet comptable</span>
                <span className="block mt-1 text-sm text-inksoft">
                  Je suis les déclarations de plusieurs entreprises clientes.
                </span>
              </button>
            </>
          )}

          {/* ---- Étape 2 : compte utilisateur ---- */}
          {step === 'account' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prénom">
                  <Input
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={(e) => set('firstName')(e.target.value)}
                  />
                </Field>
                <Field label="Nom">
                  <Input
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={(e) => set('lastName')(e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Adresse e-mail">
                <Input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set('email')(e.target.value)}
                />
              </Field>

              <Field
                label="Téléphone"
                hint={
                  accountType === 'ENTREPRISE'
                    ? 'Figurera sur vos factures ; sert aussi au paiement Mobile Money'
                    : 'Utilisé pour le paiement Mobile Money'
                }
              >
                <Input
                  type="tel"
                  autoComplete="tel"
                  placeholder="6XXXXXXXX"
                  value={form.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                />
              </Field>

              <Field label="Mot de passe" hint="10 caractères minimum">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set('password')(e.target.value)}
                />
              </Field>

              <Field
                label={
                  accountType === 'CABINET'
                    ? 'Nom du cabinet'
                    : 'Nom de votre organisation'
                }
              >
                <Input
                  value={form.organizationName}
                  onChange={(e) => set('organizationName')(e.target.value)}
                />
              </Field>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('type')}>
                  Retour
                </Button>
                <Button
                  className="flex-1"
                  onClick={() =>
                    accountType === 'CABINET' ? submit() : setStep('company')
                  }
                  disabled={!accountComplete || submitting}
                >
                  {accountType === 'CABINET'
                    ? submitting
                      ? 'Création…'
                      : 'Créer le compte'
                    : 'Continuer'}
                </Button>
              </div>
            </>
          )}

          {/* ---- Étape 3 : société (entreprises uniquement) ---- */}
          {step === 'company' && (
            <>
              <p className="text-sm text-inksoft">
                Ces informations figureront sur vos factures.
              </p>

              <Field label="Raison sociale">
                <Input
                  value={form.legalName}
                  onChange={(e) => set('legalName')(e.target.value)}
                />
              </Field>

              <Field label="NIU" hint="Numéro d’identifiant unique délivré par la DGI">
                <Input
                  value={form.niu}
                  onChange={(e) =>
                    set('niu')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
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

                <Field label="Régime fiscal">
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
              </div>

              <Field label="Adresse">
                <Input
                  value={form.address}
                  onChange={(e) => set('address')(e.target.value)}
                />
              </Field>

              <Field label="Ville">
                <Input
                  value={form.city}
                  onChange={(e) => set('city')(e.target.value)}
                />
              </Field>

              {form.phone.trim().length < 6 && (
                <Alert tone="warning">
                  Revenez à l’étape précédente pour saisir le téléphone de la
                  société : il est obligatoire sur une facture normalisée.
                </Alert>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isVatSubject}
                  onChange={(e) => set('isVatSubject')(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  Mon entreprise est assujettie à la TVA
                  <span className="block text-xs text-inksoft">
                    Obligatoire au-delà de 50 millions de FCFA de chiffre
                    d’affaires annuel.
                  </span>
                </span>
              </label>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('account')}>
                  Retour
                </Button>
                <Button
                  className="flex-1"
                  onClick={submit}
                  disabled={
                    form.niu.length < 5 ||
                    !form.legalName.trim() ||
                    form.address.trim().length < 2 ||
                    form.city.trim().length < 2 ||
                    form.phone.trim().length < 6 ||
                    submitting
                  }
                >
                  {submitting ? 'Création…' : 'Créer le compte'}
                </Button>
              </div>
            </>
          )}
        </div>

        <p className="mt-5 text-sm text-inksoft text-center">
          Vous avez déjà un compte ?{' '}
          <Link href="/connexion" className="text-primary font-medium">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
