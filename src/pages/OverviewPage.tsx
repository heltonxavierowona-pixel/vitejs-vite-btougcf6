import { Link } from 'react-router-dom'
import { CHANNELS } from '../data/channels'

const PARTS = [
  { n: 1, title: 'Fondations & comptes', status: 'review' },
  { n: 2, title: 'Ciblage & sourcing', status: 'todo' },
  { n: 3, title: 'Cerveau IA (ton, langues, profil relationnel)', status: 'todo' },
  { n: 4, title: 'Détection d\'intérêt & bascule WhatsApp', status: 'todo' },
  { n: 5, title: 'Conversation WhatsApp & validations', status: 'todo' },
  { n: 6, title: 'Closing & relances', status: 'todo' },
  { n: 7, title: 'Dashboard & alertes', status: 'todo' },
] as const

const STATUS_LABEL = { review: 'En attente de validation', todo: 'À venir' } as const

export default function OverviewPage() {
  const outbound = CHANNELS.filter((c) => c.mode === 'assisted')
  const inbound = CHANNELS.filter((c) => c.mode === 'auto' && c.id !== 'whatsapp')

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Le Closer</p>
        <h1>Vue d'ensemble</h1>
        <p className="lead">
          Les réseaux sociaux ouvrent la conversation, WhatsApp la conclut.
        </p>
      </header>

      <section className="card">
        <h2>Entonnoir</h2>
        <div className="funnel">
          <div className="funnel-col">
            <h3>Outbound · assisté</h3>
            {outbound.map((c) => (
              <span key={c.id} className="chip" style={{ '--accent': c.color } as React.CSSProperties}>
                {c.name}
              </span>
            ))}
            <p>L'IA rédige, vous envoyez</p>
          </div>
          <div className="funnel-col">
            <h3>Inbound · auto</h3>
            {inbound.map((c) => (
              <span key={c.id} className="chip" style={{ '--accent': c.color } as React.CSSProperties}>
                {c.name}
              </span>
            ))}
            <p>L'IA répond dans la fenêtre de 24 h</p>
          </div>
          <div className="funnel-arrow" aria-hidden>→</div>
          <div className="funnel-col">
            <h3>Intérêt explicite ?</h3>
            <p>Oui : demande du numéro (consentement)</p>
            <p>Non ou neutre : archivé, sans relance</p>
          </div>
          <div className="funnel-arrow" aria-hidden>→</div>
          <div className="funnel-col funnel-close">
            <h3>Closing</h3>
            <span className="chip" style={{ '--accent': '#25d366' } as React.CSSProperties}>
              WhatsApp
            </span>
            <p>Prix/contrat : votre validation</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Feuille de route</h2>
        <ol className="roadmap">
          {PARTS.map((p) => (
            <li key={p.n} className={`roadmap-${p.status}`}>
              <span className="roadmap-n">{p.n}</span>
              <span className="roadmap-title">
                {p.n === 1 ? <Link to="/canaux">{p.title}</Link> : p.title}
              </span>
              <span className="roadmap-status">{STATUS_LABEL[p.status]}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
