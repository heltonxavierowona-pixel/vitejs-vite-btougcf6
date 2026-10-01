import { Link } from 'react-router-dom'
import { COMPANY } from '../../config/company'
import PublicLayout from './PublicLayout'

const UPDATED = '1er octobre 2026'

function Doc({ title, loggedIn, children }: { title: string; loggedIn?: boolean; children: React.ReactNode }) {
  return (
    <PublicLayout loggedIn={loggedIn}>
      <article className="legal card">
        <h1>{title}</h1>
        <p className="muted small">Dernière mise à jour : {UPDATED}</p>
        {children}
      </article>
    </PublicLayout>
  )
}

const Mail = () => <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>

export function MentionsPage({ loggedIn }: { loggedIn?: boolean }) {
  return (
    <Doc title="Mentions légales" loggedIn={loggedIn}>
      <h2>Éditeur</h2>
      <p>
        {COMPANY.product} est un service édité par <strong>{COMPANY.name}</strong>, {COMPANY.address}.<br />
        Responsable de la publication : {COMPANY.owner}.<br />
        Téléphone et WhatsApp : {COMPANY.phone}. E-mail : <Mail />.
      </p>
      <h2>Hébergement</h2>
      <p>
        Site : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.<br />
        Base de données et fonctions serveur : Supabase Inc., données hébergées dans l'Union européenne (Paris).
      </p>
      <h2>Contact</h2>
      <p>Pour toute question sur le site ou le service : <Mail />.</p>
    </Doc>
  )
}

