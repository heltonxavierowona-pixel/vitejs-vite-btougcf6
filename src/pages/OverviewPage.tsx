import { Link } from 'react-router-dom'

const STEPS = [
  {
    n: 1, to: '/produits', title: 'Décrivez votre produit',
    text: 'L\'agent en déduit vos cibles, les réseaux adaptés, le ton et les langues.',
  },
  {
    n: 2, to: '/canaux', title: 'Connectez vos comptes',
    text: 'Votre WhatsApp Business (en gardant votre numéro), votre Page Facebook et votre Instagram.',
  },
  {
    n: 3, to: '/prospects', title: 'Trouvez vos prospects',
    text: 'Profils LinkedIn/X qualifiés par l\'IA, liens WhatsApp traçables, mots-clés en commentaire.',
  },
  {
    n: 4, to: '/conversations', title: 'Répondez depuis la plateforme',
    text: 'Vos clients restent sur WhatsApp ; vous et l\'IA leur répondez d\'ici.',
  },
]

const PARTS = [
  { n: 1, title: 'Fondations SaaS : comptes, produits, connexion des canaux, boîte de réception', status: 'done' },
  { n: 2, title: 'Ciblage & sourcing par produit', status: 'done' },
  { n: 3, title: 'Cerveau IA : rédaction, ton adapté, multilingue, profil relationnel', status: 'done' },
  { n: 4, title: 'Détection d\'intérêt & bascule WhatsApp', status: 'done' },
  { n: 5, title: 'Conversation WhatsApp autonome & validations (prix, contrat)', status: 'done' },
  { n: 6, title: 'Closing (présentation puis appel) & relances (2 max, puis abandon)', status: 'done' },
  { n: 7, title: 'Tableau de bord visuel & alertes immédiates (Telegram, e-mail)', status: 'review' },
] as const

const STATUS_LABEL = { done: 'Validée', review: 'En attente de validation', todo: 'À venir' } as const

export default function OverviewPage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Le Closer</p>
        <h1>Vue d'ensemble</h1>
        <p className="lead">
          Les réseaux sociaux ouvrent la conversation, WhatsApp la conclut, et tout se pilote depuis ici.
        </p>
      </header>

      <div className="steps">
        {STEPS.map((s) => (
          <Link key={s.n} to={s.to} className="card step">
            <span className="roadmap-n">{s.n}</span>
            <strong>{s.title}</strong>
            <p>{s.text}</p>
          </Link>
        ))}
      </div>

      <section className="card">
        <h2>Feuille de route</h2>
        <ol className="roadmap">
          {PARTS.map((p) => (
            <li key={p.n} className={`roadmap-${p.status}`}>
              <span className="roadmap-n">{p.n}</span>
              <span className="roadmap-title">{p.title}</span>
              <span className="roadmap-status">{STATUS_LABEL[p.status]}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
