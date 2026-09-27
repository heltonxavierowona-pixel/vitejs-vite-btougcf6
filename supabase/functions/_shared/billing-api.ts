// Appels aux API des prestataires de paiement (Deno). La logique pure est dans billing.ts.
import { HttpError, rest } from './supabase.ts'
import { type Interval, toStripeAmount } from './billing.ts'

const env = (k: string) => {
  const v = Deno.env.get(k)
  if (!v) throw new HttpError(503, `Paiement non configuré (${k} manquant)`)
  return v
}

// ---------- Stripe ----------

function form(obj: Record<string, string | number | undefined>) {
  const f = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f.append(k, String(v))
  return f
}

async function stripe<T>(path: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new HttpError(502, `Stripe : ${data.error?.message ?? res.status}`)
  return data as T
}

export async function stripeCheckout(o: {
  orgId: string; email: string; customerId?: string | null; planId: string; planName: string
  interval: Interval; currency: string; amount: number; successUrl: string; cancelUrl: string
}) {
  const meta = { organization_id: o.orgId, plan_id: o.planId, interval: o.interval }
  const s = await stripe<{ url: string }>('checkout/sessions', form({
    mode: 'subscription',
    client_reference_id: o.orgId,
    ...(o.customerId ? { customer: o.customerId } : { customer_email: o.email }),
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': o.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': toStripeAmount(o.amount, o.currency),
    'line_items[0][price_data][recurring][interval]': o.interval,
    'line_items[0][price_data][product_data][name]': `Numera Agentic — ${o.planName}`,
    'metadata[organization_id]': meta.organization_id, 'metadata[plan_id]': meta.plan_id, 'metadata[interval]': meta.interval,
    'subscription_data[metadata][organization_id]': meta.organization_id,
    'subscription_data[metadata][plan_id]': meta.plan_id,
    'subscription_data[metadata][interval]': meta.interval,
  }))
  return s.url
}

export async function stripePortal(customerId: string, returnUrl: string) {
  const s = await stripe<{ url: string }>('billing_portal/sessions', form({ customer: customerId, return_url: returnUrl }))
  return s.url
}

// ---------- PayPal ----------

const paypalBase = () => (Deno.env.get('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')

async function paypalToken() {
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_CLIENT_SECRET')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  if (!res.ok) throw new HttpError(502, `PayPal : ${data.error_description ?? res.status}`)
  return data.access_token as string
}

async function paypal<T>(path: string, token: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new HttpError(502, `PayPal : ${data.message ?? res.status}`)
  return data as T
}

// La formule PayPal (plan) est créée une seule fois par formule / devise / période, puis mémorisée.
async function paypalPlanId(token: string, planId: string, planName: string, interval: Interval, currency: string, amount: number) {
  const [cached] = await rest<{ external_id: string }[]>(
    `provider_plans?provider=eq.paypal&plan_id=eq.${planId}&currency=eq.${currency}&billing_interval=eq.${interval}&select=external_id`)
  if (cached) return cached.external_id
  const product = await paypal<{ id: string }>('/v1/catalogs/products', token, { name: 'Numera Agentic', type: 'SERVICE' })
  const plan = await paypal<{ id: string }>('/v1/billing/plans', token, {
    product_id: product.id,
    name: `Numera Agentic — ${planName} (${interval === 'year' ? 'annuel' : 'mensuel'}, ${currency})`,
    billing_cycles: [{
      frequency: { interval_unit: interval === 'year' ? 'YEAR' : 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
      pricing_scheme: { fixed_price: { value: amount.toFixed(2), currency_code: currency } },
    }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  })
  await rest('provider_plans', { method: 'POST', prefer: 'return=minimal',
    body: { provider: 'paypal', plan_id: planId, currency, billing_interval: interval, external_id: plan.id } })
  return plan.id
}

export async function paypalCheckout(o: {
  orgId: string; planId: string; planName: string; interval: Interval; currency: string; amount: number
  successUrl: string; cancelUrl: string
}) {
  const token = await paypalToken()
  const ppPlan = await paypalPlanId(token, o.planId, o.planName, o.interval, o.currency, o.amount)
  const sub = await paypal<{ links: { rel: string; href: string }[] }>('/v1/billing/subscriptions', token, {
    plan_id: ppPlan,
    custom_id: `${o.orgId}:${o.planId}:${o.interval}`,
    application_context: { brand_name: 'Numera Agentic', user_action: 'SUBSCRIBE_NOW', return_url: o.successUrl, cancel_url: o.cancelUrl },
  })
  const approve = sub.links.find((l) => l.rel === 'approve')
  if (!approve) throw new HttpError(502, 'PayPal : lien d\'approbation absent')
  return approve.href
}

export async function paypalCancel(subscriptionId: string) {
  const token = await paypalToken()
  await paypal(`/v1/billing/subscriptions/${subscriptionId}/cancel`, token, { reason: 'Résiliation depuis Numera Agentic' })
}

export async function paypalVerifyWebhook(headers: Headers, event: unknown) {
  const token = await paypalToken()
  const r = await paypal<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', token, {
    auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'), transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'), webhook_id: env('PAYPAL_WEBHOOK_ID'), webhook_event: event,
  })
  return r.verification_status === 'SUCCESS'
}

// ---------- Flutterwave ----------
// Paiement par période (mois ou année) : Mobile Money (MTN, Orange) ou carte. Pas de prélèvement
// automatique pour le Mobile Money : chaque paiement prolonge l'abonnement, un rappel part 3 jours avant l'échéance.

async function flutterwave<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${env('FLW_SECRET_KEY')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.status !== 'success') throw new HttpError(502, `Flutterwave : ${data.message ?? res.status}`)
  return data.data as T
}

export async function flutterwaveCheckout(o: {
  orgId: string; email: string; planId: string; planName: string; interval: Interval; currency: string; amount: number
  successUrl: string
}) {
  const data = await flutterwave<{ link: string }>('/payments', {
    tx_ref: `nm_${o.orgId}_${Date.now()}`,
    amount: o.amount,
    currency: o.currency,
    redirect_url: o.successUrl,
    payment_options: o.currency === 'XAF' ? 'mobilemoneyfranco,card' : 'card',
    customer: { email: o.email },
    meta: { organization_id: o.orgId, plan_id: o.planId, interval: o.interval },
    customizations: { title: 'Numera Agentic', description: `Formule ${o.planName} — ${o.interval === 'year' ? '1 an' : '1 mois'}` },
  })
  return data.link
}

export async function flutterwaveVerify(transactionId: string | number) {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponse externe (Flutterwave)
  return flutterwave<any>(`/transactions/${transactionId}/verify`)
}
