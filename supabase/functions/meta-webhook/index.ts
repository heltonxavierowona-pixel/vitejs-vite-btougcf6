// Webhook Meta (Messenger, Instagram, WhatsApp) — remplace le workflow n8n 01, sans serveur.
// GET  : vérification de l'abonnement (hub.verify_token = platform_settings.meta_verify_token).
// POST : signature X-Hub-Signature-256 vérifiée avec META_APP_SECRET, événement brut gardé
//        dans raw_events, puis messages, commentaires et échos WhatsApp ingérés en base.
// Déploiement : verify_jwt = false (Meta n'envoie pas de session Supabase).
import { GRAPH, rest } from '../_shared/supabase.ts'

type Ev =
  | { kind: 'message'; channel: string; account_external_id: string; external_user_id: string; display_name: string | null; external_message_id: string; body: string; sent_at: string }
  | { kind: 'comment'; channel: string; account_external_id: string; comment_id: string; post_id: string | null; from_id: string | null; from_name: string | null; body: string }
  | { kind: 'echo'; account_external_id: string; to: string; external_message_id: string; body: string; sent_at: string }

const iso = (ms: number) => new Date(ms).toISOString()

async function verifyToken(): Promise<string | null> {
  const rows = await rest<{ value: unknown }[]>('platform_settings?key=eq.meta_verify_token&select=value')
  const v = rows[0]?.value
  return typeof v === 'string' && v ? v : null
}

async function signatureOk(raw: Uint8Array, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('META_APP_SECRET')
  if (!secret || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw))
  const expected = 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== header.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

// Même découpage que le nœud « Extraire événements » du workflow n8n 01.
// deno-lint-ignore no-explicit-any
function extract(body: any): Ev[] {
  const out: Ev[] = []
  const object = body?.object
  for (const entry of body?.entry ?? []) {
    if (object === 'page' || object === 'instagram') {
      const channel = object === 'page' ? 'facebook' : 'instagram'
      for (const ev of entry.messaging ?? []) {
        const m = ev.message
        if (!m || m.is_echo) continue
        out.push({
          kind: 'message', channel,
          account_external_id: String(ev.recipient.id),
          external_user_id: String(ev.sender.id),
          display_name: null,
          external_message_id: m.mid,
          body: m.text || (m.attachments ? '[pièce jointe]' : '[message non textuel]'),
          sent_at: iso(Number(ev.timestamp)),
        })
      }
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {}
        if (channel === 'facebook' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
          out.push({
            kind: 'comment', channel, account_external_id: String(entry.id),
            comment_id: String(v.comment_id), post_id: v.post_id ? String(v.post_id) : null,
            from_id: v.from ? String(v.from.id) : null, from_name: v.from?.name ?? null, body: v.message ?? '',
          })
        }
        if (channel === 'instagram' && change.field === 'comments') {
          out.push({
            kind: 'comment', channel, account_external_id: String(entry.id),
            comment_id: String(v.id), post_id: v.media ? String(v.media.id) : null,
            from_id: v.from ? String(v.from.id) : null, from_name: v.from?.username ?? null, body: v.text ?? '',
          })
        }
      }
    }
    if (object === 'whatsapp_business_account') {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {}
        const names: Record<string, string> = Object.fromEntries(
          // deno-lint-ignore no-explicit-any
          (v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]),
        )
        for (const m of v.messages ?? []) {
          out.push({
            kind: 'message', channel: 'whatsapp',
            account_external_id: String(v.metadata.phone_number_id),
            external_user_id: String(m.from), display_name: names[m.from] ?? null,
            external_message_id: m.id,
            body: m.type === 'text' ? m.text.body : `[${m.type} non pris en charge]`,
            sent_at: iso(Number(m.timestamp) * 1000),
          })
        }
        if (change.field === 'smb_message_echoes') {
          for (const m of v.message_echoes ?? []) {
            out.push({
              kind: 'echo', account_external_id: String(v.metadata.phone_number_id), to: String(m.to),
              external_message_id: m.id, body: m.type === 'text' ? m.text.body : `[${m.type}]`,
              sent_at: iso(Number(m.timestamp) * 1000),
            })
          }
        }
      }
    }
  }
  return out
}

async function handle(ev: Ev) {
  if (ev.kind === 'message') {
    await rest('rpc/ingest_inbound_message', {
      method: 'POST',
      body: {
        p_channel: ev.channel, p_account_external_id: ev.account_external_id, p_external_user_id: ev.external_user_id,
        p_display_name: ev.display_name, p_external_message_id: ev.external_message_id, p_body: ev.body, p_sent_at: ev.sent_at,
      },
    })
  } else if (ev.kind === 'echo') {
    await rest('rpc/ingest_outbound_echo', {
      method: 'POST',
      body: { p_account_external_id: ev.account_external_id, p_to: ev.to, p_external_message_id: ev.external_message_id, p_body: ev.body, p_sent_at: ev.sent_at },
    })
  } else {
    const r = await rest<{ message_id?: string; comment_id?: string; reply?: string; access_token?: string } | null>('rpc/handle_comment', {
      method: 'POST',
      body: {
        p_channel: ev.channel, p_account_external_id: ev.account_external_id, p_comment_id: ev.comment_id,
        p_post_id: ev.post_id, p_from_id: ev.from_id, p_from_name: ev.from_name, p_body: ev.body,
      },
    })
    // Mot-clé reconnu : réponse privée au commentaire (Graph API), résultat noté sur le message.
    if (!r?.message_id) return
    const res = await fetch(`${GRAPH}/me/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { comment_id: r.comment_id }, message: { text: r.reply } }),
    })
    const data = await res.json().catch(() => ({}))
    await rest('rpc/mark_message_result', {
      method: 'POST',
      body: res.ok
        ? { p_message: r.message_id, p_status: 'sent', p_external_id: data.message_id ?? null }
        : { p_message: r.message_id, p_status: 'failed', p_error: JSON.stringify(data.error ?? data).slice(0, 500) },
    })
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const expected = await verifyToken().catch(() => null)
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && url.searchParams.get('hub.verify_token') === expected) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const raw = new Uint8Array(await req.arrayBuffer())
  if (!(await signatureOk(raw, req.headers.get('x-hub-signature-256')))) {
    console.error('Signature Meta invalide ou META_APP_SECRET absent : requête ignorée')
    return new Response('invalid signature', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return new Response('bad json', { status: 400 })
  }

  await rest('raw_events', { method: 'POST', body: { source: 'meta', payload: body }, prefer: 'return=minimal' })
    .catch((e) => console.error('raw_events', e))

  // Un événement en erreur (compte inconnu, doublon…) n'empêche pas les autres ; Meta reçoit toujours 200.
  for (const ev of extract(body)) {
    await handle(ev).catch((e) => console.error('meta-webhook', ev.kind, e instanceof Error ? e.message : e))
  }
  return new Response('ok', { status: 200 })
})
