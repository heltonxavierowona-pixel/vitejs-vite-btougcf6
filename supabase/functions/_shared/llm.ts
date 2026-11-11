// Appel LLM via OpenRouter, sortie JSON, avec traçage de la consommation
// par organisation (table ai_usage) pour la facturation du SaaS.
import { HttpError, rest } from './supabase.ts'

// Nom de modèle saisi dans les secrets : espaces et point final (faute de frappe fréquente) retirés.
const env = (name: string) => Deno.env.get(name)?.trim().replace(/\.+$/, '') || undefined

const fast = env('OPENROUTER_MODEL') ?? 'anthropic/claude-haiku-5.5'
const write = env('OPENROUTER_WRITE_MODEL') ?? 'anthropic/claude-sonnet-5.5'

export const MODELS = {
  // Tri, extraction, profils : rapide et économique.
  fast,
  // Rédaction des messages : qualité d'écriture.
  write,
  // Création des publications : peut recevoir un modèle plus créatif, seul (peu d'appels, coût faible).
  posts: env('OPENROUTER_POSTS_MODEL') ?? write,
}

// Modèles gratuits de secours (crédit épuisé, modèle saturé ou en panne) : la liste du secret
// OPENROUTER_FALLBACK_MODELS, complétée par des valeurs sûres ; « openrouter/free » choisit
// lui-même un modèle gratuit disponible.
const isFree = (m: string) => m.endsWith(':free') || m === 'openrouter/free'
const FREE_MODELS = [...new Set([
  ...(env('OPENROUTER_FALLBACK_MODELS') ?? '').split(',').map((m) => m.trim()),
  'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning:free', 'openrouter/free',
])].filter(isFree)

const RETRYABLE = (status: number) => status === 402 || status === 408 || status === 429 || status >= 500

export async function chatJSON(opts: {
  model: string
  system: string
  user: string
  maxTokens: number
  temperature?: number
  orgId: string
  feature: string
  // Tâche de fond (intention, profil) : essais plus courts pour ne pas retarder la réponse au client.
  quick?: boolean
}): Promise<Record<string, unknown>> {
  // Abonnement actif et quota mensuel d'actions IA de la formule non dépassé.
  const quotaOk = await rest<boolean>('rpc/ai_quota_ok', { method: 'POST', body: { p_org: opts.orgId } })
  if (quotaOk === false) {
    throw new HttpError(402, 'Quota IA de votre formule atteint, ou abonnement inactif : voir « Abonnement »')
  }

  const send = (models: string[], maxTokens: number) => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: models[0],
      models: models.length > 1 ? models : undefined,
      temperature: opts.temperature ?? 0.3,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      // Modèles « à raisonnement » : le raisonnement ne doit pas manger la réponse.
      reasoning: { exclude: true },
      usage: { include: true },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  })
  const parse = (raw: string): Record<string, unknown> | null => {
    const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '')
    try {
      const v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      return v && typeof v === 'object' ? v : null
    } catch {
      return null
    }
  }

  let res = await send([opts.model], opts.maxTokens)
  if (res.status === 402) {
    // Crédit OpenRouter bas : on réessaie une fois avec ce que le crédit permet encore.
    const afford = Number((await res.text()).match(/can only afford (\d+)/)?.[1] ?? 0)
    if (afford >= 400) res = await send([opts.model], afford - 50)
  }
  // Crédit épuisé, modèle saturé, en panne ou réponse illisible : modèles gratuits de secours.
  // Jusqu'à 6 essais sur ~70 s ; chaque essai commence par un autre modèle (les modèles gratuits
  // sont souvent saturés quelques secondes).
  let free = [...new Set([opts.model, ...FREE_MODELS])].filter(isFree)
  const WAITS = opts.quick ? [0, 2, 4, 8] : [0, 3, 6, 12, 20, 30]
  for (let i = 0; i <= WAITS.length; i++) {
    if (res.ok) {
      const completion = await res.json().catch(() => ({}))
      const raw: string = completion.choices?.[0]?.message?.content ?? ''
      const parsed = parse(raw)
      if (parsed) {
        const usage = completion.usage ?? {}
        await rest('rpc/record_ai_usage', {
          method: 'POST',
          body: {
            p_org: opts.orgId, p_feature: opts.feature, p_model: completion.model ?? opts.model,
            p_in: usage.prompt_tokens ?? 0, p_out: usage.completion_tokens ?? 0, p_cost: usage.cost ?? 0,
          },
        }).catch((e) => console.error('ai_usage', e)) // ne bloque jamais la réponse
        return parsed
      }
      console.error('openrouter illisible', completion.model, JSON.stringify(raw).slice(0, 300))
    } else {
      // 400/404 : modèle retiré du catalogue → on passe au suivant ; autre erreur définitive : on arrête.
      if (!RETRYABLE(res.status) && res.status !== 400 && res.status !== 404) break
      console.error('openrouter', res.status, (await res.text().catch(() => '')).slice(0, 200))
    }
    if (i === WAITS.length || !free.length) break
    if (WAITS[i]) await new Promise((r) => setTimeout(r, WAITS[i] * 1000))
    if (i) free = [...free.slice(1), free[0]] // rotation : un autre modèle en tête
    res = await send(free.slice(0, 3), Math.max(opts.maxTokens, 1200))
  }
  if (res.status === 402) {
    throw new HttpError(402, 'Crédit IA épuisé : rechargez votre compte OpenRouter (openrouter.ai → Settings → Credits) pour que l\'agent continue à répondre.')
  }
  if (!res.ok) throw new HttpError(502, `Service IA saturé (${res.status}), réessayez dans un instant`)
  throw new HttpError(502, 'Réponse IA illisible, réessayez')
}
