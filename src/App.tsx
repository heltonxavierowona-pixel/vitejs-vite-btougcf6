import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import ChannelsPage from './pages/ChannelsPage'
import InboxPage from './pages/InboxPage'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import ProductsPage from './pages/ProductsPage'
import ProspectsPage from './pages/ProspectsPage'
import SettingsPage from './pages/SettingsPage'
import ValidationsPage from './pages/ValidationsPage'
import { APPROVALS_CHANGED, countPendingApprovals } from './lib/api'
import UpcomingPage from './pages/UpcomingPage'
import './App.css'

const NAV = [
  { to: '/', label: 'Vue d\'ensemble' },
  { to: '/produits', label: 'Produits' },
  { to: '/canaux', label: 'Canaux' },
  { to: '/prospects', label: 'Prospects' },
  { to: '/conversations', label: 'Conversations' },
  { to: '/validations', label: 'Validations' },
  { to: '/rapports', label: 'Rapports' },
  { to: '/parametres', label: 'Paramètres' },
]

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

// Nombre de réponses IA en attente de validation (badge du menu).
function usePendingApprovals(enabled: boolean) {
  const location = useLocation()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const update = () => countPendingApprovals().then(setCount).catch(() => {})
    update()
    const timer = setInterval(update, 30_000)
    window.addEventListener(APPROVALS_CHANGED, update)
    return () => {
      clearInterval(timer)
      window.removeEventListener(APPROVALS_CHANGED, update)
    }
  }, [enabled, location.pathname])
  return count
}

export default function App() {
  const session = useSession()
  const pending = usePendingApprovals(!supabase || !!session)

  if (supabase && session === undefined) return null
  if (supabase && !session) return <LoginPage />

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
              {n.to === '/validations' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="env">
          {session ? (
            <>
              <span>{session.user.email}</span>
              <button className="link" onClick={() => supabase!.auth.signOut()}>Se déconnecter</button>
            </>
          ) : (
            'Mode démo'
          )}
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/produits" element={<ProductsPage />} />
          <Route path="/canaux" element={<ChannelsPage />} />
          <Route path="/conversations" element={<InboxPage />} />
          <Route path="/prospects" element={<ProspectsPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/validations" element={<ValidationsPage />} />
          <Route
            path="/rapports"
            element={
              <UpcomingPage
                part={7}
                title="Rapports"
                description="Tableau de bord visuel : entonnoir par canal, taux de réponse, prospects chauds, coûts IA et WhatsApp."
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}
