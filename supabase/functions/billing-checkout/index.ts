// POST { plan_id, interval: 'month' | 'year', currency, provider: 'stripe' | 'paypal' | 'flutterwave' }
// Renvoie { url } : la page de paiement du prestataire. Le prix vient TOUJOURS de la table plans.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { type Interval, PROVIDER_CURRENCIES, type Provider } from '../_shared/billing.ts'
import { flutterwaveCheckout, paypalCheckout, stripeCheckout } from '../_shared/billing-api.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('APP_ORIGIN') ?? '').replace(/\/$/, '')

Deno.serve(handler(async (req) => {
  const { jwt, orgId } = await requireUser(req)
  const { plan_id, interval, currency, provider } = (await req.json()) as {
    plan_id: string; interval: Interval; currency: string; provider: Provider
  }
  if (!['month', 'year'].includes(interval)) throw new HttpError(400, 'Période invalide')
  if (!PROVIDER_CURRENCIES[provider]?.includes(currency)) {
    throw new HttpError(400, `${provider} n'accepte pas la devise ${currency}`)
  }

  const [settings] = await rest<{ value: Record<string, boolean> }[]>('platform_settings?key=eq.providers&select=value')
  if (settings && settings.value[provider] === false) throw new HttpError(400, 'Ce moyen de paiement est désactivé')

  const [plan] = await rest<{ id: string; name: string; prices: Record<string, Record<Interval, number>> }[]>(
    `plans?id=eq.${plan_id}&active=eq.true&select=id,name,prices`, { jwt })
  const amount = plan?.prices?.[currency]?.[interval]
  if (!plan || !amount) throw new HttpError(400, 'Formule ou devise inconnue')

  const userRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: `Bearer ${jwt}` },
  })
  const email = (await userRes.json()).email as string
  const [sub] = await rest<{ provider: string | null; provider_customer_id: string | null }[]>(
    `subscriptions?organization_id=eq.${orgId}&select=provider,provider_customer_id`)

  const successUrl = `${APP_URL}/abonnement?paiement=ok`
  const cancelUrl = `${APP_URL}/abonnement?paiement=annule`
  const common = { orgId, planId: plan.id, planName: plan.name, interval, currency, amount }

  let url: string
  if (provider === 'stripe') {
    url = await stripeCheckout({ ...common, email, successUrl, cancelUrl,
      customerId: sub?.provider === 'stripe' ? sub.provider_customer_id : null })
  } else if (provider === 'paypal') {
    url = await paypalCheckout({ ...common, successUrl, cancelUrl })
  } else {
    url = await flutterwaveCheckout({ ...common, email, successUrl })
  }
  return json({ url })
}))
