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
  knowledge?: string | null
  analysis: ProductAnalysis | null
  analyzed_at: string | null
}

export interface Conversation {
  id: string
  prospect_id: string
  channel: ChannelId
  prospect_name: string
  last_message_preview: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  unread_count: number
  ai_paused?: boolean
  ai_paused_reason?: string | null
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

export type ProspectStage =
  | 'new' | 'contacted' | 'replied' | 'interested' | 'whatsapp' | 'hot' | 'won' | 'lost' | 'ghosted'

export interface Prospect {
  id: string
  product_id: string | null
  full_name: string | null
  job_title: string | null
  company: string | null
  country: string | null
  language: string | null
  segment_label: string | null
  stage: ProspectStage
  fit_score: number | null
  fit_reasons: string[]
  best_channel: ChannelId | null
  profile_url: string | null
  source: string | null
  contacted_at: string | null
  created_at: string
  intent?: Intent | null
  intent_confidence?: number | null
  needs_review?: boolean
  archived_reason?: string | null
  do_not_contact?: boolean
  handoff_code?: string | null
}

export type OutreachProfile = 'new' | 'warming' | 'established'

export interface EntryLink {
  id: string
  product_id: string
  label: string
  code: string
  prefilled_text: string
  conversations: number
}

export interface KeywordTrigger {
  id: string
  product_id: string
  channel_account_id: string
  keywords: string[]
  reply_text: string
  active: boolean
  matches: number
}

export type DraftKind = 'invitation' | 'opening' | 'reply' | 'handoff'

export interface AiDraft {
  id: string
  kind: DraftKind
  channel: ChannelId
  language: string
  formality: 'tu' | 'vous'
  variants: { text: string; angle: string }[]
  sensitive: { is: boolean; topics: string[] }
  rationale: string
  source: 'ai' | 'demo'
}

export interface RelationalProfile {
  language: string | null
  formality: 'tu' | 'vous' | null
  tone: string | null
  style: { length?: string; emojis?: boolean; register?: string }
  interests: string[]
  pain_points: string[]
  objections: string[]
  preferences: string[]
  buying_signals: string[]
  summary: string | null
  version: number
  updated_at: string | null
}

export interface BrandVoice {
  sender_name?: string
  signature?: string
  formality?: 'tu' | 'vous'
  emojis?: boolean
  banned_phrases?: string[]
}

export type Intent = 'interested' | 'curious' | 'neutral' | 'not_now' | 'negative' | 'stop' | 'other'

export interface IntentOutcome {
  intent: Intent
  confidence: number
  evidence: string
  phone: string | null
  action: string
  draft?: AiDraft
  text?: string
}

export interface Automation {
  handoff_auto: boolean
  min_confidence: number
  autopilot_whatsapp: boolean
  autopilot_social: boolean
}

export interface Approval {
  id: string
  message_id: string
  conversation_id: string
  prospect_id: string
  prospect_name: string
  channel: ChannelId
  topics: string[]
  proposed_body: string
  expires_at: string | null
  created_at: string
  context: { from: 'prospect' | 'nous'; text: string }[]
}
