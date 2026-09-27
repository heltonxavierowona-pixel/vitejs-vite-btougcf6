// POST { action: 'portal' | 'cancel' }
// portal : espace client Stripe (carte, factures, résiliation).
// cancel : résiliation (PayPal via API ; Flutterwave / manuel : pas de renouvellement). L'accès reste
//          ouvert jusqu'à la fin de la période payée.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { paypalCancel, stripePortal } from '../_shared/billing-api.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('APP_ORIGIN') ?? '').replace(/\/$/, '')

Deno.serve(handler(async (req) => {
  const { orgId } = await requireUser(req)
  const { action } = (await req.json()) as { action: string }
  const [sub] = await rest<{ provider: string | null; provider_customer_id: string | null; provider_subscription_id: string | null }[]>(
    `subscriptions?organization_id=eq.${orgId}&select=provider,provider_customer_id,provider_subscription_id`)
  if (!sub) throw new HttpError(404, 'Abonnement introuvable')

  if (action === 'portal') {
    if (sub.provider !== 'stripe' || !sub.provider_customer_id) throw new HttpError(400, 'Espace client disponible pour les paiements par carte (Stripe)')
    return json({ url: await stripePortal(sub.provider_customer_id, `${APP_URL}/abonnement`) })
  }
  if (action === 'cancel') {
    if (sub.provider === 'stripe') throw new HttpError(400, 'Résiliez depuis l\'espace client Stripe')
    if (sub.provider === 'paypal' && sub.provider_subscription_id) await paypalCancel(sub.provider_subscription_id)
    await rest(`subscriptions?organization_id=eq.${orgId}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'canceled', cancel_at_period_end: true, canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    })
    return json({ canceled: true })
  }
  throw new HttpError(400, 'action inconnue')
}))
