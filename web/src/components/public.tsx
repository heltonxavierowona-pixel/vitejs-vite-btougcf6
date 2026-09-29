import Link from 'next/link';

import { brand } from '@/lib/brand';
import { Logo } from '@/components/brand';

/* ============================================================
   SITE PUBLIC — en-tête, pied de page et gabarit des pages
   légales. Composants serveur : le contenu est livré en HTML,
   lisible par les moteurs de recherche et par la vérification
   des prestataires de paiement, sans exécuter de JavaScript.
   ============================================================ */

export function PublicHeader() {
  return (
    <header className="bg-paper border-b border-line">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href="/" aria-label={`${brand.name} — accueil`}>
          <Logo variant="auto" height={30} priority />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <Link href="/#tarifs" className="hidden sm:block px-3 h-9 leading-9 text-inksoft hover:text-ink">
            Tarifs
          </Link>
          <Link href="/contact" className="hidden sm:block px-3 h-9 leading-9 text-inksoft hover:text-ink">
            Contact
          </Link>
          <Link href="/connexion" className="px-3 h-9 leading-9 font-medium text-ink hover:text-primary">
            Connexion
          </Link>
          <Link
            href="/inscription"
            className="px-4 h-9 leading-9 rounded-[4px] bg-primary text-white font-medium hover:bg-primaryhover"
          >
            Essai gratuit
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const c = brand.company;
  return (
    <footer className="bg-paper border-t border-line mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-3 text-sm">
        <div className="space-y-2">
          <Logo variant="full" height={28} />
          <p className="text-inksoft">{brand.description}</p>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Informations</h2>
          <ul className="space-y-1.5 text-inksoft">
            <li><Link href="/#tarifs" className="hover:text-ink">Tarifs</Link></li>
            <li><Link href="/cgv" className="hover:text-ink">Conditions générales de vente</Link></li>
            <li><Link href="/cgv#resiliation" className="hover:text-ink">Résiliation et remboursement</Link></li>
            <li><Link href="/confidentialite" className="hover:text-ink">Confidentialité</Link></li>
            <li><Link href="/mentions-legales" className="hover:text-ink">Mentions légales</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Contact</h2>
          <ul className="space-y-1.5 text-inksoft">
            <li><a href={`mailto:${c.email}`} className="hover:text-ink">{c.email}</a></li>
            {c.phone && <li><a href={`tel:${c.phone.replace(/\s/g, '')}`} className="hover:text-ink">{c.phone}</a></li>}
            <li>{[c.address, c.city, c.country].filter(Boolean).join(', ')}</li>
          </ul>
        </div>
      </div>
      <p className="max-w-6xl mx-auto px-4 sm:px-6 pb-8 text-xs text-inksoft">
        © {new Date().getFullYear()} {c.legalName}. Tous droits réservés. Paiements sécurisés par
        Notch Pay (MTN Mobile Money, Orange Money, carte bancaire).
      </p>
    </footer>
  );
}

/** Gabarit des pages de texte (CGV, confidentialité, mentions). */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-inksoft">Dernière mise à jour : {updated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-primary [&_a]:underline">
        {children}
      </div>
    </article>
  );
}

/** Identité de l'éditeur, en lignes ; les champs vides sont omis. */
export function CompanyIdentity() {
  const c = brand.company;
  const lines = [
    [c.legalName, c.legalForm].filter(Boolean).join(', '),
    c.registration && `Immatriculation : ${c.registration}`,
    [c.address, c.city, c.country].filter(Boolean).join(', '),
    `E-mail : ${c.email}`,
    c.phone && `Téléphone : ${c.phone}`,
  ].filter(Boolean);
  return (
    <p>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line}
        </span>
      ))}
    </p>
  );
}
