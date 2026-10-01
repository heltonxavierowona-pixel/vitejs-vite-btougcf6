// POST { product_id } → analyse IA du produit : cibles, canaux recommandés,
// ton, langues, accroches. Enregistrée dans products.analysis.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'

const MODEL = MODELS.fast

type Channel = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'whatsapp'
const ROLE: Record<Channel, { role: string; mode: string }> = {
  linkedin: { role: 'outbound', mode: 'assisted' },
  x: { role: 'outbound', mode: 'assisted' },
  facebook: { role: 'inbound', mode: 'auto' },
  instagram: { role: 'inbound', mode: 'auto' },
  whatsapp: { role: 'closing', mode: 'auto' },
}

const SYSTEM_PROMPT = `Tu es le stratège commercial de « Numera Agentic », une plateforme de prospection.
À partir de la description d'un produit, tu détermines QUI prospecter, SUR QUELS RÉSEAUX et COMMENT.

Règles des canaux (non négociables, elles viennent des plateformes) :
- linkedin : prospection sortante, l'IA rédige et l'humain envoie (aucune automatisation). Idéal pour cibler par fonction/poste.
- x : prospection sortante, l'IA rédige et l'humain envoie. Pertinent surtout pour les audiences tech, médias, anglophones.
- facebook : IMPOSSIBLE d'écrire en premier. Uniquement entrant : publications, groupes, commentaires, messages reçus par la Page.
- instagram : IMPOSSIBLE d'écrire en premier. Uniquement entrant : contenu visuel, « commente INFO », réponses aux stories.
- whatsapp : canal de conclusion, jamais de prospection à froid. Utilisé seulement après un intérêt explicite et un numéro donné volontairement.

Méthode :
1. Déduis le type d'acheteur (entreprise ou particulier), le décideur réel, le budget et la durée du cycle d'achat.
2. Tiens compte des pays visés : usage réel des réseaux dans ces pays (ex. Facebook et WhatsApp dominants en Afrique francophone).
3. Note chaque canal de 0 à 100 selon la probabilité d'y trouver ET de convertir la cible. Justifie par des raisons concrètes, jamais génériques.
4. Propose 1 à 3 segments de cible, chacun avec ses problèmes (pains) que le produit résout.
5. Propose un ton, les langues de prospection, et 3 à 5 accroches d'ouverture qui ne ressemblent pas à une publicité.
6. Signale les risques (ex. produit réglementé, cible difficile à joindre, promesse à ne pas faire).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format :
{
  "summary": "2 phrases maximum",
  "segments": [{"name": "", "description": "", "pains": [""]}],
  "channels": [{"channel": "linkedin|x|facebook|instagram|whatsapp", "score": 0, "reasons": [""], "approach": "comment prospecter ce segment sur ce canal"}],
  "tone": "",
  "languages": ["fr"],
  "hooks": [""],
  "warnings": [""]
}
Les 5 canaux doivent tous apparaître dans "channels". Écris en français.
Sois concis : 2 ou 3 raisons de 15 mots maximum par canal, une approche de 2 phrases maximum.`

interface Product {
  id: string
  name: string
  description: string
  offer_type: string | null
  audience: string | null
  target: string | null
  countries: string[]
  price_level: string | null
}

Deno.serve(handler(async (req) => {
  const { jwt, orgId } = await requireUser(req)
  const { product_id } = await req.json()
  if (!product_id) throw new HttpError(400, 'product_id manquant')

  // Lecture avec le jeton de l'utilisateur : RLS garantit que le produit lui appartient.
  const [product] = await rest<Product[]>(`products?id=eq.${product_id}&select=*`, { jwt })
  if (!product) throw new HttpError(404, 'Produit introuvable')

  const parsed = await chatJSON({
    model: MODEL,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      nom: product.name,
      description: product.description,
      type_offre: product.offer_type,
      audience: product.audience,
      cible_decrite: product.target,
      pays: product.countries,
      niveau_prix: product.price_level,
    }),
    maxTokens: 4000,
    temperature: 0.3,
    orgId,
    feature: 'analyze_product',
  })

  // Garde-fou : rôle et mode imposés par les règles des plateformes.
  const channels = (Array.isArray(parsed.channels) ? parsed.channels : [])
    .filter((c: { channel: string }) => c.channel in ROLE)
    .map((c: { channel: Channel; score: number; reasons?: string[]; approach?: string }) => ({
      channel: c.channel,
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))),
      reasons: Array.isArray(c.reasons) ? c.reasons.slice(0, 4) : [],
      approach: String(c.approach ?? ''),
      ...ROLE[c.channel],
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)

  const analysis = {
    summary: String(parsed.summary ?? ''),
    segments: Array.isArray(parsed.segments) ? parsed.segments.slice(0, 3) : [],
    channels,
    tone: String(parsed.tone ?? ''),
    languages: Array.isArray(parsed.languages) ? parsed.languages : ['fr'],
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 5) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    source: 'ai',
    model: MODEL,
  }

  const [saved] = await rest(`products?id=eq.${product_id}`, {
    method: 'PATCH',
    jwt,
    body: { analysis, analyzed_at: new Date().toISOString() },
  }) as unknown[]
  return json(saved)
}))
