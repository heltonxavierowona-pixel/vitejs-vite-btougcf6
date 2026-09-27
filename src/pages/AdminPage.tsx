import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable, HBars, LineChart, StatTile } from '../components/Charts'
import { adminGrant, getAdminStats, isDemo, listPlans } from '../lib/api'
import { fmt, pct } from '../lib/format'
import type { AdminStats, AdminSubscription, Currency, Plan } from '../lib/types'

// Espace propriétaire de la plateforme : réservé aux comptes de platform_admins.
// Tous les montants sont convertis en FCFA (XAF) au taux défini dans platform_settings.

const xaf = (n: number) => `${fmt(Math.round(n))} FCFA`
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M FCFA` : xaf(n))
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const STATUS: Record<AdminSubscription['status'], { label: string; cls: string }> = {
  trialing: { label: 'Essai', cls: 'intent-curious' },
  active: { label: 'Actif', cls: 'intent-interested' },
  past_due: { label: 'Impayé', cls: 'intent-negative' },
  canceled: { label: 'Résilié', cls: 'intent-not_now' },
  expired: { label: 'Expiré', cls: 'intent-other' },
}
const PROVIDER: Record<string, string> = { flutterwave: 'Flutterwave', stripe: 'Stripe', paypal: 'PayPal', manual: 'Manuel' }

function GrantForm({ sub, plans, onDone }: { sub: AdminSubscription; plans: Plan[]; onDone: () => void }) {
  const [planId, setPlanId] = useState(sub.plan_id)
  const [days, setDays] = useState(30)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('XAF')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="grant-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        try {
          await adminGrant({ organizationId: sub.organization_id, planId, days, amount: amount ? Number(amount) : null, currency })
          onDone()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <label>Formule
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <label>Jours
        <input type="number" min={1} max={400} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
      </label>
      <label>Montant reçu <span className="muted small">(vide = jours offerts)</span>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex. 35000" />
      </label>
      <label>Devise
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option>XAF</option><option>EUR</option><option>USD</option></select>
      </label>
      <button className="btn">{amount ? 'Enregistrer le paiement' : `Offrir ${days} jours`}</button>
      {error && <p className="error">{error}</p>}
      {isDemo && <p className="muted small">Démo : action non enregistrée.</p>}
    </form>
  )
}

export default function AdminPage() {
  const [months, setMonths] = useState(12)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | AdminSubscription['status']>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    getAdminStats(months)
      .then((s) => { setStats(s); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [months])
  useEffect(() => {
    listPlans().then(setPlans)
  }, [])
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => alive && setLoading(true))
    getAdminStats(months)
      .then((s) => { if (alive) { setStats(s); setLoading(false) } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [months])

  const subs = useMemo(() => (stats?.subscriptions ?? [])
    .filter((s) => filter === 'all' || s.status === filter)
    .filter((s) => !query || `${s.organization} ${s.owner_email ?? ''}`.toLowerCase().includes(query.toLowerCase())), [stats, filter, query])

  if (error) return <p className="error">{error}</p>
  const k = stats?.kpis
  const margin = k ? k.collected_this_month - k.ai_cost_this_month_xaf : 0

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Espace propriétaire</p>
        <h1>Revenus & abonnés</h1>
        <p className="lead">Tous les clients de Numera Agentic, ce qu'ils vous rapportent et ce que coûte l'IA. Montants en FCFA.{isDemo && ' Données de démonstration.'}</p>
      </header>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Période">
          {[6, 12, 24].map((m) => <button key={m} className={months === m ? 'active' : ''} onClick={() => setMonths(m)}>{m} mois</button>)}
        </div>
      </div>

      {stats && k && (
        <div className={`viz-root ${loading ? 'refetching' : ''}`}>
          <section className="kpi-row">
            <StatTile hero label="Revenu mensuel récurrent (MRR)" value={compact(k.mrr)} hint={`soit ${compact(k.arr)} par an (ARR)`} />
            <StatTile label="Encaissé ce mois-ci" value={compact(k.collected_this_month)} hint={`marge après IA : ${compact(margin)}`} />
            <StatTile label="Abonnés payants" value={fmt(k.active)} hint={`${fmt(k.past_due)} impayé(s)`} />
            <StatTile label="Essais en cours" value={fmt(k.trialing)} hint={k.trial_conversion == null ? 'conversion : pas encore de recul' : `${k.trial_conversion} % des essais deviennent payants`} />
            <StatTile label="Résiliations du mois" value={fmt(k.canceled_this_month)} hint={`${fmt(k.organizations)} comptes au total`} />
            <StatTile label="Coût IA du mois" value={compact(k.ai_cost_this_month_xaf)} hint={k.collected_this_month ? `${pct(k.ai_cost_this_month_xaf, k.collected_this_month)} des encaissements` : undefined} />
          </section>

          <section className="card viz-card">
            <h2>Encaissements et coût de l'IA par mois</h2>
            <p className="muted small">Paiements réellement reçus (tous moyens) comparés à ce que l'IA vous coûte.</p>
            <LineChart
              series={['Encaissé', 'Coût IA']}
              points={stats.monthly.map((m) => ({ label: monthLabel(m.month), values: [m.revenue, m.ai_cost] }))}
            />
            <DataTable caption="Par mois" columns={['Mois', 'Encaissé (FCFA)', 'Coût IA (FCFA)', 'Inscriptions']}
              rows={stats.monthly.map((m) => [monthLabel(m.month), m.revenue, m.ai_cost, m.signups])} />
          </section>

          <div className="viz-grid-2">
            <section className="card viz-card">
              <h2>Revenu mensuel par formule</h2>
              <HBars series={['MRR']} format={compact}
                rows={stats.by_plan.map((p) => ({ label: p.plan, values: [p.mrr] }))}
                detail={(_row, i) => `${stats.by_plan[i].subscribers} abonné(s)`} />
              <DataTable caption="Par formule" columns={['Formule', 'Abonnés', 'MRR (FCFA)']}
                rows={stats.by_plan.map((p) => [p.plan, p.subscribers, p.mrr])} />
            </section>
            <section className="card viz-card">
              <h2>Encaissé par moyen de paiement</h2>
              <p className="muted small">Sur les {months} derniers mois.</p>
              {stats.by_provider.length === 0 ? <p className="muted">Aucun paiement sur la période.</p> : (
                <HBars series={['Encaissé']} format={compact}
                  rows={stats.by_provider.map((p) => ({ label: PROVIDER[p.provider] ?? p.provider, values: [p.revenue] }))} />
              )}
              <DataTable caption="Par moyen de paiement" columns={['Moyen', 'Encaissé (FCFA)']}
                rows={stats.by_provider.map((p) => [PROVIDER[p.provider] ?? p.provider, p.revenue])} />
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Abonnements <span className="muted small">{subs.length}</span></h2>
              <div className="toolbar tight">
                <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un client…" />
                <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="all">Tous</option>
                  {Object.entries(STATUS).map(([k2, v]) => <option key={k2} value={k2}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Client</th><th>Formule</th><th>Statut</th><th>Paiement</th><th className="num">Rapporte / mois</th><th>Échéance</th><th /></tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <Fragment key={s.organization_id}>
                      <tr>
                        <td><strong>{s.organization}</strong><br /><span className="muted small">{s.owner_email ?? '—'}</span></td>
                        <td>{s.plan}</td>
                        <td><span className={`intent ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span></td>
                        <td>{s.provider ? PROVIDER[s.provider] ?? s.provider : '—'}{s.amount ? <><br /><span className="muted small">{fmt(s.amount)} {s.currency} / {s.interval === 'year' ? 'an' : 'mois'}</span></> : null}</td>
                        <td className="num">{s.mrr_xaf ? xaf(s.mrr_xaf) : '—'}</td>
                        <td>{s.status === 'trialing' ? `fin d'essai ${date(s.trial_ends_at)}` : date(s.current_period_end)}</td>
                        <td><button className="link small" onClick={() => setOpen(open === s.organization_id ? null : s.organization_id)}>Gérer</button></td>
                      </tr>
                      {open === s.organization_id && (
                        <tr className="grant-row">
                          <td colSpan={7}><GrantForm sub={s} plans={plans} onDone={() => { setOpen(null); load() }} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Derniers paiements</h2>
            <ul className="alert-list">
              {stats.recent_payments.map((p, i) => (
                <li key={i}>
                  <span><strong>{p.organization}</strong> · {PROVIDER[p.provider] ?? p.provider} · {fmt(p.amount)} {p.currency}{p.status === 'failed' ? ' · ✗ échec' : ''}</span>
                  <span className="muted small">{date(p.paid_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  )
}
