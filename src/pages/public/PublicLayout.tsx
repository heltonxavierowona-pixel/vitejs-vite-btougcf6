import { Link } from 'react-router-dom'
import Logo from '../../components/Logo'
import { COMPANY, whatsappLink } from '../../config/company'

// Pages accessibles sans compte : accueil, mentions légales, confidentialité, conditions, suppression des données.
export default function PublicLayout({ children, loggedIn = false }: { children: React.ReactNode; loggedIn?: boolean }) {
  return (
    <div className="public">
      <header className="public-head">
        <Link to="/" className="public-brand" aria-label={`${COMPANY.product}, accueil`}><Logo /></Link>
        <nav className="public-nav">
          <a href="/#offres">Offres</a>
          <a href="/#contact">Contact</a>
          <Link className="btn small" to={loggedIn ? '/' : '/connexion'}>{loggedIn ? 'Mon espace' : 'Se connecter'}</Link>
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-foot">
        <div>
          <strong>{COMPANY.name}</strong>
          <span>{COMPANY.address}</span>
          <span>
            <a href={`tel:+${COMPANY.phone.replace(/\D/g, '')}`}>{COMPANY.phone}</a> ·{' '}
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">WhatsApp</a> ·{' '}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
          </span>
        </div>
        <nav aria-label="Informations légales">
          <Link to="/mentions-legales">Mentions légales</Link>
          <Link to="/confidentialite">Politique de confidentialité</Link>
          <Link to="/conditions">Conditions d'utilisation</Link>
          <Link to="/suppression-des-donnees">Suppression des données</Link>
        </nav>
        <small>© {new Date().getFullYear()} {COMPANY.name}. {COMPANY.product} est un service édité par {COMPANY.name}.</small>
      </footer>
    </div>
  )
}
