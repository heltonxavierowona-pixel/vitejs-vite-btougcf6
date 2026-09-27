// POST { conversation_id }
// Pilote automatique : appelé par n8n (workflow 03) après chaque message reçu.
// Rédige UNE réponse ; les garde-fous finaux sont revérifiés en SQL (queue_autopilot_reply) :
//   sujet sensible → validation humaine ; passage de relais → pause de l'IA ; sinon → envoi.
import { handler, HttpError, isServiceCall, json, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import { type AiContext, buildAutopilotSystem, buildDraftUser, MEDIA_PLACEHOLDER, normalizeAutopilot } from '../_shared/prompts.ts'

interface ConversationRow {
  id: string
  prospect_id: string
  ai_paused: boolean
  channel_accounts: { channel: string; mode: string }
  organizations: { automation: { autopilot_whatsapp?: boolean; autopilot_social?: boolean } }
}

Deno.serve(handler(async (req) => {
  if (!isServiceCall(req)) throw new HttpError(401, 'Réservé au serveur')
  const { conversation_id } = (await req.json()) as { conversation_id: string }
  if (!conversation_id) throw new HttpError(400, 'conversation_id requis')

  const [conv] = await rest<ConversationRow[]>(
    `conversations?id=eq.${conversation_id}&select=id,prospect_id,ai_paused,channel_accounts(channel,mode),organizations(automation)`,
  )
  if (!conv) throw new HttpError(404, 'Conversation introuvable')

  const channel = conv.channel_accounts.channel
  const automation = conv.organizations.automation ?? {}
  const enabled = channel === 'whatsapp'
    ? automation.autopilot_whatsapp !== false
    : (channel === 'facebook' || channel === 'instagram') && automation.autopilot_social === true
  if (!enabled || conv.channel_accounts.mode !== 'auto') return json({ action: 'skipped', reason: 'disabled' })
  if (conv.ai_paused) return json({ action: 'skipped', reason: 'paused' })

  const ctx = await rest<AiContext & { organization_id: string }>('rpc/prospect_ai_context', {
    method: 'POST', body: { p_prospect: conv.prospect_id, p_conversation: conversation_id },
  })
  const messages = ctx.conversation?.messages ?? []
  const last = messages[messages.length - 1]
  if (!last || last.from !== 'prospect') return json({ action: 'skipped', reason: 'already_answered' })

  const queue = (body: string, sensitive: boolean, topics: string[], escalate: boolean, reason: string | null) =>
    rest('rpc/queue_autopilot_reply', {
      method: 'POST',
      body: {
        p_conversation: conversation_id, p_body: body, p_sensitive: sensitive, p_topics: topics,
        p_escalate: escalate, p_reason: reason, p_model: MODELS.write,
      },
    })

  // Texte uniquement : un vocal ou une image est confié à l'humain.
  if (MEDIA_PLACEHOLDER.test(last.text.trim())) {
    return json(await queue('', false, [], true, 'message non textuel (vocal, image…)'))
  }

  const raw = await chatJSON({
    model: MODELS.write,
    system: buildAutopilotSystem(ctx),
    user: buildDraftUser(ctx, 'reply'),
    maxTokens: 600,
    temperature: 0.5,
    orgId: ctx.organization_id,
    feature: 'autopilot',
  })
  const reply = normalizeAutopilot(raw, last.text)

  // Passage de relais : la réponse d'attente passe quand même par la validation si elle est sensible.
  if (reply.escalate && reply.text) {
    await queue(reply.text, reply.sensitive, reply.topics, false, null)
    await rest('conversations?id=eq.' + conversation_id, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { ai_paused: true, ai_paused_reason: `escalation:${reply.reason}`, ai_paused_at: new Date().toISOString() },
    })
    return json({ action: 'escalated', reason: reply.reason })
  }
  return json(await queue(reply.text, reply.sensitive, reply.topics, reply.escalate, reply.reason))
}))
