import { supabase } from './supabase'
import { analyzeWithRules } from './channelAdvisor'
import { qualifyWithRules, splitProfiles } from './prospectQualifier'
import { DAILY_LIMITS } from './outreach'
import type {
  AiDraft, Automation, BrandVoice, DraftKind, Intent, IntentOutcome, RelationalProfile,
  ChannelAccount, Conversation, EntryLink, KeywordTrigger, Message, OutreachProfile, Product, ProductInput,
  Prospect, ProspectStage,
} from './types'
import type { ChannelId } from '../data/channels'
import {
  demoAccounts, demoBrandVoice, demoConversations, demoEntryLinks, demoMessages, demoProducts, demoProfiles,
  demoProspects, demoTriggers,
} from '../data/demo'
import { demoDraft } from './demoWriter'
import { classifyWithRules } from './intentRules'
import { insertHandoffLink, whatsappLink } from '../../supabase/functions/_shared/prompts.ts'

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
  profiles: { ...demoProfiles },
  brandVoice: { ...demoBrandVoice },
  automation: { handoff_auto: true, min_confidence: 0.7 } as Automation,
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
  prospect_id: string
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
      .select('id, prospect_id, last_message_preview, last_message_at, last_inbound_at, unread_count, channel_accounts(channel), prospects(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .returns<ConversationRow[]>(),
  )
  return rows.map((r) => ({
    id: r.id,
    prospect_id: r.prospect_id,
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
  + 'fit_reasons, best_channel, profile_url, source, contacted_at, created_at, intent, intent_confidence, '
  + 'needs_review, archived_reason, do_not_contact, handoff_code'

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

// ---------- Cerveau IA (Partie 3) ----------

export async function getBrandVoice(): Promise<BrandVoice> {
  if (!supabase) return demo.brandVoice
  const { data } = await supabase.from('organizations').select('brand_voice').limit(1).single()
  return (data?.brand_voice ?? {}) as BrandVoice
}

export async function saveBrandVoice(voice: BrandVoice) {
  if (!supabase) {
    demo.brandVoice = voice
    return
  }
  unwrap(await supabase.from('organizations').update({ brand_voice: voice }).eq('id', await orgId()))
}

export async function saveProductKnowledge(productId: string, knowledge: string) {
  if (!supabase) {
    demo.products = demo.products.map((p) => (p.id === productId ? { ...p, knowledge } : p))
    return
  }
  unwrap(await supabase.from('products').update({ knowledge }).eq('id', productId))
}

export async function getProfile(prospectId: string): Promise<RelationalProfile | null> {
  if (!supabase) return demo.profiles[prospectId] ?? null
  const { data } = await supabase.from('prospect_profiles').select('*').eq('prospect_id', prospectId).maybeSingle()
  return (data as RelationalProfile | null) ?? null
}

export async function refreshProfile(conversationId: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.functions.invoke('update-profile', { body: { conversation_id: conversationId } })
  if (error) throw error
}

// Brouillons de messages : IA (Edge Function draft-message) ou modèles de démonstration.
export async function draftMessage(opts: {
  kind: DraftKind
  prospect: Prospect | { id: string; full_name: string | null; job_title?: string | null; company?: string | null; language?: string | null; product_id?: string | null; best_channel?: ChannelId | null }
  conversation?: Conversation
}): Promise<AiDraft> {
  const { kind, prospect, conversation } = opts
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('draft-message', {
      body: { prospect_id: prospect.id, kind, conversation_id: conversation?.id },
    })
    if (error) throw error
    return { ...(data as AiDraft), source: 'ai' }
  }
  const full = demo.prospects.find((p) => p.id === prospect.id)
  const product = demo.products.find((p) => p.id === (full?.product_id ?? prospect.product_id))
  return demoDraft({
    kind,
    channel: conversation?.channel ?? full?.best_channel ?? prospect.best_channel ?? 'linkedin',
    product,
    prospect: {
      full_name: full?.full_name ?? prospect.full_name, job_title: full?.job_title ?? prospect.job_title ?? null,
      company: full?.company ?? prospect.company ?? null, language: full?.language ?? prospect.language ?? null,
    },
    profile: demo.profiles[prospect.id] ?? null,
    messages: conversation ? demo.messages.filter((m) => m.conversation_id === conversation.id) : [],
  })
}

export async function markDraftUsed(draft: AiDraft, index: number) {
  if (!supabase || draft.source !== 'ai') return
  await supabase.from('ai_drafts').update({ chosen_index: index, used_at: new Date().toISOString() }).eq('id', draft.id)
}

// ---------- Détection d'intérêt & bascule WhatsApp (Partie 4) ----------

export async function getAutomation(): Promise<Automation> {
  if (!supabase) return demo.automation
  const { data } = await supabase.from('organizations').select('automation').limit(1).single()
  return { handoff_auto: true, min_confidence: 0.7, ...(data?.automation ?? {}) } as Automation
}

export async function saveAutomation(a: Automation) {
  if (!supabase) {
    demo.automation = a
    return
  }
  unwrap(await supabase.from('organizations').update({ automation: a }).eq('id', await orgId()))
}

// Miroir de set_prospect_intent (SQL) pour le mode démo.
function applyIntentDemo(prospectId: string, intent: Intent, confidence: number, phone: string | null): string {
  const p = demo.prospects.find((x) => x.id === prospectId)
  if (!p) return 'none'
  const early = ['new', 'contacted', 'replied'].includes(p.stage)
  const patch: Partial<Prospect> = { intent, intent_confidence: confidence, needs_review: false }
  let action = 'none'
  if (intent === 'stop' && confidence >= 0.5) {
    Object.assign(patch, { stage: 'lost', archived_reason: 'stop', do_not_contact: true })
    action = 'stop'
  } else if (confidence < demo.automation.min_confidence && intent !== 'curious' && intent !== 'other') {
    Object.assign(patch, { needs_review: true })
    action = 'review'
  } else if (p.do_not_contact) {
    action = 'none'
  } else if (intent === 'interested') {
    if (early) patch.stage = 'interested'
    if (phone) action = 'phone_received'
    else if (!p.handoff_code) {
      patch.handoff_code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')
      action = 'propose_handoff'
    }
  } else if (intent === 'curious') {
    if (p.stage === 'new' || p.stage === 'contacted') patch.stage = 'replied'
    action = 'reply'
  } else if (early && (intent === 'neutral' || intent === 'negative' || intent === 'not_now')) {
    Object.assign(patch, { stage: 'lost', archived_reason: intent })
    action = 'archive'
  }
  demo.prospects = demo.prospects.map((x) => (x.id === prospectId ? { ...x, ...patch } : x))
  return action
}

// Journal des messages LinkedIn / X (envoyés par l'utilisateur ou réponses collées).
export async function logAssistedMessage(prospectId: string, direction: 'inbound' | 'outbound', body: string): Promise<string> {
  if (!supabase) {
    if (direction === 'inbound') {
      demo.prospects = demo.prospects.map((p) =>
        p.id === prospectId && (p.stage === 'new' || p.stage === 'contacted') ? { ...p, stage: 'replied' } : p)
    }
    return crypto.randomUUID()
  }
  return unwrap(await supabase.rpc('log_assisted_message', {
    p_prospect: prospectId, p_direction: direction, p_body: body,
  })) as string
}

// L'utilisateur colle la réponse reçue sur LinkedIn / X : enregistrement + classification + action.
export async function analyzeAssistedReply(prospect: Prospect, text: string): Promise<IntentOutcome> {
  const messageId = await logAssistedMessage(prospect.id, 'inbound', text)
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('classify-message', { body: { message_id: messageId } })
    if (error) throw error
    return data as IntentOutcome
  }

  const r = classifyWithRules(text)
  const action = applyIntentDemo(prospect.id, r.intent, r.confidence, r.phone)
  if (action !== 'propose_handoff') return { ...r, action }

  const updated = demo.prospects.find((p) => p.id === prospect.id)!
  const wa = demo.accounts.find((a) => a.channel === 'whatsapp')
  if (!wa?.display_phone) return { ...r, action: 'handoff_no_whatsapp' }
  const product = demo.products.find((p) => p.id === updated.product_id)
  const link = whatsappLink(wa.display_phone, updated.handoff_code!, product?.name)
  const name = (updated.full_name ?? '').split(' ')[0]
  const draft: AiDraft = {
    id: crypto.randomUUID(), kind: 'handoff', channel: updated.best_channel ?? 'linkedin', language: 'fr',
    formality: 'vous', sensitive: { is: false, topics: [] }, source: 'demo',
    rationale: 'Brouillon de démonstration. Le lien contient un code personnel : sa conversation WhatsApp sera rattachée à son historique.',
    variants: [
      { angle: 'réponse + WhatsApp', text: insertHandoffLink(`Avec plaisir ${name} ! Pour vous envoyer tous les détails et vous répondre plus vite, écrivez-moi sur WhatsApp quand vous voulez : {{LIEN_WHATSAPP}}`, link) },
      { angle: 'rapide', text: insertHandoffLink(`Merci ${name} ! Le plus simple : un message sur WhatsApp et je vous envoie la présentation. {{LIEN_WHATSAPP}}`, link) },
    ],
  }
  return { ...r, action: 'handoff_draft', draft }
}

export async function resolveReview(prospectId: string, intent: Intent): Promise<string> {
  if (!supabase) return applyIntentDemo(prospectId, intent, 1, null)
  return unwrap(await supabase.rpc('resolve_review', { p_prospect: prospectId, p_intent: intent })) as string
}
