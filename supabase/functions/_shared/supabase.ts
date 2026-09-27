// Aides communes aux Edge Functions (Deno). Aucune dépendance externe :
// on parle directement à l'API REST de Supabase et au Graph API de Meta.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const GRAPH = `https://graph.facebook.com/${Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0'}`

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-closer-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// `jwt` = requête au nom de l'utilisateur (RLS appliquée) ;
// sans jwt = clé service_role (réservé à l'écriture des tokens).
export async function rest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; jwt?: string; prefer?: string } = {},
): Promise<T> {
  const key = init.jwt ? ANON_KEY : SERVICE_KEY
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${init.jwt ?? SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.prefer ?? 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  if (!res.ok) throw new HttpError(res.status, `Supabase ${path}: ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

// Identifie l'utilisateur connecté et son organisation.
export async function requireUser(req: Request): Promise<{ jwt: string; userId: string; orgId: string }> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) throw new HttpError(401, 'Non connecté')

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) throw new HttpError(401, 'Session invalide')
  const user = (await res.json()) as { id: string }

  const members = await rest<{ organization_id: string }[]>(
    `organization_members?select=organization_id&user_id=eq.${user.id}&limit=1`,
    { jwt },
  )
  if (!members.length) throw new HttpError(403, 'Aucune organisation')
  return { jwt, userId: user.id, orgId: members[0].organization_id }
}

export async function graph<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; token: string; body?: unknown } ,
): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = await res.json()
  if (!res.ok) throw new HttpError(502, `Meta ${path}: ${JSON.stringify(data.error ?? data)}`)
  return data as T
}

// Enveloppe standard : CORS, erreurs → JSON.
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    try {
      return await fn(req)
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      console.error(e)
      return json({ error: e instanceof Error ? e.message : String(e) }, status)
    }
  }
}

// Appel serveur à serveur (n8n) : secret partagé dans l'en-tête x-closer-secret.
export function isServiceCall(req: Request): boolean {
  const secret = Deno.env.get('CLOSER_WEBHOOK_SECRET')
  return !!secret && req.headers.get('x-closer-secret') === secret
}
