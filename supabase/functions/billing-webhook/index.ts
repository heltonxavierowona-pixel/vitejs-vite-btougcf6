// POST ?provider=stripe | paypal | flutterwave   (déployée avec --no-verify-jwt)
// Vérifie l'authenticité de la notification, la traduit en format commun, puis billing_apply (SQL, idempotent).
import { handler, HttpError, json, rest } from '../_shared/supabase.ts'
import { type BillingEvent, normalizeFlutterwave, normalizePaypal, normalizeStripe, verifyStripeSignature } from '../_shared/billing.ts'
import { flutterwaveVerify, paypalVerifyWebhook } from '../_shared/billing-api.ts'

Deno.serve(handler(async (req) => {
  const provider = new URL(req.url).searchParams.get('provider')
  const raw = await req.text()
  let evt: BillingEvent

  if (provider === 'stripe') {
    const ok = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '')
    if (!ok) throw new HttpError(401, 'Signature Stripe invalide')
    evt = normalizeStripe(JSON.parse(raw))
  } else if (provider === 'paypal') {
    const body = JSON.parse(raw)
    if (!(await paypalVerifyWebhook(req.headers, body))) throw new HttpError(401, 'Signature PayPal invalide')
    evt = normalizePaypal(body)
  } else if (provider === 'flutterwave') {
    // Flutterwave envoie le « secret hash » choisi dans le tableau de bord, en clair, dans l'en-tête verif-hash.
    if (!Deno.env.get('FLW_SECRET_HASH') || req.headers.get('verif-hash') !== Deno.env.get('FLW_SECRET_HASH')) {
      throw new HttpError(401, 'Webhook Flutterwave non authentifié')
    }
    const body = JSON.parse(raw)
    if (body.event !== 'charge.completed' || !body.data?.id) return json({ ignored: true })
    const tx = await flutterwaveVerify(body.data.id)   // source de vérité : l'API, pas le webhook
    const meta = tx.meta ?? {}
    const [plan] = await rest<{ prices: Record<string, Record<string, number>> }[]>(
      `plans?id=eq.${meta.plan_id}&select=prices`)
    const expected = plan?.prices?.[String(tx.currency).toUpperCase()]?.[meta.interval] ?? null
    evt = normalizeFlutterwave(tx, expected)
  } else {
    throw new HttpError(400, 'provider manquant')
  }

  if (evt.kind === 'ignored') return json({ ignored: true })
  const result = await rest('rpc/billing_apply', { method: 'POST', body: { p: evt } })
  return json({ result })
}))
