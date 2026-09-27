// POST { product_id, channel: 'linkedin' | 'x', items: [{ profile_url?, text }] }
// L'utilisateur colle des profils qu'il consulte lui-même ; l'IA extrait les
// informations utiles, choisit le segment et note l'adéquation avec le produit.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'

const MODEL = MODELS.fast
const MAX_ITEMS = 20

const SYSTEM_PROMPT = `Tu qualifies des prospects pour le produit d'un utilisateur de « Le Closer ».
Tu reçois : la fiche du produit, ses segments de cible, et une liste de profils copiés par l'utilisateur.

Pour CHAQUE profil, dans le même ordre, renvoie :
- full_name, job_title, company, country : extraits du texte, sinon null
- language : langue probable de conversation (code ISO « fr », « en »…)
- segment : le nom EXACT d'un des segments fournis, ou null si aucun ne correspond
- fit_score : 0 à 100 = probabilité que cette personne soit acheteuse ou décisionnaire pour ce produit
- fit_reasons : 2 ou 3 raisons courtes et factuelles, tirées du profil (poste, secteur, taille d'entreprise, pays, signaux d'intérêt)

Barème : 80+ = décideur dans le cœur de cible ; 50-79 = cible plausible ou influenceur de la décision ;
20-49 = lien faible ; <20 = hors cible (étudiant sans lien, concurrent, secteur sans rapport).

Règles :
- N'invente rien qui n'est pas dans le texte.
- Ne déduis jamais de donnée sensible (santé, religion, origine, opinions politiques, vie privée).
- Un concurrent direct du produit reçoit un score inférieur à 20.

Réponds UNIQUEMENT en JSON : {"prospects": [{"full_name": "", "job_title": "", "company": "", "country": "", "language": "fr", "segment": "", "fit_score": 0, "fit_reasons": [""]}]}`

interface Item {
  profile_url?: string
  text: string
}

Deno.serve(handler(async (req) => {
  const { jwt, orgId } = await requireUser(req)
  const { product_id, channel, items } = (await req.json()) as { product_id: string; channel: string; items: Item[] }
  if (!product_id || !Array.isArray(items) || !items.length) throw new HttpError(400, 'product_id et items requis')
  if (channel !== 'linkedin' && channel !== 'x') throw new HttpError(400, 'Import disponible pour LinkedIn et X')
  if (items.length > MAX_ITEMS) throw new HttpError(400, `${MAX_ITEMS} profils maximum par import`)

  const [product] = await rest<{ name: string; description: string; target: string | null; analysis: { segments?: { name: string; description: string }[] } | null }[]>(
    `products?id=eq.${product_id}&select=name,description,target,analysis`,
    { jwt },
  )
  if (!product) throw new HttpError(404, 'Produit introuvable')

  // Profils déjà présents (même URL) : ignorés.
  const urls = items.map((i) => i.profile_url?.trim()).filter(Boolean) as string[]
  const existing = urls.length
    ? await rest<{ profile_url: string }[]>(
        `prospects?select=profile_url&profile_url=in.(${urls.map((u) => `"${u.replace(/"/g, '')}"`).join(',')})`,
        { jwt },
      )
    : []
  const known = new Set(existing.map((e) => e.profile_url))
  const fresh = items.filter((i) => !i.profile_url || !known.has(i.profile_url.trim()))
  if (!fresh.length) return json({ inserted: [], skipped: items.length })

  const parsed = (await chatJSON({
    model: MODEL,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      produit: { nom: product.name, description: product.description, cible: product.target },
      segments: product.analysis?.segments ?? [],
      profils: fresh.map((i, n) => ({ n, texte: i.text.slice(0, 3000) })),
    }),
    maxTokens: 400 + 250 * fresh.length,
    temperature: 0.1,
    orgId,
    feature: 'qualify',
  })) as { prospects?: Record<string, unknown>[] }
  const out = parsed.prospects ?? []
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)

  const rows = fresh.map((item, n) => {
    const p = out[n] ?? {}
    return {
      organization_id: orgId,
      product_id,
      full_name: str(p.full_name),
      job_title: str(p.job_title),
      company: str(p.company),
      country: str(p.country),
      language: str(p.language)?.slice(0, 5) ?? null,
      segment_label: str(p.segment),
      fit_score: Math.max(0, Math.min(100, Math.round(Number(p.fit_score) || 0))),
      fit_reasons: Array.isArray(p.fit_reasons) ? p.fit_reasons.slice(0, 3).map(String) : [],
      profile_url: item.profile_url?.trim() || null,
      profile_text: item.text.slice(0, 3000),
      best_channel: channel,
      source: `import_${channel}`,
      stage: 'new',
      qualified_at: new Date().toISOString(),
    }
  })

  const inserted = await rest('prospects', { method: 'POST', jwt, body: rows })
  return json({ inserted, skipped: items.length - fresh.length })
}))
