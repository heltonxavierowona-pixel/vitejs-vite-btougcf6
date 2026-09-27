import { supabase } from './supabase'
import { analyzeWithRules } from './channelAdvisor'
import { qualifyWithRules, splitProfiles } from './prospectQualifier'
import { DAILY_LIMITS } from './outreach'
import type {
  ChannelAccount, Conversation, EntryLink, KeywordTrigger, Message, OutreachProfile, Product, ProductInput,
  Prospect, ProspectStage,
} from './types'
import type { ChannelId } from '../data/channels'
import {
  demoAccounts, demoConversations, demoEntryLinks, demoMessages, demoProducts, demoProspects, demoTriggers,
} from '../data/demo'

// Couche de données unique : Supabase si configuré, sinon données de démo en mémoire.
export const isDemo = !supabase

const demo = {
  products: [...demoProducts],
  accounts: [...demoAccounts],
  conversations: [...demoConversations],
  messages: [...demoMessages],
  prospects: [...demoProspects],
  entryLinks: [...demoEntryLinks],
  triggers: [...demoTriggers],
  outreachProfile: 'new' as OutreachProfile,
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

export const WINDOW_MS = 24 * 60 * 60 * 1000
export const windowOpen = (c: Pick<Conversation, 'last_inbound_at'>) =>
  !!c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < WINDOW_MS

async function orgId(): Promise<string> {
  const { data } = await supabase!.from('organization_members').select('organization_id').limit(1).single()
  if (!data) throw new Error('Organisation introuvable')
  return data.organization_id
}

// ---------- Produits ----------

export async function listProducts(): Promise<Product[]> {
  if (!supabase) return demo.products
  return unwrap(await supabase.from('products').select('*').order('created_at', { ascending: false }))
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (!supabase) {
    const p: Product = { ...input, id: crypto.randomUUID(), analysis: null, analyzed_at: null }
    demo.products = [p, ...demo.products]
    return p
  }
  return unwrap(
    await supabase.from('products').insert({ ...input, organization_id: await orgId() }).select().single(),
  )
}

// Analyse IA (Edge Function). En démo, ou si l'IA échoue, analyse par règles.
export async function analyzeProduct(product: Product): Promise<Product> {
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('analyze-product', { body: { product_id: product.id } })
    if (!error && data) return data as Product
    console.warn('Analyse IA indisponible, repli sur les règles', error)
  }
  const updated = { ...product, analysis: analyzeWithRules(product), analyzed_at: new Date().toISOString() }
  if (supabase) {
    await supabase.from('products').update({ analysis: updated.analysis, analyzed_at: updated.analyzed_at }).eq('id', product.id)
  } else {
    demo.products = demo.products.map((p) => (p.id === product.id ? updated : p))
  }
  return updated
}

// ---------- Canaux connectés ----------

export async function listAccounts(): Promise<ChannelAccount[]> {
  if (!supabase) return demo.accounts
  return unwrap(
    await supabase.from('channel_accounts').select('id, channel, label, display_phone, status, coexistence'),
  )
}

export async function connectWhatsApp(payload: {
  code: string
  waba_id: string
  phone_number_id: string
  business_id?: string
  coexistence: boolean
}) {
  if (!supabase) throw new Error('Mode démo : configurez Supabase pour connecter un vrai numéro')
  const { data, error } = await supabase.functions.invoke('whatsapp-connect', { body: payload })
  if (error) throw error
  return data
}

export async function connectMeta(code: string) {
  if (!supabase) throw new Error('Mode démo : configurez Supabase pour connecter une Page')
  const { data, error } = await supabase.functions.invoke('meta-connect', { body: { code } })
  if (error) throw error
  return data
}

// ---------- Boîte de réception ----------

interface ConversationRow {
  id: string
  last_message_preview: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  unread_count: number
  channel_accounts: { channel: Conversation['channel'] } | null
  prospects: { full_name: string | null } | null
}

