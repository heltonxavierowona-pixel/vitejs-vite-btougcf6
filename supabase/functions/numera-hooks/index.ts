// POST { kind: 'outbound', message_id } | { kind: 'inbound', message_id, conversation_id }
// Appelée par la base (trigger messages_dispatch, pg_net) avec le secret x-numera-secret.
// Remplace les workflows n8n 02 et 03 :
//   outbound : envoie un message mis en file via la Graph API (WhatsApp, Messenger, Instagram) ;
//   inbound  : attend 20 s (rafales), puis intention → profil → pilote automatique.
// Déploiement : verify_jwt = false.
import { GRAPH, handler, HttpError, isServiceCall, json, rest } from '../_shared/supabase.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

interface Payload {
  message_id: string
  status: string
  body: string
  channel: string
  account_external_id: string
  recipient: string
  window_open: boolean
  template: { name: string; language: string; params?: unknown[] } | null
  access_token: string | null
}

const mark = (id: string, status: 'sent' | 'failed', extra: { p_external_id?: string | null; p_error?: string }) =>
  rest('rpc/mark_message_result', { method: 'POST', body: { p_message: id, p_status: status, ...extra } })

// Même logique que le nœud « Construire requête Meta » du workflow n8n 02.
function buildRequest(p: Payload): { url: string; payload: unknown } | { error: string } {
  if (!p.access_token) return { error: 'Canal non connecté (token absent)' }
  if (p.channel === 'whatsapp' && p.template) {
    return {
      url: `${GRAPH}/${p.account_external_id}/messages`,
      payload: {
        messaging_product: 'whatsapp', to: p.recipient, type: 'template',
        template: {
          name: p.template.name, language: { code: p.template.language },
          components: [{ type: 'body', parameters: (p.template.params ?? []).map((t) => ({ type: 'text', text: String(t) })) }],
        },
      },
    }
  }
  if (!p.window_open) return { error: 'Fenêtre de 24 h fermée : un modèle approuvé est nécessaire' }
  if (p.channel === 'whatsapp') {
    return {
      url: `${GRAPH}/${p.account_external_id}/messages`,
      payload: { messaging_product: 'whatsapp', to: p.recipient, type: 'text', text: { body: p.body } },
    }
  }
  if (p.channel === 'facebook' || p.channel === 'instagram') {
    return {
      url: `${GRAPH}/me/messages`,
      payload: { recipient: { id: p.recipient }, messaging_type: 'RESPONSE', message: { text: p.body } },
    }
  }
  return { error: `Le canal ${p.channel} est en mode assisté : envoi manuel uniquement` }
}

async function sendOutbound(messageId: string) {
  const p = await rest<Payload | null>('rpc/outbound_payload', { method: 'POST', body: { p_message: messageId } })
  if (!p || p.status !== 'queued') return { skipped: true }
  const req = buildRequest(p)
  if ('error' in req) {
    await mark(messageId, 'failed', { p_error: req.error })
    return { sent: false, error: req.error }
  }
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req.payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = JSON.stringify(data.error ?? data).slice(0, 500)
    await mark(messageId, 'failed', { p_error: error })
    return { sent: false, error }
  }
  await mark(messageId, 'sent', { p_external_id: data.messages?.[0]?.id ?? data.message_id ?? null })
  return { sent: true }
}

async function callFunction(name: string, secret: string, body: unknown) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-numera-secret': secret },
    body: JSON.stringify(body),
  })
  if (!res.ok) console.error(name, res.status, (await res.text()).slice(0, 300))
}

// Ex-workflow 03. Un seul passage profil + pilote pour une rafale de messages : seul le dernier
// message reçu de la conversation déclenche la réponse.
async function processInbound(messageId: string, conversationId: string, secret: string) {
  await new Promise((r) => setTimeout(r, 20_000))
  await callFunction('classify-message', secret, { message_id: messageId })
  const [last] = await rest<{ id: string }[]>(
    `messages?conversation_id=eq.${conversationId}&direction=eq.inbound&select=id&order=sent_at.desc&limit=1`,
  )
  if (last && last.id !== messageId) return
  await callFunction('update-profile', secret, { conversation_id: conversationId })
  await callFunction('autopilot-reply', secret, { conversation_id: conversationId })
}

Deno.serve(handler(async (req) => {
  if (!(await isServiceCall(req))) throw new HttpError(401, 'Secret invalide')
  const body = (await req.json()) as { kind?: string; message_id?: string; conversation_id?: string }
  if (!body.message_id) throw new HttpError(400, 'message_id requis')

  if (body.kind === 'outbound') return json(await sendOutbound(body.message_id))

  if (body.kind === 'inbound' && body.conversation_id) {
    const task = processInbound(body.message_id, body.conversation_id, req.headers.get('x-numera-secret')!)
      .catch((e) => console.error('inbound', e instanceof Error ? e.message : e))
    // Réponse immédiate à la base ; le traitement continue en arrière-plan.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task)
    else await task
    return json({ accepted: true }, 202)
  }
  throw new HttpError(400, 'kind inconnu')
}))
