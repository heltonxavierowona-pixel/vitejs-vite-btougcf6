import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
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
import {
  adminListPaymentRequests, APPROVALS_CHANGED, BILLING_CHANGED, countPendingApprovals, getEntitlements, isPlatformAdmin,
} from './lib/api'
import type { Entitlements } from './lib/types'
import BillingPage from './pages/BillingPage'
import AdminPage from './pages/AdminPage'
import ReportsPage from './pages/ReportsPage'
import Logo from './components/Logo'
import LandingPage from './pages/public/LandingPage'
import { DataDeletionPage, MentionsPage, PrivacyPage, TermsPage } from './pages/public/LegalPages'
import './App.css'

// Pages publiques, lisibles sans compte (exigées par Meta pour la vérification et l'App Review).
const LEGAL: Record<string, (p: { loggedIn?: boolean }) => React.ReactElement> = {
  '/mentions-legales': MentionsPage,
  '/confidentialite': PrivacyPage,
  '/conditions': TermsPage,
  '/suppression-des-donnees': DataDeletionPage,
}

const NAV = [
  { to: '/', label: 'Vue d\'ensemble' },
  { to: '/produits', label: 'Produits' },
  { to: '/canaux', label: 'Canaux' },
  { to: '/prospects', label: 'Prospects' },
  { to: '/conversations', label: 'Conversations' },
  { to: '/validations', label: 'Validations' },
  { to: '/rapports', label: 'Rapports' },
  { to: '/abonnement', label: 'Abonnement' },
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

// Formule et accès de l'organisation (bandeau d'essai / d'impayé).
function useEntitlements(enabled: boolean) {
  const location = useLocation()
  const [ent, setEnt] = useState<{ e: Entitlements; trialDays: number | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const update = () => getEntitlements()
      .then((e) => setEnt(e && {
        e,
        trialDays: e.trial_ends_at ? Math.ceil((new Date(e.trial_ends_at).getTime() - Date.now()) / 86_400_000) : null,
      }))
      .catch(() => {})
    update()
    window.addEventListener(BILLING_CHANGED, update)
    return () => window.removeEventListener(BILLING_CHANGED, update)
  }, [enabled, location.pathname])
  return ent
}

function useIsAdmin(enabled: boolean) {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    if (enabled) isPlatformAdmin().then(setAdmin).catch(() => {})
  }, [enabled])
  return admin
}

// Demandes d'abonnement qui attendent une action du propriétaire (badge du menu).
function usePaymentQueue(enabled: boolean) {
  const location = useLocation()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const update = () => adminListPaymentRequests()
      .then((rs) => setCount(rs.filter((r) => r.status === 'awaiting_link' || r.status === 'reference_submitted').length))
      .catch(() => {})
    update()
    const timer = setInterval(update, 60_000)
    window.addEventListener(BILLING_CHANGED, update)
    return () => {
      clearInterval(timer)
      window.removeEventListener(BILLING_CHANGED, update)
    }
  }, [enabled, location.pathname])
  return count
}

function BillingBanner({ state }: { state: { e: Entitlements; trialDays: number | null } | null }) {
  const { pathname } = useLocation()
  if (!state || pathname === '/abonnement' || pathname === '/admin') return null
  const { e: ent, trialDays: days } = state
  let text: string | null = null
  if (ent.status === 'pending_payment') text = ent.has_access
    ? 'Votre abonnement est en attente de paiement : suivez les étapes dans « Abonnement ».'
    : 'Votre accès sera activé dès la validation de votre paiement : suivez les étapes dans « Abonnement ».'
  else if (!ent.has_access) text = 'Votre abonnement est inactif : l\'agent est en pause. Choisissez une formule pour le relancer.'
  else if (ent.status === 'past_due') text = 'Le dernier paiement a échoué. Mettez à jour votre moyen de paiement pour éviter l\'interruption.'
  else if (ent.status === 'trialing' && days != null && days <= 3) text = `Votre essai gratuit se termine dans ${Math.max(days, 0)} jour(s).`
  if (!text) return null
  return (
    <div className={`billing-banner ${ent.has_access ? '' : 'blocked'}`} role="status">
      <span>{text}</span>
      <Link className="btn small" to="/abonnement">Voir les formules</Link>
    </div>
  )
}

export default function App() {
  const session = useSession()
  const pending = usePendingApprovals(!supabase || !!session)
  const ent = useEntitlements(!supabase || !!session)
  const admin = useIsAdmin(!supabase || !!session)
  const queue = usePaymentQueue(admin)
  const { pathname } = useLocation()

  const Legal = LEGAL[pathname.replace(/\/$/, '') || '/']
  if (Legal) return <Legal loggedIn={!!session} />
  if (supabase && session === undefined) return null
  if (supabase && !session) return pathname === '/' ? <LandingPage /> : <LoginPage />
  if (pathname === '/connexion') return <Navigate to="/" replace />

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {n.label}
              {n.to === '/validations' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </NavLink>
          ))}
          {admin && (
            <NavLink to="/admin" className="nav-admin">
              Espace propriétaire{queue > 0 && <span className="nav-badge">{queue}</span>}
            </NavLink>
          )}
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
        <BillingBanner state={ent} />
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/produits" element={<ProductsPage />} />
          <Route path="/canaux" element={<ChannelsPage />} />
          <Route path="/conversations" element={<InboxPage />} />
          <Route path="/prospects" element={<ProspectsPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/validations" element={<ValidationsPage />} />
          <Route path="/rapports" element={<ReportsPage />} />
          <Route path="/abonnement" element={<BillingPage />} />
          {admin && <Route path="/admin" element={<AdminPage />} />}
        </Routes>
      </main>
    </div>
  )
}