export async function listConversations(): Promise<Conversation[]> {
  if (!supabase) {
    return [...demo.conversations].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
  }
  const rows = unwrap(
    await supabase
      .from('conversations')
      .select('id, last_message_preview, last_message_at, last_inbound_at, unread_count, channel_accounts(channel), prospects(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .returns<ConversationRow[]>(),
  )
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel_accounts?.channel ?? 'whatsapp',
    prospect_name: r.prospects?.full_name ?? 'Contact',
    last_message_preview: r.last_message_preview,
    last_message_at: r.last_message_at,
    last_inbound_at: r.last_inbound_at,
    unread_count: r.unread_count,
  }))
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  if (!supabase) return demo.messages.filter((m) => m.conversation_id === conversationId)
  return unwrap(
    await supabase
      .from('messages')
      .select('id, conversation_id, direction, status, body, ai_generated, sent_at')
      .eq('conversation_id', conversationId)
      .order('sent_at'),
  )
}

export async function markRead(conversationId: string) {
  if (!supabase) {
    demo.conversations = demo.conversations.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
    return
  }
  await supabase.rpc('mark_conversation_read', { p_conversation: conversationId })
}

// L'utilisateur répond depuis la plateforme ; n8n transmet sur le canal du client.
export async function sendMessage(conversationId: string, body: string): Promise<void> {
  if (!supabase) {
    const msg: Message = {
      id: crypto.randomUUID(), conversation_id: conversationId, direction: 'outbound',
      status: 'sent', body, ai_generated: false, sent_at: new Date().toISOString(),
    }
    demo.messages = [...demo.messages, msg]
    demo.conversations = demo.conversations.map((c) =>
      c.id === conversationId ? { ...c, last_message_preview: body, last_message_at: msg.sent_at } : c)
    return
  }
  unwrap(await supabase.rpc('send_from_inbox', { p_conversation: conversationId, p_body: body }))
}

// Temps réel : rappelle `onChange` à chaque nouveau message ou changement de statut.
export function subscribeInbox(onChange: () => void): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    .channel('inbox')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, onChange)
    .subscribe()
  return () => {
    client.removeChannel(channel)
  }
}

// ---------- Prospects & sourcing ----------

const PROSPECT_FIELDS =
  'id, product_id, full_name, job_title, company, country, language, segment_label, stage, fit_score, '
  + 'fit_reasons, best_channel, profile_url, source, contacted_at, created_at'

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString()

export async function listProspects(productId: string): Promise<Prospect[]> {
  if (!supabase) return demo.prospects.filter((p) => p.product_id === productId)
  return unwrap(
    await supabase.from('prospects').select(PROSPECT_FIELDS).eq('product_id', productId)
      .is('deleted_at', null).order('fit_score', { ascending: false, nullsFirst: false })
      .returns<Prospect[]>(),
  )
}

export async function getOutreachProfile(): Promise<OutreachProfile> {
  if (!supabase) return demo.outreachProfile
  const { data } = await supabase.from('organizations').select('outreach_profile').limit(1).single()
  return (data?.outreach_profile ?? 'new') as OutreachProfile
}

export async function setOutreachProfile(profile: OutreachProfile) {
  if (!supabase) {
    demo.outreachProfile = profile
    return
  }
  unwrap(await supabase.from('organizations').update({ outreach_profile: profile }).eq('id', await orgId()))
}

// File du jour : meilleurs prospects « à contacter », dans la limite du rythme autorisé.
export async function outreachQueue(productId: string, channel: ChannelId): Promise<{ queue: Prospect[]; limit: number; doneToday: number }> {
  const profile = await getOutreachProfile()
  const limit = DAILY_LIMITS[profile][channel] ?? 0
  if (!supabase) {
    const doneToday = demo.prospects.filter((p) => p.best_channel === channel && isToday(p.contacted_at)).length
    const queue = demo.prospects
      .filter((p) => p.product_id === productId && p.best_channel === channel && p.stage === 'new')
      .sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1))
      .slice(0, Math.max(0, limit - doneToday))
    return { queue, limit, doneToday }
  }
  const queue = unwrap(await supabase.rpc('outreach_queue', { p_product: productId, p_channel: channel })) as Prospect[]
  const { count } = await supabase.from('prospects').select('id', { count: 'exact', head: true })
    .eq('best_channel', channel).gte('contacted_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
  return { queue, limit, doneToday: count ?? 0 }
}

export async function markContacted(prospectId: string) {
  const patch = { stage: 'contacted' as ProspectStage, contacted_at: new Date().toISOString() }
  if (!supabase) {
    demo.prospects = demo.prospects.map((p) => (p.id === prospectId ? { ...p, ...patch } : p))
    return
  }
  unwrap(await supabase.from('prospects').update(patch).eq('id', prospectId))
}

