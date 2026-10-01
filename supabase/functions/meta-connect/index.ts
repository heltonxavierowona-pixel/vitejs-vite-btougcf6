// POST { code }
// Appelée après « Facebook Login for Business » : connecte les Pages Facebook
// choisies par l'utilisateur et les comptes Instagram professionnels liés.
import { graph, GRAPH, handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'

interface Page {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string; username?: string }
}

Deno.serve(handler(async (req) => {
  const { orgId, userId } = await requireUser(req)
  const { code } = await req.json()
  if (!code) throw new HttpError(400, 'code manquant')

  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`)
  tokenUrl.searchParams.set('client_id', Deno.env.get('META_APP_ID')!)
  tokenUrl.searchParams.set('client_secret', Deno.env.get('META_APP_SECRET')!)
  tokenUrl.searchParams.set('code', code)
  const tokenRes = await fetch(tokenUrl)
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new HttpError(502, `Échange du code Meta impossible: ${JSON.stringify(tokenData.error ?? tokenData)}`)
  }

  // Token utilisateur longue durée : les tokens de Page qui en découlent n'expirent pas
  // (avec le token court, ils expireraient au bout d'une heure).
  const longUrl = new URL(`${GRAPH}/oauth/access_token`)
  longUrl.searchParams.set('grant_type', 'fb_exchange_token')
  longUrl.searchParams.set('client_id', Deno.env.get('META_APP_ID')!)
  longUrl.searchParams.set('client_secret', Deno.env.get('META_APP_SECRET')!)
  longUrl.searchParams.set('fb_exchange_token', tokenData.access_token)
  const longData = await (await fetch(longUrl)).json().catch(() => ({}))
  const userToken: string = longData.access_token ?? tokenData.access_token

  const pages = await graph<{ data: Page[] }>(
    'me/accounts?fields=id,name,access_token,instagram_business_account{id,username}',
    { token: userToken },
  )
  if (!pages.data.length) throw new HttpError(400, 'Aucune Page Facebook autorisée')

  const connected: { channel: string; label: string }[] = []

  for (const page of pages.data) {
    // Abonner la Page à nos webhooks (messages entrants + commentaires).
    await graph(`${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed`, {
      method: 'POST',
      token: page.access_token,
    })

    const accounts = [{ channel: 'facebook', external_id: page.id, label: page.name }]
    if (page.instagram_business_account) {
      accounts.push({
        channel: 'instagram',
        external_id: page.instagram_business_account.id,
        label: page.instagram_business_account.username ?? page.name,
      })
    }

    for (const a of accounts) {
      const existing = await rest<{ organization_id: string }[]>(
        `channel_accounts?channel=eq.${a.channel}&external_id=eq.${a.external_id}&select=organization_id`,
      )
      if (existing.length && existing[0].organization_id !== orgId) continue // appartient à un autre client

      const [account] = await rest<{ id: string }[]>('channel_accounts?on_conflict=channel,external_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          organization_id: orgId,
          channel: a.channel,
          mode: 'auto',
          label: a.label,
          external_id: a.external_id,
          status: 'active',
          connected_by: userId,
          connected_at: new Date().toISOString(),
        },
      })
      // Messenger et Instagram s'envoient tous deux avec le token de la Page.
      await rest('channel_credentials?on_conflict=channel_account_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          channel_account_id: account.id,
          access_token: page.access_token,
          scopes: ['pages_messaging', 'instagram_manage_messages'],
          updated_at: new Date().toISOString(),
        },
      })
      connected.push({ channel: a.channel, label: a.label })
    }
  }

  return json({ connected })
}))
