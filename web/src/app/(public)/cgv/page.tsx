import type { Metadata } from 'next';
import Link from 'next/link';

import { brand } from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { PUBLIC_PLANS } from '@/lib/pricing';
import { CompanyIdentity, LegalPage } from '@/components/public';

export const metadata: Metadata = {
  title: 'Conditions générales de vente',
  description: `Conditions de vente, de résiliation et de remboursement des abonnements ${brand.name}.`,
};

export default function TermsPage() {
  const c = brand.company;
  return (
    <LegalPage title="Conditions générales de vente" updated="29 septembre 2026">
      <p>
        Les présentes conditions régissent la souscription et l’utilisation des abonnements au
        service en ligne {brand.name} (ci-après « le Service »), édité par :
      </p>
      <CompanyIdentity />

      <h2>1. Objet du Service</h2>
      <p>
        {brand.name} est un logiciel en ligne de facturation et de préparation de la déclaration
        de TVA destiné aux entreprises et aux cabinets comptables établis au Cameroun. Il permet
        d’émettre des factures et avoirs, de suivre les encaissements et de calculer la
        déclaration de TVA mensuelle. Le dépôt officiel de la déclaration reste effectué par
        l’utilisateur sur le portail de la Direction générale des impôts (DGI).
      </p>

      <h2>2. Formules et prix</h2>
      <p>Le Service est proposé par abonnement mensuel, aux prix suivants (en francs CFA) :</p>
      <ul>
        {PUBLIC_PLANS.map((plan) => (
          <li key={plan.code}>
            {plan.label} :{' '}
            {plan.priceMonthly === 0 ? 'gratuit' : `${formatMoney(plan.priceMonthly)} par mois`}
          </li>
        ))}
      </ul>
      <p>
        Les prix applicables sont ceux affichés sur la page{' '}
        <Link href="/#tarifs">Tarifs</Link> au moment de la souscription. Toute évolution de prix
        est annoncée par e-mail au moins 30 jours avant de s’appliquer au renouvellement suivant.
      </p>

      <h2>3. Essai gratuit</h2>
      <p>
        Toute nouvelle inscription bénéficie d’un essai gratuit de 14 jours (entreprises) ou de 30
        jours (cabinets comptables), sans moyen de paiement. À l’issue de l’essai, le Service
        passe en consultation seule tant qu’aucune formule n’est souscrite. Aucun prélèvement
        n’intervient sans souscription expresse.
      </p>

      <h2>4. Paiement</h2>
      <ul>
        <li>
          <strong>Carte bancaire</strong> (Visa, Mastercard) : le paiement est traité par Stripe.
          Le montant de la formule est prélevé à la souscription puis automatiquement chaque mois,
          à la date anniversaire, jusqu’à résiliation.
        </li>
        <li>
          <strong>Mobile Money</strong> (MTN Mobile Money, Orange Money) : le paiement est traité
          par Flutterwave. Chaque mois est payé à l’avance ; un rappel est envoyé avant l’échéance.
        </li>
      </ul>
      <p>
        {brand.name} n’a jamais accès aux numéros de carte ni aux identifiants Mobile Money, saisis
        exclusivement sur les pages sécurisées de ces prestataires. Une facture est disponible
        pour chaque paiement.
      </p>

      <h2>5. Défaut de paiement</h2>
      <p>
        En cas d’échec d’un paiement, l’accès complet est maintenu pendant une période de grâce de
        15 jours pour permettre la régularisation. Passé ce délai, le compte passe en consultation
        seule : les données restent accessibles, la saisie est suspendue jusqu’au paiement.
      </p>

      <h2 id="resiliation">6. Résiliation et remboursement</h2>
      <ul>
        <li>
          L’abonnement est <strong>sans engagement</strong> et peut être résilié à tout moment,
          en un clic, depuis la page Abonnement du Service, ou sur simple demande à{' '}
          <a href={`mailto:${c.email}`}>{c.email}</a>.
        </li>
        <li>
          La résiliation prend effet à la <strong>fin de la période mensuelle en cours</strong>,
          déjà payée : aucun nouveau prélèvement n’est effectué et l’accès complet est maintenu
          jusqu’à cette date.
        </li>
        <li>
          Le mois entamé n’est pas remboursé, sauf en cas de dysfonctionnement du Service qui nous
          est imputable et vous empêche de l’utiliser : le mois concerné est alors remboursé sur
          demande.
        </li>
        <li>
          En cas de changement de formule en cours de mois par carte bancaire, le temps non
          consommé de l’ancienne formule est déduit au prorata de la facture suivante.
        </li>
        <li>
          Toute demande de remboursement est traitée sous 14 jours et remboursée sur le moyen de
          paiement d’origine.
        </li>
      </ul>

      <h2>7. Données et réversibilité</h2>
      <p>
        L’utilisateur reste propriétaire de ses données. Après résiliation, factures et
        déclarations restent consultables et téléchargeables en PDF. Le traitement des données
        personnelles est décrit dans la <Link href="/confidentialite">politique de confidentialité</Link>.
      </p>

      <h2>8. Responsabilités</h2>
      <p>
        {brand.name} calcule la TVA selon les règles en vigueur qu’il intègre, mais ne remplace
        pas le conseil d’un expert-comptable. L’utilisateur reste responsable de l’exactitude des
        informations saisies et du dépôt de ses déclarations dans les délais légaux.
      </p>

      <h2>9. Réclamations et droit applicable</h2>
      <p>
        Toute réclamation peut être adressée à <a href={`mailto:${c.email}`}>{c.email}</a>. Les
        présentes conditions sont régies par le droit applicable au siège de l’éditeur ; à défaut
        d’accord amiable, le litige est porté devant les juridictions compétentes de ce ressort.
      </p>
    </LegalPage>
  );
}
