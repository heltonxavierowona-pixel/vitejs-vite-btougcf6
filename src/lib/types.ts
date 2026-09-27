import type { ChannelId, ChannelMode } from '../data/channels'

export type Audience = 'b2b' | 'b2c' | 'mixte'
export type OfferType = 'saas' | 'service' | 'physique' | 'formation' | 'autre'
export type PriceLevel = 'bas' | 'moyen' | 'eleve'

export interface ProductInput {
  name: string
  description: string
  offer_type: OfferType
  audience: Audience
  target: string
  countries: string[]
  price_level: PriceLevel
}

export interface ChannelRecommendation {
  channel: ChannelId
  score: number // 0–100
  role: 'outbound' | 'inbound' | 'closing'
  mode: ChannelMode
  reasons: string[]
  approach: string
}

export interface ProductAnalysis {
  summary: string
  segments: { name: string; description: string; pains: string[] }[]
  channels: ChannelRecommendation[]
  tone: string
  languages: string[]
  hooks: string[]
  warnings: string[]
  source: 'ai' | 'rules'
}

export interface Product extends ProductInput {
  id: string
  analysis: ProductAnalysis | null
  analyzed_at: string | null
}

export interface Conversation {
  id: string
  channel: ChannelId
  prospect_name: string
  last_message_preview: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  unread_count: number
}

export interface Message {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  status: string
  body: string
  ai_generated: boolean
  sent_at: string
}

export interface ChannelAccount {
  id: string
  channel: ChannelId
  label: string
  display_phone: string | null
  status: string
  coexistence: boolean
}
