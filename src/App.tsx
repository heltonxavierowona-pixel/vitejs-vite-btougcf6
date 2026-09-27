import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import ChannelsPage from './pages/ChannelsPage'
import InboxPage from './pages/InboxPage'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import ProductsPage from './pages/ProductsPage'
import UpcomingPage from './pages/UpcomingPage'
import './App.css'

const NAV = [
  { to: '/', label: 'Vue d\'ensemble' },
  { to: '/produits', label: 'Produits' },
  { to: '/canaux', label: 'Canaux' },
  { to: '/conversations', label: 'Conversations' },
  { to: '/prospects', label: 'Prospects' },
  { to: '/validations', label: 'Validations' },
  { to: '/rapports', label: 'Rapports' },
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

export default function App() {
  const session = useSession()

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
          <Route
            path="/prospects"
            element={
              <UpcomingPage
                part={2}
                title="Prospects"
                description="Pipeline par produit et par segment, import semi-manuel pour LinkedIn/X et prospects entrants Facebook/Instagram."
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
                description="Tableau de bord visuel : entonnoir par canal, taux de réponse, prospects chauds, coûts IA et WhatsApp."
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}
