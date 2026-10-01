import { Link } from 'react-router-dom'
import { COMPANY, whatsappLink } from '../../config/company'
import { demoPlans } from '../../data/demoBilling'
import PublicLayout from './PublicLayout'

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`

const STEPS = [
  { title: 'Il trouve vos prospects', text: 'Sur LinkedIn et X, il repère les profils qui correspondent à votre client idéal et rédige un premier message personnalisé, que vous envoyez en un clic.' },
  { title: 'Il répond sur vos pages', text: 'Sur Facebook et Instagram, il répond aux messages privés et aux commentaires de vos publications, jour et nuit, dans le ton de votre marque.' },
  { title: 'Il conclut sur WhatsApp', text: 'Dès qu\'un prospect est intéressé, la conversation passe sur WhatsApp : présentation, réponses aux objections, relances, prise de rendez-vous.' },
  { title: 'Vous gardez la main', text: 'Prix, contrats et sujets sensibles attendent votre validation. Vous suivez chaque conversation et reprenez la main quand vous voulez.' },
]

export default function LandingPage({ loggedIn = false }: { loggedIn?: boolean }) {
  return (
    <PublicLayout loggedIn={loggedIn}>
      <section className="hero">
        <p className="eyebrow">{COMPANY.name} · Yaoundé, Cameroun</p>
        <h1>L'agent IA qui prospecte sur les réseaux sociaux et conclut sur WhatsApp.</h1>
        <p className="lead">
          {COMPANY.product} trouve vos clients, leur écrit au bon moment et les accompagne jusqu'à la vente,
          sur LinkedIn, X, Facebook, Instagram et WhatsApp. Pensé pour les PME et les indépendants d'Afrique francophone.
        </p>
        <div className="hero-actions">
          <Link className="btn" to={loggedIn ? '/' : '/connexion'}>{loggedIn ? 'Ouvrir mon espace' : 'Essai gratuit de 14 jours'}</Link>
          <a className="btn btn-ghost" href={whatsappLink} target="_blank" rel="noopener noreferrer">Nous écrire sur WhatsApp</a>
        </div>
        <p className="muted small">Sans carte bancaire. Paiement en FCFA par Mobile Money ou carte.</p>
      </section>

      <section className="public-section">
        <h2>Comment ça marche</h2>
        <div className="steps-grid">
          {STEPS.map((s, i) => (
            <article key={s.title} className="card step-card">
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section" id="offres">
        <h2>Offres</h2>
        <p className="muted">Prix mensuels. En annuel, deux mois sont offerts. Sans engagement.</p>
        <div className="plans">
          {demoPlans.map((p) => (
            <article key={p.id} className={`card plan ${p.id === 'pro' ? 'plan-featured' : ''}`}>
              {p.id === 'pro' && <span className="plan-flag">Le plus choisi</span>}
              <h3>{p.name}</h3>
              <p className="muted small">{p.description}</p>
              <p className="plan-price">{fcfa(p.prices.XAF.month)}<span className="muted small"> / mois</span></p>
              <ul className="plan-features">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <Link className="btn" to={loggedIn ? '/abonnement' : '/connexion'}>Commencer</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section card" id="contact">
        <h2>Contact</h2>
        <dl className="contact-list">
          <dt>Entreprise</dt><dd>{COMPANY.name}</dd>
          <dt>Adresse</dt><dd>{COMPANY.address}</dd>
          <dt>Téléphone et WhatsApp</dt>
          <dd><a href={`tel:+${COMPANY.phone.replace(/\D/g, '')}`}>{COMPANY.phone}</a> · <a href={whatsappLink} target="_blank" rel="noopener noreferrer">écrire sur WhatsApp</a></dd>
          <dt>E-mail</dt><dd><a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></dd>
        </dl>
      </section>
    </PublicLayout>
  )
}
