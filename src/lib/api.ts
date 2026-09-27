import { supabase } from './supabase'
import { analyzeWithRules } from './channelAdvisor'
import { qualifyWithRules, splitProfiles } from './prospectQualifier'
import { DAILY_LIMITS } from './outreach'
import type {
  AiDraft, Approval, Automation, BrandVoice, ClosingStep, ProductClosing, WhatsAppTemplate, DraftKind, Intent, IntentOutcome, RelationalProfile,
  ChannelAccount, Conversation, EntryLink, KeywordTrigger, Message, OutreachProfile, Product, ProductInput,
  Prospect, ProspectStage,
} from './types'
import type { ChannelId } from '../data/channels'
import {
  demoAccounts, demoBrandVoice, demoConversations, demoEntryLinks, demoMessages, demoProducts, demoProfiles,
  demoProspects, demoTriggers, demoApprovals, demoTemplates,
} from '../data/demo'
import { demoDraft } from './demoWriter'
import { classifyWithRules } from './intentRules'
import { callText, presentationText } from './closing'
import { detectSensitive, insertHandoffLink, MEDIA_PLACEHOLDER, whatsappLink } from '../../supabase/functions/_shared/prompts.ts'

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
  automation: {
    handoff_auto: true, min_confidence: 0.7, autopilot_whatsapp: true, autopilot_social: false,
    followups_enabled: true, followup_delays: [2, 5],
  } as Automation,
  templates: [...demoTemplates],
  approvals: [...demoApprovals],
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
  ai_paused: boolean
  ai_paused_reason: string | null
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
      .select('id, prospect_id, ai_paused, ai_paused_reason, last_message_preview, last_message_at, last_inbound_at, unread_count, channel_accounts(channel), prospects(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .returns<ConversationRow[]>(),
  )
  return rows.map((r) => ({
    id: r.id,
    prospect_id: r.prospect_id,
    ai_paused: r.ai_paused,
    ai_paused_reason: r.ai_paused_reason,
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
      c.id === conversationId
        ? { ...c, last_message_preview: body, last_message_at: msg.sent_at, ai_paused: true, ai_paused_reason: 'human_reply' }
        : c)
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
  + 'needs_review, archived_reason, do_not_contact, handoff_code, closing_step, followups_sent, next_followup_at, '
  + 'followup_due, last_followup_at'

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
  return {
    handoff_auto: true, min_confidence: 0.7, autopilot_whatsapp: true, autopilot_social: false,
    followups_enabled: true, followup_delays: [2, 5], ...(data?.automation ?? {}),
  } as Automation
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

// ---------- Pilote automatique & validations (Partie 5) ----------

// Signal local pour rafraîchir le badge « Validations » sans attendre.
export const APPROVALS_CHANGED = 'closer:approvals-changed'
const notifyApprovals = () => window.dispatchEvent(new Event(APPROVALS_CHANGED))

export async function setAiPaused(conversationId: string, paused: boolean) {
  const patch = { ai_paused: paused, ai_paused_reason: paused ? 'manual' : null }
  if (!supabase) {
    demo.conversations = demo.conversations.map((c) => (c.id === conversationId ? { ...c, ...patch } : c))
    return
  }
  unwrap(await supabase.from('conversations')
    .update({ ...patch, ai_paused_at: paused ? new Date().toISOString() : null }).eq('id', conversationId))
}

interface ApprovalRow {
  id: string; message_id: string; conversation_id: string; prospect_id: string; topics: string[]
  proposed_body: string; expires_at: string | null; created_at: string
  prospects: { full_name: string | null } | null
  conversations: { channel_accounts: { channel: ChannelId } | null } | null
}

export async function listApprovals(): Promise<Approval[]> {
  if (!supabase) return demo.approvals
  const rows = unwrap(await supabase.from('approvals')
    .select('id, message_id, conversation_id, prospect_id, topics, proposed_body, expires_at, created_at, prospects(full_name), conversations(channel_accounts(channel))')
    .is('decision', null).order('created_at').returns<ApprovalRow[]>())
  return Promise.all(rows.map(async (r) => {
    const { data } = await supabase!.from('messages').select('direction, body')
      .eq('conversation_id', r.conversation_id).eq('direction', 'inbound').order('sent_at', { ascending: false }).limit(3)
    return {
      id: r.id, message_id: r.message_id, conversation_id: r.conversation_id, prospect_id: r.prospect_id,
      prospect_name: r.prospects?.full_name ?? 'Contact', channel: r.conversations?.channel_accounts?.channel ?? 'whatsapp',
      topics: r.topics, proposed_body: r.proposed_body, expires_at: r.expires_at, created_at: r.created_at,
      context: (data ?? []).reverse().map((m) => ({ from: 'prospect' as const, text: m.body })),
    }
  }))
}

export async function countPendingApprovals(): Promise<number> {
  if (!supabase) return demo.approvals.length
  const { count } = await supabase.from('approvals').select('id', { count: 'exact', head: true }).is('decision', null)
  return count ?? 0
}

export async function decideApproval(id: string, decision: 'approve' | 'edit' | 'reject', body?: string) {
  try {
    await decideApprovalInner(id, decision, body)
  } finally {
    notifyApprovals()
  }
}

async function decideApprovalInner(id: string, decision: 'approve' | 'edit' | 'reject', body?: string) {
  if (!supabase) {
    const ap = demo.approvals.find((a) => a.id === id)
    if (!ap) return
    demo.approvals = demo.approvals.filter((a) => a.id !== id)
    demo.messages = demo.messages.map((m) => m.id !== ap.message_id ? m : {
      ...m,
      status: decision === 'reject' ? 'rejected' : 'sent',
      body: decision === 'edit' && body?.trim() ? body.trim() : m.body,
    })
    if (decision !== 'reject') {
      const msg = demo.messages.find((m) => m.id === ap.message_id)!
      demo.conversations = demo.conversations.map((c) => c.id === ap.conversation_id
        ? { ...c, last_message_preview: msg.body, last_message_at: new Date().toISOString() } : c)
    }
    return
  }
  unwrap(await supabase.rpc('decide_approval', { p_approval: id, p_decision: decision, p_body: body ?? null }))
}

export async function listMergeCandidates(excludeId: string): Promise<{ id: string; full_name: string | null; source: string | null }[]> {
  if (!supabase) return demo.prospects.filter((p) => p.id !== excludeId).map((p) => ({ id: p.id, full_name: p.full_name, source: p.source }))
  return unwrap(await supabase.from('prospects').select('id, full_name, source').neq('id', excludeId)
    .is('deleted_at', null).order('created_at', { ascending: false }).limit(200))
}

export async function mergeProspects(keepId: string, mergeId: string) {
  if (!supabase) {
    demo.conversations = demo.conversations.map((c) => (c.prospect_id === mergeId ? { ...c, prospect_id: keepId } : c))
    demo.prospects = demo.prospects.filter((p) => p.id !== mergeId)
    return
  }
  unwrap(await supabase.rpc('merge_prospects', { p_keep: keepId, p_merge: mergeId }))
}

// Mode démo uniquement : simule un message du client pour voir le pilote automatique agir.
export async function simulateClientMessage(conversationId: string, text: string): Promise<string> {
  const conv = demo.conversations.find((c) => c.id === conversationId)
  if (!conv) return 'none'
  const now = new Date().toISOString()
  demo.messages = [...demo.messages, {
    id: crypto.randomUUID(), conversation_id: conversationId, direction: 'inbound', status: 'received',
    ai_generated: false, sent_at: now, body: text,
  }]
  demo.conversations = demo.conversations.map((c) => c.id === conversationId
    ? { ...c, last_inbound_at: now, last_message_at: now, last_message_preview: text } : c)

  const enabled = conv.channel === 'whatsapp' ? demo.automation.autopilot_whatsapp
    : (conv.channel === 'facebook' || conv.channel === 'instagram') && demo.automation.autopilot_social
  if (!enabled || conv.ai_paused) return 'skipped'

  const pause = (reason: string) => {
    demo.conversations = demo.conversations.map((c) => c.id === conversationId
      ? { ...c, ai_paused: true, ai_paused_reason: `escalation:${reason}` } : c)
    return 'escalated'
  }
  if (MEDIA_PLACEHOLDER.test(text.trim())) return pause('message non textuel (vocal, image…)')
  if (/(humain|quelqu'un|conseill|responsable|real person|someone|pas content|arnaque|remboursez)/i.test(text)) {
    return pause('demande à parler à un humain ou mécontentement')
  }

  const draft = await draftMessage({ kind: 'reply', prospect: { id: conv.prospect_id, full_name: conv.prospect_name }, conversation: conv })
  let body = draft.variants[0].text

  // Closing (miroir de closing_next_action) : présentation, puis appel après sa réponse.
  const pr = demo.prospects.find((p) => p.id === conv.prospect_id)
  const product = demo.products.find((p) => p.id === pr?.product_id)
  let step: ClosingStep | null = null
  if (pr && product && conv.channel === 'whatsapp' && ['interested', 'whatsapp', 'hot'].includes(pr.stage)) {
    const pres = presentationText(product)
    if (!pr.closing_step && pres) { body = `${body}\n${pres}`; step = 'presentation_sent' }
    else if (!pr.closing_step || pr.closing_step === 'presentation_sent') { body = `${body}\n${callText(product)}`; step = 'call_proposed' }
  }
  const topics = [...new Set([...draft.sensitive.topics, ...detectSensitive(body), ...detectSensitive(text)])]
  const reply = {
    id: crypto.randomUUID(), conversation_id: conversationId, direction: 'outbound' as const,
    status: topics.length ? 'pending_approval' : 'sent', ai_generated: true,
    sent_at: new Date(Date.now() + 1000).toISOString(), body,
  }
  demo.messages = [...demo.messages, reply]
  if (topics.length) {
    demo.approvals = [...demo.approvals, {
      id: crypto.randomUUID(), message_id: reply.id, conversation_id: conversationId, prospect_id: conv.prospect_id,
      prospect_name: conv.prospect_name, channel: conv.channel, topics, proposed_body: body, created_at: reply.sent_at,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(), context: [{ from: 'prospect', text }],
    }]
    notifyApprovals()
    if (step) await recordClosingStep(conv.prospect_id, step)
    return 'pending_approval'
  }
  if (step) await recordClosingStep(conv.prospect_id, step)
  demo.conversations = demo.conversations.map((c) => c.id === conversationId
    ? { ...c, last_message_preview: body, last_message_at: reply.sent_at } : c)
  return 'sent'
}

// ---------- Closing & relances (Partie 6) ----------

export async function saveProductClosing(productId: string, closing: ProductClosing) {
  if (!supabase) {
    demo.products = demo.products.map((p) => (p.id === productId ? { ...p, closing } : p))
    return
  }
  unwrap(await supabase.from('products').update({ closing }).eq('id', productId))
}

export async function getProspect(id: string): Promise<Prospect | null> {
  if (!supabase) return demo.prospects.find((p) => p.id === id) ?? null
  const { data } = await supabase.from('prospects').select(PROSPECT_FIELDS).eq('id', id).maybeSingle()
  return (data as Prospect | null) ?? null
}

export async function getProduct(id: string | null): Promise<Product | null> {
  if (!id) return null
  if (!supabase) return demo.products.find((p) => p.id === id) ?? null
  const { data } = await supabase.from('products').select('*').eq('id', id).maybeSingle()
  return (data as Product | null) ?? null
}

export async function recordClosingStep(prospectId: string, step: ClosingStep) {
  if (!supabase) {
    demo.prospects = demo.prospects.map((p) => p.id !== prospectId ? p : {
      ...p, closing_step: step,
      stage: ['interested', 'whatsapp', 'replied', 'contacted'].includes(p.stage) ? 'hot' : p.stage,
      next_followup_at: step === 'call_booked' ? null : p.next_followup_at,
    })
    return
  }
  unwrap(await supabase.rpc('record_closing_step', { p_prospect: prospectId, p_step: step }))
}

export async function setOutcome(prospectId: string, outcome: 'won' | 'lost') {
  const patch = {
    stage: outcome, next_followup_at: null, followup_due: false,
    ...(outcome === 'lost' ? { archived_reason: 'manual', archived_at: new Date().toISOString() } : {}),
  }
  if (!supabase) {
    demo.prospects = demo.prospects.map((p) => (p.id === prospectId ? { ...p, ...patch } as Prospect : p))
    return
  }
  unwrap(await supabase.from('prospects').update(patch).eq('id', prospectId))
}

// Relance faite à la main (LinkedIn/X, Messenger/Instagram, ou modèle WhatsApp manquant).
export async function markFollowedUp(prospect: Prospect, text?: string) {
  if (text && (prospect.best_channel === 'linkedin' || prospect.best_channel === 'x')) {
    await logAssistedMessage(prospect.id, 'outbound', text)
  }
  if (!supabase) {
    demo.prospects = demo.prospects.map((p) => (p.id === prospect.id ? { ...p, followup_due: false } : p))
    return
  }
  unwrap(await supabase.from('prospects').update({ followup_due: false }).eq('id', prospect.id))
}

export async function listTemplates(): Promise<WhatsAppTemplate[]> {
  if (!supabase) return demo.templates
  return unwrap(await supabase.from('whatsapp_templates').select('*').order('purpose').order('language'))
}

export async function manageTemplates(action: 'create_defaults' | 'sync'): Promise<WhatsAppTemplate[]> {
  if (!supabase) {
    if (action === 'sync') demo.templates = demo.templates.map((t) => ({ ...t, status: 'APPROVED' }))
    return demo.templates
  }
  const { data, error } = await supabase.functions.invoke('whatsapp-templates', { body: { action } })
  if (error) throw error
  return data as WhatsAppTemplate[]
}

// Mode démo : fait avancer le temps pour voir les relances et l'abandon s'appliquer.
export function advanceDemoTime(days: number): { sent: number; tasks: number; abandoned: number } {
  const now = Date.now() + days * 86_400_000
  const [, delay2] = demo.automation.followup_delays
  const result = { sent: 0, tasks: 0, abandoned: 0 }
  demo.prospects = demo.prospects.map((p) => {
    if (!p.next_followup_at || new Date(p.next_followup_at).getTime() > now) return p
    if (!['interested', 'whatsapp', 'hot'].includes(p.stage) || p.do_not_contact) return p
    const sentCount = p.followups_sent ?? 0
    if (sentCount >= 2) {
      result.abandoned++
      return { ...p, stage: 'ghosted', archived_reason: 'ghosted', next_followup_at: null, followup_due: false }
    }
    const onWhatsApp = demo.conversations.some((c) => c.prospect_id === p.id && c.channel === 'whatsapp')
    const tpl = demo.templates.find((t) => t.purpose === `followup_${sentCount + 1}` && t.status === 'APPROVED')
    if (onWhatsApp && tpl) result.sent++
    else result.tasks++
    return {
      ...p, followups_sent: sentCount + 1, last_followup_at: new Date(now).toISOString(),
      followup_due: !(onWhatsApp && tpl), next_followup_at: new Date(now + delay2 * 86_400_000).toISOString(),
    }
  })
  return result
}
