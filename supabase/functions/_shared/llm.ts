// Appel LLM via OpenRouter, sortie JSON, avec traçage de la consommation
// par organisation (table ai_usage) pour la facturation du SaaS.
import { HttpError, rest } from './supabase.ts'

export const MODELS = {
  // Tri, extraction, profils : rapide et économique.
  fast: Deno.env.get('OPENROUTER_MODEL') ?? 'anthropic/claude-haiku-4.5',
  // Rédaction des messages : qualité d'écriture.
  write: Deno.env.get('OPENROUTER_WRITE_MODEL') ?? 'anthropic/claude-sonnet-4.5',
}

export async function chatJSON(opts: {
  model: string
  system: string
  user: string
  maxTokens: number
  temperature?: number
  orgId: string
  feature: string
}): Promise<Record<string, unknown>> {
  // Abonnement actif et quota mensuel d'actions IA de la formule non dépassé.
  const quotaOk = await rest<boolean>('rpc/ai_quota_ok', { method: 'POST', body: { p_org: opts.orgId } })
  if (quotaOk === false) {
    throw new HttpError(402, 'Quota IA de votre formule atteint, ou abonnement inactif : voir « Abonnement »')
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens,
      response_format: { type: 'json_object' },
      usage: { include: true },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  })
  if (!res.ok) throw new HttpError(502, `OpenRouter: ${await res.text()}`)
  const completion = await res.json()

  const usage = completion.usage ?? {}
  await rest('rpc/record_ai_usage', {
    method: 'POST',
    body: {
      p_org: opts.orgId, p_feature: opts.feature, p_model: completion.model ?? opts.model,
      p_in: usage.prompt_tokens ?? 0, p_out: usage.completion_tokens ?? 0, p_cost: usage.cost ?? 0,
    },
  }).catch((e) => console.error('ai_usage', e)) // ne bloque jamais la réponse

  const raw: string = completion.choices?.[0]?.message?.content ?? ''
  try {
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  } catch {
    throw new HttpError(502, 'Réponse IA illisible, réessayez')
  }
}
