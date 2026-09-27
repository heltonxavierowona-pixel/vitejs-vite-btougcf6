import type { ChannelAccount, Conversation, Message, Product } from '../lib/types'
import { analyzeWithRules } from '../lib/channelAdvisor'

// Données de démonstration : utilisées tant que Supabase n'est pas configuré.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const coreHr = {
  name: 'Core HR',
  description: 'Logiciel RH en ligne : paie, congés, contrats et dossiers du personnel pour les entreprises de 20 à 500 salariés.',
  offer_type: 'saas' as const,
  audience: 'b2b' as const,
  target: 'DRH, responsables RH et dirigeants de PME',
  countries: ['Cameroun', 'Côte d\'Ivoire', 'Sénégal'],
  price_level: 'moyen' as const,
}

const boutique = {
  name: 'Wax & Co',
  description: 'Boutique de vêtements en pagne wax sur mesure, livraison à Douala et Yaoundé.',
  offer_type: 'physique' as const,
  audience: 'b2c' as const,
  target: 'Femmes actives 25-45 ans, mariages et cérémonies',
  countries: ['Cameroun'],
  price_level: 'moyen' as const,
}

export const demoProducts: Product[] = [
  { id: 'p1', ...coreHr, analysis: analyzeWithRules(coreHr), analyzed_at: ago(60) },
  { id: 'p2', ...boutique, analysis: analyzeWithRules(boutique), analyzed_at: ago(30) },
]

export const demoAccounts: ChannelAccount[] = [
  { id: 'a1', channel: 'whatsapp', label: 'Wax & Co', display_phone: '+237 6 99 00 00 00', status: 'active', coexistence: true },
  { id: 'a2', channel: 'facebook', label: 'Wax & Co', display_phone: null, status: 'active', coexistence: false },
]

export const demoConversations: Conversation[] = [
  {
    id: 'c1', channel: 'whatsapp', prospect_name: 'Mireille N.',
    last_message_preview: 'Vous livrez à Bonamoussadi avant samedi ?', last_message_at: ago(4),
    last_inbound_at: ago(4), unread_count: 2,
  },
  {
    id: 'c2', channel: 'instagram', prospect_name: 'estelle_design',
    last_message_preview: 'INFO', last_message_at: ago(55), last_inbound_at: ago(55), unread_count: 1,
  },
  {
    id: 'c3', channel: 'facebook', prospect_name: 'Paul Mbarga',
    last_message_preview: 'Merci, je regarde avec ma femme.', last_message_at: ago(60 * 30),
    last_inbound_at: ago(60 * 30), unread_count: 0,
  },
]

export const demoMessages: Message[] = [
  { id: 'm1', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(20), body: 'Bonsoir, j\'ai vu la robe bleue sur votre page. Elle existe en taille 42 ?' },
  { id: 'm2', conversation_id: 'c1', direction: 'outbound', status: 'read', ai_generated: true, sent_at: ago(18), body: 'Bonsoir Mireille ! Oui, la robe bleue se fait sur mesure, donc le 42 ne pose aucun souci. C\'est pour une occasion particulière ?' },
  { id: 'm3', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(6), body: 'Pour un mariage le 12. C\'est combien ?' },
  { id: 'm4', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(4), body: 'Vous livrez à Bonamoussadi avant samedi ?' },
  { id: 'm5', conversation_id: 'c2', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(55), body: 'INFO' },
  { id: 'm6', conversation_id: 'c3', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(60 * 31), body: 'Bonjour, vous avez des ensembles pour couple ?' },
  { id: 'm7', conversation_id: 'c3', direction: 'outbound', status: 'read', ai_generated: true, sent_at: ago(60 * 30.5), body: 'Bonjour Paul ! Oui, nous faisons des ensembles assortis homme/femme. Je vous envoie quelques modèles ?' },
  { id: 'm8', conversation_id: 'c3', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(60 * 30), body: 'Merci, je regarde avec ma femme.' },
]
