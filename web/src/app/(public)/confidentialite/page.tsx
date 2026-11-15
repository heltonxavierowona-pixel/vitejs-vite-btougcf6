import type { Metadata } from 'next';

import { brand } from '@/lib/brand';
import { CompanyIdentity, LegalPage } from '@/components/public';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: `Comment ${brand.name} collecte, utilise et protège vos données.`,
};

export default function PrivacyPage() {
  const c = brand.company;
  return (
    <LegalPage title="Politique de confidentialité" updated="29 septembre 2026">
      <p>Le responsable du traitement des données collectées par {brand.name} est :</p>
      <CompanyIdentity />

      <h2>Données collectées</h2>
      <ul>
        <li>Compte utilisateur : nom, prénom, adresse e-mail, téléphone, mot de passe (stocké chiffré, jamais en clair).</li>
        <li>Entreprise : raison sociale, NIU, RCCM, adresse, régime fiscal.</li>
        <li>Données de gestion saisies : clients, fournisseurs, factures, règlements, déclarations.</li>
        <li>Données techniques : adresse IP et navigateur, conservés dans le journal de sécurité.</li>
      </ul>
      <p>
        Les données de carte bancaire et de Mobile Money sont traitées directement par Neero,
        notre prestataire de paiement ; {brand.name} n’y a jamais accès.
      </p>

      <h2>Finalités</h2>
      <ul>
        <li>Fournir le Service : facturation, calcul de la TVA, génération des documents.</li>
        <li>Gérer l’abonnement, les paiements et les rappels d’échéance.</li>
        <li>Assurer la sécurité : authentification, prévention des fraudes, journal d’audit.</li>
      </ul>
      <p>Aucune donnée n’est vendue ni utilisée à des fins publicitaires.</p>

      <h2>Destinataires</h2>
      <p>
        Les données ne sont accessibles qu’aux membres de votre organisation, selon les droits
        que vous leur attribuez, et à nos sous-traitants techniques : hébergement (Vercel, Neon)
        et paiements (Neero). Chaque dossier est strictement cloisonné des autres.
      </p>

      <h2>Durée de conservation</h2>
      <p>
        Les données du compte sont conservées pendant toute la durée d’utilisation du Service.
        Les factures et déclarations sont conservées pendant la durée légale de conservation des
        pièces comptables, puis supprimées.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous pouvez accéder à vos données, les rectifier, les exporter ou demander leur
        suppression (sous réserve des obligations légales de conservation) en écrivant à{' '}
        <a href={`mailto:${c.email}`}>{c.email}</a>.
      </p>

      <h2>Cookies</h2>
      <p>
        {brand.name} n’utilise pas de cookie publicitaire ni de traceur tiers. Seul le stockage
        local du navigateur est utilisé pour maintenir votre session ouverte.
      </p>
    </LegalPage>
  );
}