export function PrivacyPage({ loggedIn }: { loggedIn?: boolean }) {
  return (
    <Doc title="Politique de confidentialité" loggedIn={loggedIn}>
      <p>
        Cette politique explique quelles données {COMPANY.name} (« nous ») traite lorsque vous utilisez {COMPANY.product},
        pourquoi, et quels sont vos droits. Responsable du traitement : {COMPANY.name}, {COMPANY.address}, <Mail />.
      </p>

      <h2>1. Données que nous traitons</h2>
      <ul>
        <li><strong>Votre compte</strong> : adresse e-mail, nom de l'entreprise, nom et téléphone indiqués lors de l'abonnement.</li>
        <li><strong>Vos contenus</strong> : produits, ton de marque, réglages de l'agent, que vous saisissez vous-même.</li>
        <li>
          <strong>Données de vos comptes connectés</strong> (Facebook, Instagram, WhatsApp, avec votre autorisation) : identifiants
          de vos Pages et numéros, jetons d'accès, et les messages et commentaires échangés avec vos prospects sur ces comptes.
        </li>
        <li>
          <strong>Données de vos prospects</strong> : nom ou pseudonyme public, messages échangés, numéro WhatsApp lorsqu'ils le
          donnent, et un résumé professionnel de la relation (intérêts, objections). Aucune donnée sensible (santé, religion,
          opinions politiques…) n'est recherchée ni conservée.
        </li>
        <li><strong>Paiements</strong> : formule, montant, référence de transaction. Nous ne voyons jamais vos données de carte ou de Mobile Money.</li>
      </ul>

      <h2>2. Pourquoi</h2>
      <ul>
        <li>Fournir le service : rédiger, envoyer et suivre les messages de prospection et de vente en votre nom.</li>
        <li>Gérer votre abonnement, vos paiements et vous envoyer les e-mails liés au service.</li>
        <li>Assurer la sécurité du service et respecter nos obligations légales.</li>
      </ul>
      <p>Nous ne vendons aucune donnée et ne l'utilisons pas pour de la publicité.</p>

      <h2>3. Données provenant de Meta (Facebook, Instagram, WhatsApp)</h2>
      <p>
        Les données obtenues via les API de Meta servent uniquement à afficher et gérer les conversations de vos propres comptes,
        à rédiger les réponses et à vous alerter. Elles ne sont ni revendues, ni partagées avec d'autres clients, ni utilisées pour
        entraîner des modèles d'IA. Vous pouvez retirer l'accès à tout moment dans les paramètres de votre compte Facebook
        (Paramètres → Intégrations professionnelles) ou depuis la page Canaux de {COMPANY.product}.
      </p>

      <h2>4. Prestataires</h2>
      <p>Nous faisons appel à des prestataires qui traitent les données pour notre compte uniquement :</p>
      <ul>
        <li>Supabase (base de données, Union européenne) et Vercel (hébergement du site) ;</li>
        <li>OpenRouter et les fournisseurs de modèles d'IA qu'il route (rédaction et analyse des messages, sans réutilisation pour l'entraînement) ;</li>
        <li>Meta Platforms (envoi et réception des messages Facebook, Instagram et WhatsApp) ;</li>
        <li>Google (envoi des e-mails du service) et Neero (paiements).</li>
      </ul>

      <h2>5. Durée de conservation</h2>
      <p>
        Les données sont conservées tant que votre compte est actif. Un prospect archivé ou supprimé est effacé de la base ;
        à la fermeture du compte, toutes les données de l'organisation sont supprimées dans un délai de 30 jours,
        sauf les pièces de paiement que la loi nous oblige à garder.
      </p>

      <h2>6. Vos droits</h2>
      <p>
        Vous pouvez demander l'accès, la rectification, la suppression ou la portabilité de vos données, et vous opposer à un
        traitement, en écrivant à <Mail />. Un prospect contacté via {COMPANY.product} peut faire la même demande : il sera
        retiré de toute prospection. Voir aussi la page <Link to="/suppression-des-donnees">Suppression des données</Link>.
      </p>

      <h2>7. Sécurité</h2>
      <p>
        Connexions chiffrées (HTTPS), accès cloisonné par organisation, jetons d'accès conservés côté serveur et jamais
        affichés, secrets stockés dans un coffre chiffré.
      </p>

      <h2>8. Contact</h2>
      <p>{COMPANY.name}, {COMPANY.address}. E-mail : <Mail />. Téléphone : {COMPANY.phone}.</p>
    </Doc>
  )
}

export function TermsPage({ loggedIn }: { loggedIn?: boolean }) {
  return (
    <Doc title="Conditions d'utilisation" loggedIn={loggedIn}>
      <h2>1. Le service</h2>
      <p>
        {COMPANY.product}, édité par {COMPANY.name}, est un logiciel en ligne qui aide les entreprises à prospecter et à vendre
        via les réseaux sociaux et WhatsApp, avec l'aide de l'intelligence artificielle.
      </p>
      <h2>2. Compte et essai</h2>
      <p>
        L'inscription se fait par e-mail. Chaque nouvelle organisation bénéficie d'un essai gratuit de 14 jours, sans moyen de
        paiement. Vous êtes responsable de l'usage fait de votre compte.
      </p>
      <h2>3. Abonnement et paiement</h2>
      <p>
        Les formules et leurs prix sont affichés sur la page Offres. Le paiement se fait en FCFA par lien de paiement
        (Mobile Money ou carte), pour un mois ou un an, sans renouvellement automatique : un lien de renouvellement vous est
        envoyé avant l'échéance. Sans paiement, l'accès est suspendu trois jours après l'échéance. Vous pouvez résilier à tout
        moment ; la période payée reste acquise.
      </p>
      <h2>4. Vos engagements</h2>
      <ul>
        <li>Respecter les conditions de Meta (Facebook, Instagram, WhatsApp), de LinkedIn et de X.</li>
        <li>Ne contacter sur WhatsApp que des personnes qui ont donné leur numéro ou accepté d'être contactées.</li>
        <li>N'envoyer ni spam, ni contenu illégal, trompeur ou offensant, et respecter le refus d'un prospect.</li>
        <li>Vérifier les informations commerciales (prix, conditions) que l'agent communique en votre nom.</li>
      </ul>
      <h2>5. Intelligence artificielle</h2>
      <p>
        Les messages sont rédigés par une IA à partir de vos réglages. Les sujets sensibles (prix, contrats) attendent votre
        validation. Vous restez responsable des messages envoyés depuis vos comptes.
      </p>
      <h2>6. Disponibilité et responsabilité</h2>
      <p>
        Nous faisons notre possible pour assurer un service continu, sans garantie d'absence d'interruption, notamment en cas
        de panne d'un service tiers (Meta, hébergeurs). Notre responsabilité est limitée au montant payé pour les trois
        derniers mois.
      </p>
      <h2>7. Données personnelles</h2>
      <p>Voir la <Link to="/confidentialite">politique de confidentialité</Link>.</p>
      <h2>8. Droit applicable</h2>
      <p>Ces conditions sont régies par le droit camerounais. Contact : <Mail />.</p>
    </Doc>
  )
}

export function DataDeletionPage({ loggedIn }: { loggedIn?: boolean }) {
  return (
    <Doc title="Suppression des données" loggedIn={loggedIn}>
      <p>Vous pouvez faire supprimer à tout moment les données que {COMPANY.product} détient sur vous.</p>
      <h2>Vous êtes client de {COMPANY.product}</h2>
      <ol>
        <li>Pour retirer l'accès à vos comptes Meta : sur Facebook, ouvrez Paramètres → Intégrations professionnelles, sélectionnez {COMPANY.product} et choisissez « Supprimer ». Les jetons d'accès sont alors inutilisables.</li>
        <li>Pour supprimer votre compte et toutes les données de votre organisation (prospects, conversations, produits) : écrivez à <Mail /> depuis l'adresse de votre compte, avec l'objet « Suppression de compte ».</li>
      </ol>
      <h2>Vous avez été contacté via {COMPANY.product}</h2>
      <p>
        Écrivez à <Mail /> en indiquant le nom de l'entreprise qui vous a contacté et votre identifiant (nom du profil ou numéro
        WhatsApp). Vous pouvez aussi simplement répondre « STOP » dans la conversation.
      </p>
      <h2>Délai</h2>
      <p>
        Nous confirmons la réception sous 72 heures et effaçons les données sous 30 jours au plus tard, sauf les pièces de
        paiement que la loi nous oblige à conserver. Un e-mail vous confirme la suppression.
      </p>
    </Doc>
  )
}
