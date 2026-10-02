// POST { product_id, channels?: ('facebook'|'instagram')[], count?: 1..3, brief? }
// L'IA rédige des publications prêtes à publier pour un produit ; enregistrées en brouillon
// dans posts (image du produit par défaut). Déploiement : verify_jwt = true.
import { handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { chatJSON, MODELS } from '../_shared/llm.ts'
import { type AiContext, buildPostsSystem, buildPostsUser, normalizePosts } from '../_shared/prompts.ts'

interface Product {
  id: string; name: string; description: string; target: string | null; knowledge: string | null
  image_url: string | null; analysis: { tone?: string; hooks?: string[]; segments?: [] } | null
}

Deno.serve(handler(async (req) => {
  const { jwt, orgId, userId } = await requireUser(req)
  const { product_id, channels: wanted, count, brief } = (await req.json()) as {
    product_id?: string; channels?: string[]; count?: number; brief?: string
  }
  if (!product_id) throw new HttpError(400, 'product_id manquant')
  const channels = (wanted?.length ? wanted : ['facebook', 'instagram'])
    .filter((c): c is 'facebook' | 'instagram' => c === 'facebook' || c === 'instagram')
  if (!channels.length) throw new HttpError(400, 'Choisissez Facebook et/ou Instagram')
  const n = Math.max(1, Math.min(3, Math.round(Number(count) || 2)))

  // Lecture avec le jeton de l'utilisateur : RLS garantit que le produit lui appartient.
  const [p] = await rest<Product[]>(
    `products?id=eq.${product_id}&select=id,name,description,target,knowledge,image_url,analysis`, { jwt },
  )
  if (!p) throw new HttpError(404, 'Produit introuvable')
  const [org] = await rest<{ brand_voice: AiContext['brand_voice'] }[]>(`organizations?id=eq.${orgId}&select=brand_voice`, { jwt })

  const ctx: Pick<AiContext, 'brand_voice' | 'product'> = {
    brand_voice: org?.brand_voice ?? {},
    product: {
      name: p.name, description: p.description, target: p.target,
      knowledge: p.knowledge?.trim() || p.description,
      tone: p.analysis?.tone ?? null, hooks: p.analysis?.hooks ?? null, segments: p.analysis?.segments ?? null,
    },
  }
  const raw = await chatJSON({
    model: MODELS.write,
    system: buildPostsSystem(ctx, channels, n),
    user: buildPostsUser(ctx, brief?.slice(0, 500)),
    maxTokens: 3000,
    temperature: 0.8,
    orgId,
    feature: 'generate_posts',
  })
  const drafts = normalizePosts(raw, channels)
  if (!drafts.length) throw new HttpError(502, 'L\'IA n\'a proposé aucune publication, réessayez')

  const saved = await rest('posts', {
    method: 'POST',
    jwt,
    body: drafts.map((d) => ({
      organization_id: orgId, product_id: p.id, channel: d.channel, status: 'draft', source: 'ai',
      body: d.body, image_url: p.image_url, image_idea: d.image_idea || null, created_by: userId,
    })),
  })
  return json(saved)
}))
