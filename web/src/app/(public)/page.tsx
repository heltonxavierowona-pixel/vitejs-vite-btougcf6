import type { Metadata } from 'next';
import Link from 'next/link';

import { brand } from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { PUBLIC_PLANS } from '@/lib/pricing';
import { SessionRedirect } from '@/components/session-redirect';

export const metadata: Metadata = {
  title: { absolute: `${brand.name} — Factures conformes et déclaration de TVA au Cameroun` },
  description: brand.description,
};

const FEATURES = [
  {
    title: 'Factures normalisées',
    text: 'Numérotation continue, NIU du client, ventilation de la TVA à 19,25 %, montant en toutes lettres et PDF prêt à envoyer.',
  },
  {
    title: 'Déclaration de TVA en un clic',
    text: 'Le mois de factures devient une déclaration calculée : TVA collectée, déductible, crédit reporté, déclaration néant.',
  },
  {
    title: 'Jamais de pénalité oubliée',
    text: 'Compte à rebours jusqu’au 15, alerte sur les brouillons non validés et estimation des majorations de retard.',
  },
  {
    title: 'Avoirs et encaissements',
    text: 'Corrigez une facture par avoir, suivez les règlements Mobile Money, espèces ou virement et ce qu’on vous doit.',
  },
  {
    title: 'Pensé pour les cabinets',
    text: 'Tout le portefeuille sur un écran, trié par urgence, avec la charge de chaque collaborateur.',
  },
  {
    title: 'Données protégées',
    text: 'Dossiers strictement cloisonnés, journal d’audit de chaque opération, connexion chiffrée.',
  },
];

const FAQ = [
  {
    q: 'Faut-il une carte bancaire pour l’essai ?',
    a: 'Non. L’essai gratuit (7 jours pour une entreprise, 14 jours pour un cabinet) s’ouvre à l’inscription, sans moyen de paiement.',
  },
  {
    q: 'Comment payer l’abonnement ?',
    a: 'Par MTN Mobile Money ou Orange Money : nous vous envoyons un lien de paiement sécurisé par e-mail ou WhatsApp. Chaque mois se paie à l’avance, avec un rappel avant chaque échéance : jamais de prélèvement surprise.',
  },
  {
    q: 'Puis-je résilier à tout moment ?',
    a: 'Oui, en un clic depuis la page Abonnement. L’accès reste ouvert jusqu’à la fin du mois payé, et vos factures et déclarations restent consultables ensuite.',
  },
  {
    q: 'Numera dépose-t-il la déclaration à ma place ?',
    a: 'Numera prépare la déclaration et le récapitulatif. Le dépôt se fait sur le portail de la DGI, puis vous enregistrez la référence de l’accusé dans Numera.',
  },
];

export default function LandingPage() {
  const pme = PUBLIC_PLANS.filter((p) => p.audience === 'ENTREPRISE');
  const cabinet = PUBLIC_PLANS.filter((p) => p.audience === 'CABINET');

  return (
    <>
      <SessionRedirect />

      {/* ---- Accroche ---- */}
      <section className="bg-paper border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <p className="text-sm font-medium text-primary">{brand.claim}</p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tight max-w-3xl leading-tight">
            Vos factures conformes et votre TVA déclarée avant le 15, sans stress.
          </h1>
          <p className="mt-5 text-lg text-inksoft max-w-2xl">
            {brand.name} est le logiciel de facturation et de déclaration de TVA des PME et des
            cabinets comptables du Cameroun.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/inscription"
              className="px-6 h-12 leading-[3rem] rounded-[4px] bg-primary text-white font-medium hover:bg-primaryhover"
            >
              Essayer gratuitement
            </Link>
            <Link
              href="#tarifs"
              className="px-6 h-12 leading-[3rem] rounded-[4px] border border-line bg-paper font-medium hover:bg-surface"
            >
              Voir les tarifs
            </Link>
          </div>
          <p className="mt-3 text-sm text-inksoft">
            Sans carte bancaire · Résiliable à tout moment
          </p>
        </div>
      </section>

      {/* ---- Fonctionnalités ---- */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16" aria-labelledby="fonctionnalites">
        <h2 id="fonctionnalites" className="text-2xl font-semibold tracking-tight">
          Tout ce qu’il faut pour facturer et déclarer
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-paper border border-line rounded-[5px] p-5">
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-inksoft leading-relaxed">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Tarifs ---- */}
      <section id="tarifs" className="bg-paper border-y border-line scroll-mt-4" aria-labelledby="tarifs-titre">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 id="tarifs-titre" className="text-2xl font-semibold tracking-tight">
            Tarifs
          </h2>
          <p className="mt-2 text-inksoft">
            Prix mensuels en francs CFA (FCFA). Sans engagement.
          </p>

          <PlanGroup title="Pour les entreprises" plans={pme} />
          <PlanGroup title="Pour les cabinets comptables" plans={cabinet} />

          <p className="mt-8 text-sm text-inksoft">
            Paiement sécurisé par lien de paiement : MTN Mobile Money ou Orange Money.
            Sans prélèvement automatique. Voir les{' '}
            <Link href="/cgv" className="text-primary underline">
              conditions générales de vente
            </Link>{' '}
            et la{' '}
            <Link href="/cgv#resiliation" className="text-primary underline">
              politique de résiliation et de remboursement
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ---- Questions ---- */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          Questions fréquentes
        </h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <div key={item.q} className="py-4">
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-1.5 text-inksoft leading-relaxed">{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-inksoft">
          Une autre question ?{' '}
          <Link href="/contact" className="text-primary underline">
            Contactez-nous
          </Link>
          .
        </p>
      </section>
    </>
  );
}

function PlanGroup({
  title,
  plans,
}: {
  title: string;
  plans: ReadonlyArray<(typeof PUBLIC_PLANS)[number]>;
}) {
  return (
    <div className="mt-10">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.code} className="border border-line rounded-[5px] p-5 flex flex-col">
            <h4 className="font-medium">{plan.label}</h4>
            <p className="mt-2">
              <span className="text-2xl font-semibold tabular">
                {plan.priceMonthly === 0 ? 'Gratuit' : formatMoney(plan.priceMonthly)}
              </span>
              {plan.priceMonthly > 0 && <span className="text-sm text-inksoft"> / mois</span>}
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-inksoft flex-1">
              {plan.features.map((feature) => (
                <li key={feature}>✓ {feature}</li>
              ))}
            </ul>
            <Link
              href="/inscription"
              className="mt-5 text-center h-10 leading-10 rounded-[4px] border border-line font-medium text-sm hover:bg-surface"
            >
              {plan.trialDays > 0 ? `Essai gratuit ${plan.trialDays} jours` : 'Commencer'}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
