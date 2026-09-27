import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable, HBars, LineChart, StatTile } from '../components/Charts'
import { channelInfo } from '../data/channels'
import { getDashboardStats, isDemo, listProducts } from '../lib/api'
import { fmt, pct, usd } from '../lib/format'
import type { DashboardStats, Product } from '../lib/types'

const PERIODS = [7, 30, 90]
const FEATURE_LABEL: Record<string, string> = {
  autopilot: 'Pilote automatique', draft: 'Rédaction', profile: 'Profils relationnels', intent: 'Détection d\'intérêt',
  qualify: 'Qualification', analyze_product: 'Analyse produit', handoff: 'Bascule WhatsApp',
}
const STEP_LABEL = { presentation_sent: 'Présentation envoyée', call_proposed: 'Appel proposé', call_booked: 'Appel planifié' } as const
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

export default function ReportsPage() {
  const [days, setDays] = useState(30)
  const [productId, setProductId] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listProducts().then(setProducts)
  }, [])
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => alive && setLoading(true))
    getDashboardStats(days, productId).then((s) => {
      if (!alive) return
      setStats(s)
      setLoading(false)
    })
    return () => { alive = false }
  }, [days, productId])

  const k = stats?.kpis
  const funnel = stats?.funnel ?? []

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Suivi</p>
        <h1>Rapports</h1>
        <p className="lead">
          De la prise de contact à la vente, sur tous les réseaux.{isDemo && ' Données de démonstration.'}
        </p>
      </header>

      {/* Un seul rang de filtres, au-dessus de tout ce qu'il filtre. */}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Période">
          {PERIODS.map((d) => (
            <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} jours</button>
          ))}
        </div>
        <label className="inline">
          Produit :
          <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
            <option value="">Tous</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {stats && k && (
        <div className={`viz-root ${loading ? 'refetching' : ''}`}>
          <section className="kpi-row">
            <StatTile hero label="Prospects chauds" value={fmt(k.hot_now)} hint="prêts à acheter, à suivre de près" />
            <StatTile label="Taux de réponse" value={pct(k.replied, k.contacted)} hint={`${fmt(k.replied)} sur ${fmt(k.contacted)} contactés`} />
            <StatTile label="Appels planifiés" value={fmt(k.calls_booked)} />
            <StatTile label="Ventes gagnées" value={fmt(k.won)} />
            <StatTile label="Réponses de l'IA" value={fmt(k.ai_replies)} hint={`${fmt(k.pending_approvals)} en attente de validation`} />
            <StatTile label="Coût IA" value={usd(k.ai_cost_usd)} hint={`${fmt(k.templates_sent)} relance(s) WhatsApp facturée(s) par Meta`} />
          </section>

          <div className="viz-grid-2">
            <section className="card viz-card">
              <h2>Entonnoir de conversion</h2>
              <p className="muted small">Prospects arrivés sur la période, par étape atteinte.</p>
              <HBars
                series={['Prospects']}
                rows={funnel.map((f) => ({ label: f.stage, values: [f.n] }))}
                detail={(row, i) => i === 0 ? null : `${pct(row.values[0], funnel[i - 1].n)} de l'étape précédente`}
              />
              <DataTable caption="Entonnoir" columns={['Étape', 'Prospects', 'Taux vs étape précédente']}
                rows={funnel.map((f, i) => [f.stage, f.n, i ? pct(f.n, funnel[i - 1].n) : '—'])} />
            </section>

            <section className="card viz-card">
              <h2>Par réseau d'origine</h2>
              <p className="muted small">Combien de prospects chaque réseau apporte, et combien deviennent chauds.</p>
              {stats.by_channel.length === 0 ? <p className="muted">Pas encore de prospects sur la période.</p> : (
                <HBars
                  series={['Prospects', 'Devenus chauds']}
                  rows={stats.by_channel.map((c) => ({ label: channelInfo(c.channel).name, values: [c.prospects, c.hot] }))}
                  detail={(row) => `${pct(row.values[1], row.values[0])} deviennent chauds`}
                />
              )}
              <DataTable caption="Par réseau" columns={['Réseau', 'Prospects', 'Devenus chauds', 'Taux']}
                rows={stats.by_channel.map((c) => [channelInfo(c.channel).name, c.prospects, c.hot, pct(c.hot, c.prospects)])} />
            </section>
          </div>

          <section className="card viz-card">
            <h2>Activité des conversations</h2>
            <p className="muted small">Messages par jour, tous réseaux confondus.</p>
            <LineChart
              series={['Reçus', 'Envoyés']}
              points={stats.daily.map((d) => ({ label: dayLabel(d.day), values: [d.inbound, d.outbound] }))}
            />
            <DataTable caption="Activité" columns={['Jour', 'Reçus', 'Envoyés']}
              rows={stats.daily.map((d) => [dayLabel(d.day), d.inbound, d.outbound])} />
          </section>

          <div className="viz-grid-2">
            <section className="card viz-card">
              <h2>Prospects chauds</h2>
              {stats.hot_list.length === 0 ? <p className="muted">Aucun pour le moment.</p> : (
                <ul className="hot-list">
                  {stats.hot_list.map((h) => (
                    <li key={h.id}>
                      <div>
                        <strong>{h.full_name ?? 'Sans nom'}</strong>
                        <span className="muted small">{[h.product, h.company].filter(Boolean).join(' · ')}</span>
                      </div>
                      {h.closing_step && <span className="tag">{STEP_LABEL[h.closing_step]}</span>}
                      <Link className="btn btn-ghost" to={h.conversation_id ? `/conversations?c=${h.conversation_id}` : '/prospects'}>Ouvrir</Link>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="section-title">Dernières alertes</h3>
              <ul className="alert-list">
                {stats.recent_alerts.map((a, i) => (
                  <li key={i}>
                    <Link to={a.link_path ?? '/'}>{a.title}</Link>
                    <span className="muted small">{new Date(a.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card viz-card">
              <h2>Coût IA par usage</h2>
              <p className="muted small">Coût réel renvoyé par OpenRouter, sur la période.</p>
              <HBars
                series={['Coût']}
                format={usd}
                rows={stats.ai_cost_by_feature.map((f) => ({ label: FEATURE_LABEL[f.feature] ?? f.feature, values: [Number(f.usd)] }))}
              />
              <DataTable caption="Coût IA" columns={['Usage', 'Coût (USD)']}
                rows={stats.ai_cost_by_feature.map((f) => [FEATURE_LABEL[f.feature] ?? f.feature, usd(Number(f.usd))])} />
            </section>
          </div>
        </div>
      )}
    </>
  )
}
