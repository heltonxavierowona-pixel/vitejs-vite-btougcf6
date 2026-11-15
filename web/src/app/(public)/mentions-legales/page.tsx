import type { Metadata } from 'next';

import { brand } from '@/lib/brand';
import { CompanyIdentity, LegalPage } from '@/components/public';

export const metadata: Metadata = { title: 'Mentions légales' };

export default function LegalNoticePage() {
  const c = brand.company;
  return (
    <LegalPage title="Mentions légales" updated="29 septembre 2026">
      <h2>Éditeur du site</h2>
      <CompanyIdentity />
      {c.publisher && <p>Responsable de la publication : {c.publisher}</p>}

      <h2>Hébergement</h2>
      <p>{c.host}</p>

      <h2>Propriété intellectuelle</h2>
      <p>
        La marque {brand.name}, son logo et l’ensemble des contenus de ce site sont protégés.
        Toute reproduction sans autorisation est interdite.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${c.email}`}>{c.email}</a>
      </p>
    </LegalPage>
  );
}
