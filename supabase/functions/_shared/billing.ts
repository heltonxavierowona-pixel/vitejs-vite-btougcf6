// Paiements : Stripe, PayPal, Flutterwave.
// Les fonctions « normalize* » et « verifyStripeSignature » sont pures (testables avec Node) :
// elles traduisent chaque webhook vers un format commun appliqué en SQL par billing_apply().

export type Provider = 'stripe' | 'paypal' | 'flutterwave'
export type Interval = 'month' | 'year'

export interface BillingEvent {
  provider: Provider
  event_id: string
  kind: 'subscription_active' | 'payment_succeeded' | 'payment_failed' | 'subscription_canceled' | 'ignored'
  organization_id: string | null
  plan_id?: string | null
  interval?: Interval | null
  currency?: string | null
  amount?: number | null
  customer_id?: string | null
  subscription_id?: string | null
  payment_id?: string | null
  period_end?: string | null
}

// Devises acceptées par prestataire (PayPal ne gère pas le franc CFA).
export const PROVIDER_CURRENCIES: Record<Provider, string[]> = {
  stripe: ['EUR', 'USD', 'XAF'],
  paypal: ['EUR', 'USD'],
  flutterwave: ['XAF', 'EUR', 'USD'],
}

// Devises « sans décimales » chez Stripe (montant en unités, pas en centimes).
const ZERO_DECIMAL = new Set(['XAF', 'XOF', 'JPY', 'KRW'])
export const toStripeAmount = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100)
export const fromStripeAmount = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100

const iso = (unix?: number | null) => (unix ? new Date(unix * 1000).toISOString() : null)

// ---------- Stripe ----------

// Stripe-Signature: t=<horodatage>,v1=<HMAC-SHA256 hex de "t.corps"> ; tolérance 5 minutes.
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Date.now() / 1000): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!t || !sigs.length || Math.abs(nowSec - t) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected))
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- charges utiles externes (webhooks), validées champ par champ
type Json = any

export function normalizeStripe(evt: Json): BillingEvent {
  const o = evt.data?.object ?? {}
  const base = { provider: 'stripe' as const, event_id: String(evt.id) }
  if (evt.type === 'checkout.session.completed' && o.mode === 'subscription') {
    const cur = String(o.currency ?? '').toUpperCase()
    return {
      ...base, kind: 'subscription_active', organization_id: o.client_reference_id ?? o.metadata?.organization_id ?? null,
      plan_id: o.metadata?.plan_id, interval: o.metadata?.interval, currency: cur,
      amount: o.amount_total != null ? fromStripeAmount(o.amount_total, cur) : null,
      customer_id: o.customer, subscription_id: o.subscription,
    }
  }
  if (evt.type === 'invoice.paid' || evt.type === 'invoice.payment_failed') {
    const cur = String(o.currency ?? '').toUpperCase()
    const line = o.lines?.data?.[0] ?? {}
    const meta = o.subscription_details?.metadata ?? o.parent?.subscription_details?.metadata ?? line.metadata ?? {}
    return {
      ...base, kind: evt.type === 'invoice.paid' ? 'payment_succeeded' : 'payment_failed',
      organization_id: meta.organization_id ?? null, plan_id: meta.plan_id, interval: meta.interval,
      currency: cur, amount: fromStripeAmount(evt.type === 'invoice.paid' ? o.amount_paid : o.amount_due, cur),
      customer_id: o.customer, subscription_id: o.subscription ?? o.parent?.subscription_details?.subscription,
      payment_id: o.id, period_end: iso(line.period?.end),
    }
  }
  if (evt.type === 'customer.subscription.deleted') {
    return { ...base, kind: 'subscription_canceled', organization_id: o.metadata?.organization_id ?? null, subscription_id: o.id }
  }
  return { ...base, kind: 'ignored', organization_id: null }
}

// ---------- PayPal ----------
// custom_id = "<organization_id>:<plan_id>:<interval>" (posé à la création de l'abonnement).

export function parseCustomId(custom?: string | null) {
  const [organization_id, plan_id, interval] = String(custom ?? '').split(':')
  return { organization_id: organization_id || null, plan_id: plan_id || null, interval: (interval || null) as Interval | null }
}

export function normalizePaypal(evt: Json): BillingEvent {
  const r = evt.resource ?? {}
  const base = { provider: 'paypal' as const, event_id: String(evt.id) }
  switch (evt.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const c = parseCustomId(r.custom_id)
      const last = r.billing_info?.last_payment?.amount
      return {
        ...base, kind: 'subscription_active', ...c, subscription_id: r.id, customer_id: r.subscriber?.payer_id,
        currency: last?.currency_code ?? null, amount: last ? Number(last.value) : null,
        period_end: r.billing_info?.next_billing_time ?? null,
      }
    }
    case 'PAYMENT.SALE.COMPLETED': {
      const c = parseCustomId(r.custom ?? r.custom_id)
      return {
        ...base, kind: 'payment_succeeded', ...c, subscription_id: r.billing_agreement_id, payment_id: r.id,
        currency: r.amount?.currency, amount: Number(r.amount?.total),
      }
    }
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      const c = parseCustomId(r.custom_id)
      return { ...base, kind: 'payment_failed', ...c, subscription_id: r.id, payment_id: `${r.id}_${evt.id}`,
        currency: r.billing_info?.outstanding_balance?.currency_code ?? null,
        amount: r.billing_info?.outstanding_balance ? Number(r.billing_info.outstanding_balance.value) : 0 }
    }
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
      return { ...base, kind: 'subscription_canceled', ...parseCustomId(r.custom_id), subscription_id: r.id }
    default:
      return { ...base, kind: 'ignored', organization_id: null }
  }
}

// ---------- Flutterwave ----------
// Le webhook n'est qu'un signal : la transaction est toujours revérifiée auprès de l'API,
// et son montant comparé au prix de la formule (anti-fraude).

export function normalizeFlutterwave(tx: Json, expectedAmount: number | null): BillingEvent {
  const meta = tx.meta ?? {}
  const base = { provider: 'flutterwave' as const, event_id: `tx_${tx.id}` }
  const ok = tx.status === 'successful' && expectedAmount != null && Number(tx.amount) >= expectedAmount
  return {
    ...base, kind: ok ? 'payment_succeeded' : tx.status === 'failed' ? 'payment_failed' : 'ignored',
    organization_id: meta.organization_id ?? null, plan_id: meta.plan_id ?? null, interval: meta.interval ?? null,
    currency: String(tx.currency ?? '').toUpperCase(), amount: Number(tx.amount), payment_id: String(tx.id),
    customer_id: tx.customer?.email ?? null,
  }
}
