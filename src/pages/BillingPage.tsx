import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Meter } from '../components/Charts'
import {
  BILLING_CHANGED, enabledProviders, getBillingMode, getEntitlements, getMyPaymentRequest, isDemo, listMyPayments,
  listPlans, manageBilling, requestSubscription, startCheckout, submitPaymentReference,
} from '../lib/api'
import type {
  BillingInterval, BillingMode, Currency, Entitlements, PaymentProvider, PaymentRequest, PaymentRow, Plan,
} from '../lib/types'

const CURRENCY_LABEL: Record<Currency, string> = { XAF: 'FCFA', EUR: '€', USD: '$' }
const money = (n: number, c: Currency | string) =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: c === 'XAF' ? 0 : 2 }).format(n)} ${CURRENCY_LABEL[c as Currency] ?? c}`
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0)

// Moyens de paiement : ce que voit le client, et les devises acceptées par chacun.
const PROVIDERS: { id: PaymentProvider; label: string; hint: string; currencies: Currency[] }[] = [
  { id: 'flutterwave', label: 'Mobile Money ou carte', hint: 'MTN, Orange Money, carte · via Flutterwave', currencies: ['XAF', 'EUR', 'USD'] },
  { id: 'stripe', label: 'Carte bancaire', hint: 'Visa, Mastercard · prélèvement automatique · via Stripe', currencies: ['EUR', 'USD', 'XAF'] },
  { id: 'paypal', label: 'PayPal', hint: 'Compte PayPal · prélèvement automatique', currencies: ['EUR', 'USD'] },
]

const STATUS: Record<Entitlements['status'], { label: string; cls: string }> = {
  trialing: { label: 'Essai gratuit', cls: 'intent-curious' },
  pending_payment: { label: 'En attente de paiement', cls: 'intent-not_now' },
  active: { label: 'Actif', cls: 'intent-interested' },
  past_due: { label: 'Paiement en échec', cls: 'intent-negative' },
  canceled: { label: 'Résilié', cls: 'intent-not_now' },
  expired: { label: 'Expiré', cls: 'intent-negative' },
}

function CurrentPlan({ e, onChange }: { e: Entitlements; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (action: 'portal' | 'cancel') => {
    if (action === 'cancel' && !window.confirm('Résilier ? Votre accès reste ouvert jusqu\'à la fin de la période payée.')) return
    setBusy(true)
    setError(null)
    try {
      const url = await manageBilling(action)
      if (url) window.location.href = url
      else onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card billing-current">
      <div className="card-head">
        <h2>Formule {e.plan_name}</h2>
        <span className={`intent ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
      </div>
      <p className="lead-sm">
        {e.status === 'trialing' && <>Essai gratuit : encore <strong>{daysLeft(e.trial_ends_at)} jours</strong> (jusqu'au {date(e.trial_ends_at)}). Choisissez une formule pour continuer ensuite.</>}
        {e.status === 'active' && (e.provider === 'flutterwave' || e.provider === 'manual' || e.provider === 'neero'
          ? <>Payé jusqu'au <strong>{date(e.current_period_end)}</strong>. Pas de prélèvement automatique : un rappel vous est envoyé 3 jours avant.</>
          : <>Renouvellement automatique le <strong>{date(e.current_period_end)}</strong>.</>)}
        {e.status === 'pending_payment' && (e.has_access
          ? <>Votre demande d'abonnement est en cours. Votre accès reste ouvert {e.trial_ends_at ? <>jusqu'au <strong>{date(e.trial_ends_at)}</strong></> : 'pendant le traitement'}.</>
          : <>Votre demande d'abonnement est en cours : l'accès sera activé dès la validation de votre paiement.</>)}
        {e.status === 'past_due' && <>Le dernier paiement a échoué. Mettez à jour votre moyen de paiement avant le {date(e.current_period_end)}.</>}
        {e.status === 'canceled' && <>Résilié : accès ouvert jusqu'au <strong>{date(e.current_period_end)}</strong>, sans renouvellement.</>}
        {e.status === 'expired' && <>Votre accès est suspendu. Choisissez une formule pour réactiver votre agent.</>}
      </p>
      <div className="meters">
        <Meter label="Actions IA ce mois-ci" used={e.usage.ai_actions} limit={e.limits.ai_actions} />
        <Meter label="Produits" used={e.usage.products} limit={e.limits.products} />
        <Meter label="Numéros WhatsApp" used={e.usage.whatsapp_numbers} limit={e.limits.whatsapp_numbers} />
        <Meter label="Utilisateurs" used={e.usage.members} limit={e.limits.members} />
      </div>
      {error && <p className="error">{error}</p>}
      {e.status !== 'trialing' && e.status !== 'expired' && e.status !== 'pending_payment' && (
        <div className="actions">
          {e.provider === 'stripe' && <button className="btn btn-ghost" disabled={busy} onClick={() => act('portal')}>Gérer ma carte, mes factures ou résilier</button>}
          {(e.provider === 'paypal' || e.provider === 'flutterwave' || e.provider === 'manual' || e.provider === 'neero') && e.status !== 'canceled' && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act('cancel')}>Résilier</button>
          )}
        </div>
      )}
    </section>
  )
}

