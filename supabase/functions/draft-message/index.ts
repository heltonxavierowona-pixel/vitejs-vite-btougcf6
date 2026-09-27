// POST { prospect_id, kind: 'invitation' | 'opening' | 'reply' | 'followup', conversation_id? }
// Rédige des variantes de message personnalisées pour un prospect, dans sa langue,
// avec le ton adapté à son profil relationnel. Enregistrées dans ai_drafts.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import {
  type AiContext, buildDraftSystem, buildDraftUser, type Channel, type DraftKind, normalizeDraft,
} from '../_shared/prompts.ts'

Deno.serve(handler(async (req) => {
  const { jwt, orgId } = await requireUser(req)
  const { prospect_id, kind, conversation_id } = (await req.json()) as {
    prospect_id: string
    kind: DraftKind
    conversation_id?: string
  }
  if (!prospect_id || !['invitation', 'opening', 'reply', 'followup'].includes(kind)) {
    throw new HttpError(400, 'prospect_id et kind (invitation | opening | reply | followup) requis')
  }
  if (kind === 'reply' && !conversation_id) throw new HttpError(400, 'conversation_id requis pour une réponse')

  // Jeton de l'utilisateur : RLS garantit que le prospect lui appartient.
  const ctx = await rest<AiContext | null>('rpc/prospect_ai_context', {
    method: 'POST', jwt, body: { p_prospect: prospect_id, p_conversation: conversation_id ?? null },
  })
  if (!ctx) throw new HttpError(404, 'Prospect introuvable')

  let channel: Channel
  let followupNumber = 1
  if (kind === 'followup') {
    // Relance : sur le canal de la dernière conversation, numéro = relances déjà faites.
    const [p] = await rest<{ followups_sent: number; best_channel: Channel | null }[]>(
      `prospects?id=eq.${prospect_id}&select=followups_sent,best_channel`, { jwt })
    followupNumber = Math.max(1, Math.min(2, p?.followups_sent ?? 1))
    channel = ctx.conversation?.channel ?? p?.best_channel ?? 'linkedin'
  } else if (kind === 'reply') {
    if (!ctx.conversation) throw new HttpError(404, 'Conversation introuvable')
    channel = ctx.conversation.channel
  } else {
    const [p] = await rest<{ best_channel: Channel | null }[]>(`prospects?id=eq.${prospect_id}&select=best_channel`, { jwt })
    channel = p?.best_channel ?? 'linkedin'
    if (channel !== 'linkedin' && channel !== 'x') {
      throw new HttpError(400, 'Premier message à froid possible uniquement sur LinkedIn et X')
    }
    if (kind === 'invitation' && channel !== 'linkedin') {
      throw new HttpError(400, 'La note d\'invitation n\'existe que sur LinkedIn')
    }
  }

  const raw = await chatJSON({
    model: MODELS.write,
    system: buildDraftSystem(ctx, channel, kind, followupNumber),
    user: buildDraftUser(ctx, kind),
    maxTokens: 1200,
    temperature: 0.7,
    orgId,
    feature: 'draft',
  })
  const draft = normalizeDraft(raw, channel, kind)
  if (!draft.variants.length) throw new HttpError(502, 'Aucune variante générée, réessayez')

  const [saved] = await rest<unknown[]>('ai_drafts', {
    method: 'POST',
    jwt,
    body: {
      organization_id: orgId, prospect_id, conversation_id: conversation_id ?? null, kind, channel,
      language: draft.language, formality: draft.formality, variants: draft.variants,
      sensitive: draft.sensitive, rationale: draft.rationale, model: MODELS.write,
    },
  })
  return json(saved)
}))
