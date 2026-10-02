// POST { kind: 'outbound', message_id } | { kind: 'inbound', message_id, conversation_id }
//    | { kind: 'publish', post_id } | { kind: 'comment', comment_id, prospect_id, conversation_id, ... }
// Appelée par la base (triggers, pg_net, pg_cron) avec le secret x-numera-secret.
//   outbound : envoie un message mis en file via la Graph API (WhatsApp, Messenger, Instagram) ;
//   inbound  : attend 20 s (rafales), puis intention → profil → agent commercial ;
//   publish  : publie une publication sur la Page Facebook ou le compte Instagram ;
//   comment  : l'IA écrit en privé à la personne qui a commenté (+ courte réponse publique).
// Déploiement : verify_jwt = false.
import { GRAPH, handler, HttpError, isServiceCall, json, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import {
  type AiContext, applySaleLinks, buildCommentSystem, buildDraftUser, type Channel, normalizeAutopilot,
} from '../_shared/prompts.ts'

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

// Graph API avec le token de la Page ; renvoie { ok, data }.
async function meta(path: string, token: string, body?: unknown, method = 'POST') {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data: data as Record<string, unknown> & { id?: string; error?: unknown } }
}
const metaError = (d: Record<string, unknown>) => JSON.stringify(d.error ?? d).slice(0, 500)

interface Account { id: string; channel: string; external_id: string; channel_credentials: { access_token: string } | { access_token: string }[] | null }
const tokenOf = (a: Account) => {
  const c = Array.isArray(a.channel_credentials) ? a.channel_credentials[0] : a.channel_credentials
  return c?.access_token ?? null
}
const ACCOUNT_FIELDS = 'id,channel,external_id,channel_credentials(access_token)'

interface Post {
  id: string; organization_id: string; channel: 'facebook' | 'instagram'; channel_account_id: string | null
  body: string; image_url: string | null; status: string
}

async function publishPost(postId: string) {
  const [post] = await rest<Post[]>(`posts?id=eq.${postId}&select=*`)
  if (!post || post.status !== 'publishing') return { skipped: true }
  const fail = async (error: string) => {
    await rest(`posts?id=eq.${postId}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed', error, updated_at: new Date().toISOString() },
    })
    return { published: false, error }
  }

  const [account] = await rest<Account[]>(post.channel_account_id
    ? `channel_accounts?id=eq.${post.channel_account_id}&select=${ACCOUNT_FIELDS}`
    : `channel_accounts?organization_id=eq.${post.organization_id}&channel=eq.${post.channel}&status=eq.active&select=${ACCOUNT_FIELDS}&order=connected_at.desc&limit=1`)
  const token = account && tokenOf(account)
  if (!account || !token) return fail(`Aucun compte ${post.channel === 'facebook' ? 'Facebook' : 'Instagram'} connecté (page « Canaux »)`)

  let externalId: string | null = null
  let permalink: string | null = null
  if (post.channel === 'facebook') {
    const r = post.image_url
      ? await meta(`${account.external_id}/photos`, token, { url: post.image_url, message: post.body })
      : await meta(`${account.external_id}/feed`, token, { message: post.body })
    if (!r.ok) return fail(metaError(r.data))
    externalId = String(r.data.post_id ?? r.data.id)
    const p = await meta(`${externalId}?fields=permalink_url`, token, undefined, 'GET')
    permalink = (p.data.permalink_url as string) ?? null
  } else {
    if (!post.image_url) return fail('Instagram exige une image')
    const c = await meta(`${account.external_id}/media`, token, { image_url: post.image_url, caption: post.body })
    if (!c.ok || !c.data.id) return fail(metaError(c.data))
    // Le conteneur doit être prêt (téléchargement de l'image par Instagram).
    for (let i = 0; i < 10; i++) {
      const st = await meta(`${c.data.id}?fields=status_code`, token, undefined, 'GET')
      if (st.data.status_code === 'FINISHED') break
      if (st.data.status_code === 'ERROR') return fail('Instagram a refusé l\'image (format JPEG conseillé, ratio entre 4:5 et 1.91:1)')
      await new Promise((r) => setTimeout(r, 2000))
    }
    const r = await meta(`${account.external_id}/media_publish`, token, { creation_id: c.data.id })
    if (!r.ok || !r.data.id) return fail(metaError(r.data))
    externalId = String(r.data.id)
    const p = await meta(`${externalId}?fields=permalink`, token, undefined, 'GET')
    permalink = (p.data.permalink as string) ?? null
  }

  await rest(`posts?id=eq.${postId}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      status: 'published', error: null, external_id: externalId, permalink, channel_account_id: account.id,
      published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  })
  return { published: true, external_id: externalId }
}