export async function setStage(prospectId: string, stage: ProspectStage) {
  if (!supabase) {
    demo.prospects = demo.prospects.map((p) => (p.id === prospectId ? { ...p, stage } : p))
    return
  }
  unwrap(await supabase.from('prospects').update({ stage }).eq('id', prospectId))
}

// Import de profils collés (LinkedIn / X) + qualification IA, avec repli par règles.
export async function importProspects(
  product: Product,
  channel: 'linkedin' | 'x',
  raw: string,
): Promise<{ added: number; skipped: number; source: 'ai' | 'rules' }> {
  const items = splitProfiles(raw)
  if (!items.length) throw new Error('Aucun profil détecté')
  if (items.length > 20) throw new Error('20 profils maximum par import')

  if (supabase) {
    const { data, error } = await supabase.functions.invoke('qualify-prospects', {
      body: { product_id: product.id, channel, items },
    })
    if (!error && data) return { added: data.inserted.length, skipped: data.skipped, source: 'ai' }
    console.warn('Qualification IA indisponible, repli sur les règles', error)
  }

  const known = new Set((supabase ? await listProspects(product.id) : demo.prospects).map((p) => p.profile_url))
  const fresh = items.filter((i) => !i.profile_url || !known.has(i.profile_url))
  const rows: Prospect[] = fresh.map((item) => ({
    ...qualifyWithRules(product, item),
    id: crypto.randomUUID(),
    product_id: product.id,
    best_channel: channel,
    stage: 'new',
    source: `import_${channel}`,
    contacted_at: null,
    created_at: new Date().toISOString(),
  }))

  if (supabase) {
    const org = await orgId()
    unwrap(await supabase.from('prospects').insert(rows.map((r, n) => ({
      organization_id: org,
      product_id: r.product_id, full_name: r.full_name, job_title: r.job_title, company: r.company,
      language: r.language, segment_label: r.segment_label, fit_score: r.fit_score, fit_reasons: r.fit_reasons,
      profile_url: r.profile_url, profile_text: fresh[n].text, best_channel: r.best_channel, source: r.source,
      stage: r.stage, qualified_at: new Date().toISOString(),
    }))))
  } else {
    demo.prospects = [...rows, ...demo.prospects]
  }
  return { added: rows.length, skipped: items.length - fresh.length, source: 'rules' }
}

export async function listEntryLinks(productId: string): Promise<EntryLink[]> {
  if (!supabase) return demo.entryLinks.filter((l) => l.product_id === productId)
  return unwrap(await supabase.from('entry_links').select('*').eq('product_id', productId).order('created_at'))
}

export async function createEntryLink(product: Product, label: string): Promise<EntryLink> {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')
  const link = {
    product_id: product.id,
    label,
    code,
    prefilled_text: `Bonjour, je souhaite en savoir plus sur ${product.name} (réf. ${code})`,
  }
  if (!supabase) {
    const created = { ...link, id: crypto.randomUUID(), conversations: 0 }
    demo.entryLinks = [...demo.entryLinks, created]
    return created
  }
  return unwrap(await supabase.from('entry_links').insert({ ...link, organization_id: await orgId() }).select().single())
}

export async function listTriggers(productId: string): Promise<KeywordTrigger[]> {
  if (!supabase) return demo.triggers.filter((t) => t.product_id === productId)
  return unwrap(await supabase.from('keyword_triggers').select('*').eq('product_id', productId).order('created_at'))
}

export async function createTrigger(t: Pick<KeywordTrigger, 'product_id' | 'channel_account_id' | 'keywords' | 'reply_text'>): Promise<KeywordTrigger> {
  if (!supabase) {
    const created = { ...t, id: crypto.randomUUID(), active: true, matches: 0 }
    demo.triggers = [...demo.triggers, created]
    return created
  }
  return unwrap(await supabase.from('keyword_triggers').insert({ ...t, organization_id: await orgId() }).select().single())
}

export async function toggleTrigger(id: string, active: boolean) {
  if (!supabase) {
    demo.triggers = demo.triggers.map((t) => (t.id === id ? { ...t, active } : t))
    return
  }
  unwrap(await supabase.from('keyword_triggers').update({ active }).eq('id', id))
}
