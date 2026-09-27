import { supabase } from './supabase'
import { analyzeWithRules } from './channelAdvisor'
import type { ChannelAccount, Conversation, Message, Product, ProductInput } from './types'
import { demoAccounts, demoConversations, demoMessages, demoProducts } from '../data/demo'

// Couche de données unique : Supabase si configuré, sinon données de démo en mémoire.
export const isDemo = !supabase

const demo = {
  products: [...demoProducts],
  accounts: [...demoAccounts],
  conversations: [...demoConversations],
  messages: [...demoMessages],
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

export const WINDOW_MS = 24 * 60 * 60 * 1000
export const windowOpen = (c: Pick<Conversation, 'last_inbound_at'>) =>
  !!c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < WINDOW_MS

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
  const { data: member } = await supabase.from('organization_members').select('organization_id').limit(1).single()
  return unwrap(
    await supabase.from('products').insert({ ...input, organization_id: member?.organization_id }).select().single(),
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
