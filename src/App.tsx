import { NavLink, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import ChannelsPage from './pages/ChannelsPage'
import OverviewPage from './pages/OverviewPage'
import UpcomingPage from './pages/UpcomingPage'
import './App.css'

const NAV = [
  { to: '/', label: 'Vue d\'ensemble' },
  { to: '/canaux', label: 'Canaux' },
  { to: '/prospects', label: 'Prospects' },
  { to: '/conversations', label: 'Conversations' },
  { to: '/validations', label: 'Validations' },
  { to: '/rapports', label: 'Rapports' },
]

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">C</span> Le Closer
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="env">{supabase ? 'Supabase connecté' : 'Mode démo (.env absent)'}</p>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/canaux" element={<ChannelsPage />} />
          <Route
            path="/prospects"
            element={
              <UpcomingPage
                part={2}
                title="Prospects"
                description="Pipeline par segment (Core HR / Social Seller), import CSV semi-manuel et prospects entrants Facebook/Instagram."
              />
            }
          />
          <Route
            path="/conversations"
            element={
              <UpcomingPage
                part={5}
                title="Conversations"
                description="Boîte de réception unifiée des 5 canaux, avec le profil relationnel de chaque prospect et la reprise en main manuelle."
              />
            }
          />
          <Route
            path="/validations"
            element={
              <UpcomingPage
                part={5}
                title="Validations"
                description="Messages rédigés par l'IA sur le prix ou le contrat, en attente de votre accord avant envoi."
              />
            }
          />
          <Route
            path="/rapports"
            element={
              <UpcomingPage
                part={7}
                title="Rapports"
                description="Dashboard visuel : entonnoir par canal, taux de réponse, prospects chauds, coût IA et WhatsApp."
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}