const OPEN: PaymentRequest['status'][] = ['awaiting_link', 'link_sent', 'reference_submitted']

// Suivi de la demande en cours : lien à venir → payer → référence → validation.
function RequestCard({ r, plans }: { r: PaymentRequest; plans: Plan[] }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = plans.find((p) => p.id === r.plan_id)
  const step = r.status === 'awaiting_link' ? 1 : r.status === 'link_sent' ? 2 : 3
  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitPaymentReference(r.id, ref)
      setRef('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card request-card" aria-live="polite">
      <div className="card-head">
        <h2>{r.kind === 'renewal' ? 'Renouvellement' : 'Votre abonnement'} {plan?.name} · {money(r.amount, r.currency)} / {r.billing_interval === 'year' ? 'an' : 'mois'}</h2>
        <span className="intent intent-not_now">En attente de paiement</span>
      </div>
      <ol className="request-steps">
        <li className="done">Demande envoyée le {date(r.created_at)}</li>
        <li className={step > 1 ? 'done' : 'current'}>
          {step === 1
            ? <>Votre lien de paiement vous sera envoyé sous quelques heures{r.contact_phone ? <>, par WhatsApp au <strong>{r.contact_phone}</strong> et ici même</> : ', ici même'}.</>
            : <>Lien de paiement reçu</>}
        </li>
        <li className={step === 2 ? 'current' : step > 2 ? 'done' : ''}>
          {step < 3 ? 'Payez, puis indiquez la référence de transaction' : <>Référence <strong>{r.transaction_ref}</strong> envoyée : vérification en cours</>}
        </li>
        <li>Accès activé</li>
      </ol>
      {r.status === 'link_sent' && (
        <div className="request-pay">
          {r.payment_link && (
            <a className="btn" href={r.payment_link} target="_blank" rel="noopener noreferrer">Payer {money(r.amount, r.currency)}</a>
          )}
          {r.rejection_reason && <p className="error">Paiement non retrouvé : {r.rejection_reason}. Vérifiez la référence et renvoyez-la.</p>}
          <form className="ref-form" onSubmit={send}>
            <label htmlFor="tx-ref">Référence de transaction (reçue après le paiement)</label>
            <div className="ref-row">
              <input id="tx-ref" required minLength={4} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ex. NE-8F3K2Q" />
              <button className="btn" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la référence'}</button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      )}
      {r.status === 'reference_submitted' && <p className="muted small">Vous serez prévenu dès la validation, en général dans la journée.</p>}
    </section>
  )
}

function SubscribeBox({ plan, interval, currency, phone, onClose, onDone }: {
  plan: Plan; interval: BillingInterval; currency: Currency; phone: string; onClose: () => void; onDone: () => void
}) {
  const [value, setValue] = useState(phone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestSubscription({ plan, interval, currency, phone: value })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card pay-box" aria-live="polite">
      <div className="card-head">
        <h2>S'abonner à {plan.name} · {money(plan.prices[currency][interval], currency)} / {interval === 'month' ? 'mois' : 'an'}</h2>
        <button className="link close" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      <form className="ref-form" onSubmit={submit}>
        <label htmlFor="wa-phone">Votre numéro WhatsApp, pour recevoir le lien de paiement</label>
        <div className="ref-row">
          <input id="wa-phone" type="tel" required value={value} onChange={(e) => setValue(e.target.value)} placeholder="+237 6XX XX XX XX" />
          <button className="btn" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Vous recevez sous quelques heures un lien de paiement sécurisé (Mobile Money ou carte). Une fois payé, indiquez la référence de transaction : votre accès est activé dès sa vérification.</p>
    </section>
  )
}

export default function BillingPage() {
  const [params, setParams] = useSearchParams()
  const [plans, setPlans] = useState<Plan[]>([])
  const [ent, setEnt] = useState<Entitlements | null>(null)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [enabled, setEnabled] = useState<Record<PaymentProvider, boolean> | null>(null)
  const [mode, setMode] = useState<BillingMode | null>(null)
  const [request, setRequest] = useState<PaymentRequest | null>(null)
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [currency, setCurrency] = useState<Currency>('XAF')
  const [choosing, setChoosing] = useState<Plan | null>(null)
  const [busy, setBusy] = useState<PaymentProvider | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'notice'; text: string } | null>(null)

  const load = useCallback(() => {
    getEntitlements().then(setEnt)
    listMyPayments().then(setPayments)
    getMyPaymentRequest().then(setRequest)
  }, [])
  useEffect(() => {
    listPlans().then(setPlans)
    enabledProviders().then(setEnabled)
    getBillingMode().then(setMode)
    load()
    window.addEventListener(BILLING_CHANGED, load)
    return () => window.removeEventListener(BILLING_CHANGED, load)
  }, [load])

  // Retour depuis la page du prestataire : l'activation arrive par webhook, quelques secondes plus tard.
  const returned = params.get('paiement')
  useEffect(() => {
    if (!returned) return
    const timer = window.setTimeout(load, 4000)
    return () => window.clearTimeout(timer)
  }, [returned, load])

  async function pay(provider: PaymentProvider) {
    if (!choosing) return
    setBusy(provider)
    setMessage(null)
    try {
      const url = await startCheckout({ plan: choosing, interval, currency, provider })
      if (url) {
        window.location.href = url
        return
      }
      setMessage({ kind: 'ok', text: `Démo : paiement simulé, formule ${choosing.name} activée.` })
      setChoosing(null)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Compte</p>
        <h1>Abonnement</h1>
        <p className="lead">{mode === 'manual'
          ? 'Choisissez votre formule : vous recevez un lien de paiement sécurisé (Mobile Money ou carte) sous quelques heures. Sans engagement.'
          : 'Payez en FCFA par Mobile Money, ou par carte et PayPal en euros ou en dollars. Sans engagement.'}</p>
      </header>

      {returned === 'ok' && <p className="success">Paiement reçu. L'activation se fait automatiquement dans quelques secondes.</p>}
      {returned === 'annule' && <p className="notice">Paiement annulé : rien n'a été débité.</p>}
      {message && <p className={message.kind === 'ok' ? 'success' : message.kind === 'error' ? 'error' : 'notice'}>{message.text}</p>}

      {ent && <CurrentPlan e={ent} onChange={load} />}
      {mode === 'manual' && request && OPEN.includes(request.status) && <RequestCard r={request} plans={plans} />}

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Période">
          <button className={interval === 'month' ? 'active' : ''} onClick={() => setInterval('month')}>Mensuel</button>
          <button className={interval === 'year' ? 'active' : ''} onClick={() => setInterval('year')}>Annuel · 2 mois offerts</button>
        </div>
        <div className="segmented" role="group" aria-label="Devise">
          {(['XAF', 'EUR', 'USD'] as Currency[]).map((c) => (
            <button key={c} className={currency === c ? 'active' : ''} onClick={() => { setCurrency(c); if (params.get('paiement')) setParams({}) }}>
              {c === 'XAF' ? 'FCFA' : c}
            </button>
          ))}
        </div>
      </div>

      <div className="plans">
        {plans.map((p) => {
          const current = ent?.plan_id === p.id && ent.status === 'active'
          return (
            <article key={p.id} className={`card plan ${p.id === 'pro' ? 'plan-featured' : ''}`}>
              {p.id === 'pro' && <span className="plan-flag">Le plus choisi</span>}
              <h2>{p.name}</h2>
              <p className="muted small">{p.description}</p>
              <p className="plan-price">
                {money(p.prices[currency][interval], currency)}
                <span className="muted small"> / {interval === 'month' ? 'mois' : 'an'}</span>
              </p>
              <ul className="plan-features">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={current ? 'btn btn-ghost' : 'btn'} disabled={current} onClick={() => setChoosing(p)}>
                {current ? 'Votre formule' : ent?.status === 'active' ? 'Changer pour cette formule'
                  : mode === 'manual' ? "S'abonner" : 'Choisir'}
              </button>
            </article>
          )
        })}
      </div>

      {choosing && mode === 'manual' && (
        <SubscribeBox plan={choosing} interval={interval} currency={currency} phone={request?.contact_phone ?? ''}
          onClose={() => setChoosing(null)}
          onDone={() => { setChoosing(null); setMessage({ kind: 'ok', text: 'Demande envoyée : votre lien de paiement arrive sous quelques heures.' }); load() }} />
      )}

      {choosing && mode === 'automatic' && enabled && (
        <section className="card pay-box" aria-live="polite">
          <div className="card-head">
            <h2>Payer {money(choosing.prices[currency][interval], currency)} · {choosing.name}, {interval === 'month' ? '1 mois' : '1 an'}</h2>
            <button className="link close" onClick={() => setChoosing(null)} aria-label="Fermer">×</button>
          </div>
          <div className="pay-options">
            {PROVIDERS.filter((pr) => enabled[pr.id]).map((pr) => {
              const ok = pr.currencies.includes(currency)
              return (
                <button key={pr.id} className="pay-option" disabled={!ok || !!busy} onClick={() => pay(pr.id)}>
                  <strong>{busy === pr.id ? 'Redirection…' : pr.label}</strong>
                  <span className="muted small">{ok ? pr.hint : `Non disponible en ${currency === 'XAF' ? 'FCFA' : currency}`}</span>
                </button>
              )
            })}
          </div>
          <p className="muted small">Paiement sécurisé chez le prestataire : Numera ne voit jamais vos numéros de carte ni vos codes Mobile Money.</p>
          {isDemo && <p className="muted small">Mode démo : le paiement est simulé.</p>}
        </section>
      )}

      <section className="card">
        <h2>Historique des paiements</h2>
        {payments.length === 0 ? <p className="muted">Aucun paiement pour le moment.</p> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Date</th><th>Montant</th><th>Moyen</th><th>Statut</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{date(p.paid_at)}</td>
                  <td>{money(p.amount, p.currency)}</td>
                  <td>{{ stripe: 'Carte (Stripe)', paypal: 'PayPal', flutterwave: 'Mobile Money / carte', manual: 'Virement / espèces', neero: 'Lien de paiement (Neero)' }[p.provider] ?? p.provider}</td>
                  <td>{p.status === 'succeeded' ? '✓ Payé' : p.status === 'failed' ? '✗ Échec' : 'Remboursé'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  )
}
