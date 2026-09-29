import type { Metadata } from 'next';

import { brand } from '@/lib/brand';
import { LegalPage } from '@/components/public';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Contacter l’équipe ${brand.name}.`,
};

export default function ContactPage() {
  const c = brand.company;
  const address = [c.address, c.city, c.country].filter(Boolean).join(', ');
  return (
    <LegalPage title="Nous contacter" updated="29 septembre 2026">
      <p>
        Une question sur {brand.name}, votre abonnement ou une facture ? Notre équipe vous répond
        par e-mail sous un jour ouvré.
      </p>
      <dl className="bg-paper border border-line rounded-[5px] divide-y divide-line not-prose">
        <div className="px-4 py-3">
          <dt className="text-sm text-inksoft">E-mail</dt>
          <dd><a href={`mailto:${c.email}`}>{c.email}</a></dd>
        </div>
        {c.phone && (
          <div className="px-4 py-3">
            <dt className="text-sm text-inksoft">Téléphone / WhatsApp</dt>
            <dd><a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a></dd>
          </div>
        )}
        {address && (
          <div className="px-4 py-3">
            <dt className="text-sm text-inksoft">Adresse</dt>
            <dd>{address}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-inksoft">
        Pour une demande de résiliation ou de remboursement, précisez le nom de votre organisation
        et l’adresse e-mail du compte.
      </p>
    </LegalPage>
  );
}
