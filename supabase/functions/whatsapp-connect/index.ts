// POST { code, waba_id, phone_number_id, coexistence? }
// Appelée par la plateforme à la fin de l'« Embedded Signup » WhatsApp :
// l'utilisateur a connecté SON numéro WhatsApp Business à Le Closer.
import { graph, GRAPH, handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'

interface Body {
  code: string
  waba_id: string
  phone_number_id: string
  business_id?: string
  coexistence?: boolean
}

Deno.serve(handler(async (req) => {
  const { orgId, userId } = await requireUser(req)
  const body = (await req.json()) as Body
  if (!body.code || !body.waba_id || !body.phone_number_id) {
    throw new HttpError(400, 'code, waba_id et phone_number_id sont requis')
  }

  // 1. Échange du code contre un token d'intégration métier (propre à ce client).
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`)
  tokenUrl.searchParams.set('client_id', Deno.env.get('META_APP_ID')!)
  tokenUrl.searchParams.set('client_secret', Deno.env.get('META_APP_SECRET')!)
  tokenUrl.searchParams.set('code', body.code)
  const tokenRes = await fetch(tokenUrl)
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new HttpError(502, `Échange du code Meta impossible: ${JSON.stringify(tokenData.error ?? tokenData)}`)
  }
  const token: string = tokenData.access_token

  // 2. Le numéro ne doit pas déjà appartenir à une autre organisation.
  const existing = await rest<{ organization_id: string }[]>(
    `channel_accounts?channel=eq.whatsapp&external_id=eq.${body.phone_number_id}&select=organization_id`,
  )
  if (existing.length && existing[0].organization_id !== orgId) {
    throw new HttpError(409, 'Ce numéro est déjà connecté à un autre compte Le Closer')
  }

  // 3. Abonner notre app aux webhooks du compte WhatsApp du client.
  await graph(`${body.waba_id}/subscribed_apps`, { method: 'POST', token })

  // 4. Enregistrer le numéro sur la Cloud API (sauf coexistence : il reste actif dans l'app).
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  if (!body.coexistence) {
    await graph(`${body.phone_number_id}/register`, {
      method: 'POST',
      token,
      body: { messaging_product: 'whatsapp', pin },
    })
  }

  const phone = await graph<{ display_phone_number: string; verified_name: string }>(
    `${body.phone_number_id}?fields=display_phone_number,verified_name`,
    { token },
  )

  // 5. Enregistrer la connexion (clé service_role : le token ne passe jamais par le front).
  const [account] = await rest<{ id: string }[]>('channel_accounts?on_conflict=channel,external_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      organization_id: orgId,
      channel: 'whatsapp',
      mode: 'auto',
      label: phone.verified_name,
      external_id: body.phone_number_id,
      waba_id: body.waba_id,
      meta_business_id: body.business_id ?? null,
      display_phone: phone.display_phone_number,
      coexistence: !!body.coexistence,
      status: 'active',
      connected_by: userId,
      connected_at: new Date().toISOString(),
    },
  })

  await rest('channel_credentials?on_conflict=channel_account_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      channel_account_id: account.id,
      access_token: token,
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      extra: body.coexistence ? {} : { registration_pin: pin },
      updated_at: new Date().toISOString(),
    },
  })

  return json({ id: account.id, display_phone: phone.display_phone_number, label: phone.verified_name })
}))
