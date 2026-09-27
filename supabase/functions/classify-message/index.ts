// POST { message_id }
// Classe l'intention d'un message reçu et applique la machine à états (apply_intent).
// Intérêt explicite hors WhatsApp → message de bascule avec lien wa.me personnel :
//   - Facebook / Instagram (auto) : mis en file d'envoi (workflow 02) si l'organisation l'autorise ;
//   - LinkedIn / X (assisté) : brouillon à copier par l'utilisateur.
// Appelée par n8n (workflow 03, secret partagé) ou par la plateforme (réponse LinkedIn/X collée).
import { handler, HttpError, isServiceCall, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import {
  type AiContext, buildDraftSystem, buildDraftUser, buildIntentUser, type Channel, INTENT_SYSTEM,
  insertHandoffLink, normalizeDraft, normalizeIntent, whatsappLink,
} from '../_shared/prompts.ts'

interface MessageRow {
  id: string
  body: string
  direction: string
  conversation_id: string
  channel_accounts: { channel: Channel; mode: string }
  conversations: { prospect_id: string }
}

Deno.serve(handler(async (req) => {
  const service = isServiceCall(req)
  const jwt = service ? undefined : (await requireUser(req)).jwt
  const { message_id } = (await req.json()) as { message_id: string }
  if (!message_id) throw new HttpError(400, 'message_id requis')

  const [msg] = await rest<MessageRow[]>(
    `messages?id=eq.${message_id}&select=id,body,direction,conversation_id,channel_accounts(channel,mode),conversations(prospect_id)`,
    { jwt },
  )
  if (!msg || msg.direction !== 'inbound') throw new HttpError(404, 'Message entrant introuvable')
  // Les réponses LinkedIn/X sont classées à la demande de l'utilisateur (résultat affiché immédiatement).
  if (service && msg.channel_accounts.mode === 'assisted') return json({ skipped: true })

  const ctx = await rest<AiContext & { organization_id: string }>('rpc/prospect_ai_context', {
    method: 'POST', jwt, body: { p_prospect: msg.conversations.prospect_id, p_conversation: msg.conversation_id },
  })

  const intent = normalizeIntent(
    await chatJSON({
      model: MODELS.fast, system: INTENT_SYSTEM, user: buildIntentUser(ctx),
      maxTokens: 300, temperature: 0, orgId: ctx.organization_id, feature: 'intent',
    }),
    msg.body,
  )

  // Écritures côté serveur (fonctions réservées à service_role).
  const result = await rest<{
    action: string; prospect_id: string; conversation_id: string; channel: Channel; mode: string
    organization_id: string; handoff_code: string | null; window_open: boolean
  }>('rpc/apply_intent', {
    method: 'POST',
    body: {
      p_message: msg.id, p_intent: intent.intent, p_confidence: intent.confidence,
      p_evidence: intent.evidence, p_phone: intent.phone,
    },
  })

  if (result.action !== 'propose_handoff' || !result.handoff_code) return json({ ...intent, ...result })

  const [wa] = await rest<{ display_phone: string | null }[]>(
    `channel_accounts?organization_id=eq.${result.organization_id}&channel=eq.whatsapp&status=eq.active&select=display_phone&limit=1`,
  )
  if (!wa?.display_phone) return json({ ...intent, ...result, action: 'handoff_no_whatsapp' })

  const link = whatsappLink(wa.display_phone, result.handoff_code, ctx.product?.name)
  const draft = normalizeDraft(
    await chatJSON({
      model: MODELS.write,
      system: buildDraftSystem(ctx, result.channel, 'handoff'),
      user: buildDraftUser(ctx, 'handoff'),
      maxTokens: 800, temperature: 0.6, orgId: result.organization_id, feature: 'handoff',
    }),
    result.channel,
    'handoff',
  )
  const variants = draft.variants.map((v) => ({ ...v, text: insertHandoffLink(v.text, link) }))
  if (!variants.length) variants.push({ text: insertHandoffLink('Avec plaisir ! Écrivez-moi sur WhatsApp, je vous envoie tous les détails :', link), angle: 'défaut' })

  const [org] = await rest<{ automation: { handoff_auto?: boolean } }[]>(
    `organizations?id=eq.${result.organization_id}&select=automation`,
  )
  const auto = result.mode === 'auto' && result.window_open && org?.automation?.handoff_auto !== false

  if (auto) {
    // Mis en file : le workflow 02 l'envoie via l'API Meta.
    await rest('messages', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        organization_id: result.organization_id, conversation_id: result.conversation_id,
        channel_account_id: (await rest<{ channel_account_id: string }[]>(
          `conversations?id=eq.${result.conversation_id}&select=channel_account_id`))[0].channel_account_id,
        direction: 'outbound', status: 'queued', body: variants[0].text, ai_generated: true,
        ai_meta: { kind: 'handoff', intent: intent.intent, confidence: intent.confidence },
      },
    })
    return json({ ...intent, ...result, action: 'handoff_sent', text: variants[0].text })
  }

  const [saved] = await rest<unknown[]>('ai_drafts', {
    method: 'POST',
    body: {
      organization_id: result.organization_id, prospect_id: result.prospect_id,
      conversation_id: result.conversation_id, kind: 'handoff', channel: result.channel,
      language: draft.language, formality: draft.formality, variants, sensitive: draft.sensitive,
      rationale: draft.rationale, model: MODELS.write,
    },
  })
  return json({ ...intent, ...result, action: 'handoff_draft', draft: saved })
}))
