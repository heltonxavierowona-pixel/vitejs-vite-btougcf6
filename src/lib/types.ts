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

export interface ProductClosing {
  presentation_url?: string
  presentation_label?: string
  booking_url?: string
  call_minutes?: number
}

export interface Product extends ProductInput {
  id: string
  knowledge?: string | null
  closing?: ProductClosing
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
  closing_step?: ClosingStep | null
  followups_sent?: number
  next_followup_at?: string | null
  followup_due?: boolean
  last_followup_at?: string | null
}

export type ClosingStep = 'presentation_sent' | 'call_proposed' | 'call_booked'

export interface WhatsAppTemplate {
  id: string
  purpose: 'followup_1' | 'followup_2'
  name: string
  language: string
  body: string
  status: string
  rejected_reason: string | null
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

export type DraftKind = 'invitation' | 'opening' | 'reply' | 'handoff' | 'followup'

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
  followups_enabled: boolean
  followup_delays: [number, number]
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

export interface DashboardStats {
  days: number
  kpis: {
    prospects: number
    contacted: number
    replied: number
    hot_now: number
    calls_booked: number
    won: number
    pending_approvals: number
    ai_cost_usd: number
    templates_sent: number
    ai_replies: number
  }
  funnel: { stage: string; n: number }[]
  by_channel: { channel: ChannelId; prospects: number; hot: number }[]
  daily: { day: string; inbound: number; outbound: number }[]
  ai_cost_by_feature: { feature: string; usd: number }[]
  hot_list: { id: string; full_name: string | null; company: string | null; product: string | null; closing_step: ClosingStep | null; conversation_id: string | null }[]
  recent_alerts: { kind: string; title: string; created_at: string; link_path: string | null }[]
}

export interface AlertSettings {
  email: string | null
  events: { hot: boolean; approval: boolean; escalation: boolean; won: boolean }
  telegram_username: string | null
  telegram_linked: boolean
}

// ---------- Abonnements (paiements) ----------

export type Currency = 'XAF' | 'EUR' | 'USD'
export type BillingInterval = 'month' | 'year'
export type PaymentProvider = 'stripe' | 'paypal' | 'flutterwave'

export interface Plan {
  id: string
  name: string
  description: string
  prices: Record<Currency, Record<BillingInterval, number>>
  limits: { products: number; whatsapp_numbers: number; ai_actions: number; members: number }
  features: string[]
}

export interface Entitlements {
  plan_id: string
  plan_name: string
  status: 'trialing' | 'pending_payment' | 'active' | 'past_due' | 'canceled' | 'expired'
  provider: PaymentProvider | 'manual' | 'neero' | null
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  has_access: boolean
  limits: Plan['limits']
  usage: Plan['limits']
}

// Encaissement manuel : le client demande, le propriétaire envoie un lien Neero, le client
// paie et déclare sa référence, le propriétaire valide.
export type BillingMode = 'manual' | 'automatic'
export type PaymentRequestStatus = 'awaiting_link' | 'link_sent' | 'reference_submitted' | 'validated' | 'canceled'

export interface PaymentRequest {
  id: string
  plan_id: string
  billing_interval: BillingInterval
  currency: Currency
  amount: number
  kind: 'new' | 'renewal'
  status: PaymentRequestStatus
  contact_phone: string | null
  payment_link: string | null
  transaction_ref: string | null
  rejection_reason: string | null
  created_at: string
  link_sent_at: string | null
}

export interface AdminPaymentRequest {
  id: string
  organization_id: string
  organization: string
  owner_email: string | null
  contact_name: string | null
  project: string | null
  plan_id: string
  plan: string
  interval: BillingInterval
  currency: Currency
  amount: number
  kind: 'new' | 'renewal'
  status: PaymentRequestStatus
  contact_phone: string | null
  payment_link: string | null
  transaction_ref: string | null
  rejection_reason: string | null
  created_at: string
  link_sent_at: string | null
  ref_submitted_at: string | null
  validated_at: string | null
  current_period_end: string | null
}

// Lien Neero réutilisable d'une formule (valable quelques jours).
export interface PlanLink {
  plan_id: string
  plan: string
  interval: BillingInterval
  amount: number
  url: string | null
  created_at: string | null
  expires_at: string | null
}

export interface EmailLogRow {
  id: number
  to_email: string
  subject: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  error: string | null
  created_at: string
  sent_at: string | null
}

export interface PaymentRow {
  id: string
  provider: string
  amount: number
  currency: string
  status: 'succeeded' | 'failed' | 'refunded'
  paid_at: string
}

export interface AdminSubscription {
  organization_id: string
  organization: string
  owner_email: string | null
  plan: string
  plan_id: string
  status: Entitlements['status']
  provider: string | null
  currency: string | null
  amount: number | null
  interval: BillingInterval | null
  mrr_xaf: number
  trial_ends_at: string | null
  current_period_end: string | null
  created_at: string
}

export interface AdminStats {
  currency: 'XAF'
  kpis: {
    mrr: number; arr: number; collected_this_month: number; active: number; trialing: number; past_due: number
    canceled_this_month: number; organizations: number; trial_conversion: number | null; ai_cost_this_month_xaf: number
  }
  monthly: { month: string; revenue: number; ai_cost: number; signups: number }[]
  by_plan: { plan: string; subscribers: number; mrr: number }[]
  by_provider: { provider: string; revenue: number }[]
  subscriptions: AdminSubscription[]
  recent_payments: { organization: string; provider: string; amount: number; currency: string; amount_xaf: number; status: string; paid_at: string }[]
}