interface CommentHook {
  comment_id: string; prospect_id: string; conversation_id: string; channel_account_id: string
  comment: string; from_name: string | null
}

// Commentaire sans mot-clé : premier message privé rédigé par l'agent commercial.
async function replyToComment(h: CommentHook) {
  const [account] = await rest<Account[]>(`channel_accounts?id=eq.${h.channel_account_id}&select=${ACCOUNT_FIELDS}`)
  const token = account && tokenOf(account)
  if (!account || !token) return { skipped: 'no_token' }
  const channel = account.channel as Channel

  const ctx = await rest<AiContext & { organization_id: string }>('rpc/prospect_ai_context', {
    method: 'POST', body: { p_prospect: h.prospect_id, p_conversation: h.conversation_id },
  })
  const raw = await chatJSON({
    model: MODELS.write,
    system: buildCommentSystem(ctx, channel),
    user: JSON.stringify({ ...JSON.parse(buildDraftUser(ctx, 'reply')), commentaire: h.comment, auteur: h.from_name }),
    maxTokens: 700,
    temperature: 0.5,
    orgId: ctx.organization_id,
    feature: 'comment_reply',
  })
  if (raw.skip === true) return { skipped: 'ai_skip' }
  const reply = normalizeAutopilot(raw, h.comment, channel, ctx.product?.knowledge)
  if (!reply.text) return { skipped: 'empty' }
  // Prix inventé ou demande particulière : rien n'est envoyé, l'utilisateur reprend la main.
  if (reply.sensitive || reply.escalate) {
    await rest(`conversations?id=eq.${h.conversation_id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: {
        ai_paused: true, ai_paused_at: new Date().toISOString(),
        ai_paused_reason: `escalation:commentaire (${reply.reason ?? reply.topics.join(', ')})`,
      },
    })
    return { escalated: true }
  }
  const sale = applySaleLinks(reply.text, ctx, reply.closing_action)

  const [msg] = await rest<{ id: string }[]>('messages', {
    method: 'POST',
    body: {
      organization_id: ctx.organization_id, conversation_id: h.conversation_id, channel_account_id: account.id,
      direction: 'outbound', status: 'draft', body: sale.text, ai_generated: true,
    },
  })
  const r = await meta('me/messages', token, { recipient: { comment_id: h.comment_id }, message: { text: sale.text } })
  await rest('rpc/mark_message_result', {
    method: 'POST',
    body: r.ok
      ? { p_message: msg.id, p_status: 'sent', p_external_id: (r.data.message_id as string) ?? null }
      : { p_message: msg.id, p_status: 'failed', p_error: metaError(r.data) },
  })
  if (r.ok && sale.step) {
    await rest(`prospects?id=eq.${h.prospect_id}&stage=not.in.(hot,won,lost)`, {
      method: 'PATCH', prefer: 'return=minimal', body: { stage: 'hot' },
    })
  }

  // Réponse publique courte (nécessite pages_manage_engagement / instagram_manage_comments).
  const pub = String(raw.public_reply ?? '').trim().slice(0, 300)
  if (r.ok && pub && !/https?:\/\//.test(pub)) {
    const pr = await meta(channel === 'instagram' ? `${h.comment_id}/replies` : `${h.comment_id}/comments`, token, { message: pub })
    if (!pr.ok) console.error('public_reply', metaError(pr.data))
  }
  return { sent: r.ok, error: r.ok ? undefined : metaError(r.data) }
}

Deno.serve(handler(async (req) => {
  if (!(await isServiceCall(req))) throw new HttpError(401, 'Secret invalide')
  const body = (await req.json()) as { kind?: string; message_id?: string; conversation_id?: string; post_id?: string } & Partial<CommentHook>

  if (body.kind === 'publish' && body.post_id) return json(await publishPost(body.post_id))
  if (body.kind === 'comment' && body.comment_id && body.prospect_id && body.conversation_id && body.channel_account_id) {
    return json(await replyToComment(body as CommentHook))
  }

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
