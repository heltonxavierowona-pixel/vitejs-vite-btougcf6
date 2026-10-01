// POST { conversation_id }
// Appelée par n8n (workflow 03) à chaque message entrant : met à jour le profil
// relationnel du prospect (langue, tu/vous, style, intérêts, objections, signaux d'achat).
import { handler, HttpError, isServiceCall, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import { type AiContext, buildProfileUser, normalizeProfile, PROFILE_SYSTEM } from '../_shared/prompts.ts'

Deno.serve(handler(async (req) => {
  // n8n (secret partagé) ou utilisateur connecté (bouton « Mettre à jour le profil »).
  const jwt = (await isServiceCall(req)) ? undefined : (await requireUser(req)).jwt
  const { conversation_id } = (await req.json()) as { conversation_id: string }
  if (!conversation_id) throw new HttpError(400, 'conversation_id requis')

  const [conv] = await rest<{ prospect_id: string }[]>(
    `conversations?id=eq.${conversation_id}&select=prospect_id`, { jwt },
  )
  if (!conv) throw new HttpError(404, 'Conversation introuvable')

  const ctx = await rest<AiContext & { organization_id: string }>('rpc/prospect_ai_context', {
    method: 'POST', jwt, body: { p_prospect: conv.prospect_id, p_conversation: conversation_id },
  })
  const inbound = (ctx.conversation?.messages ?? []).filter((m) => m.from === 'prospect').length
  const seen = Number((ctx.profile as { messages_seen?: number } | null)?.messages_seen ?? 0)
  if (!inbound || inbound <= seen) return json({ skipped: true })

  const raw = await chatJSON({
    model: MODELS.fast,
    system: PROFILE_SYSTEM,
    user: buildProfileUser(ctx),
    maxTokens: 700,
    temperature: 0.1,
    orgId: ctx.organization_id,
    feature: 'profile',
  })
  const profile = normalizeProfile(raw)

  // Écriture côté serveur (fonction réservée à service_role).
  await rest('rpc/save_prospect_profile', {
    method: 'POST',
    body: { p_prospect: conv.prospect_id, p_profile: profile, p_messages_seen: inbound },
  })
  return json({ profile })
}))
