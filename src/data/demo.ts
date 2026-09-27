import type {
  Approval, BrandVoice, WhatsAppTemplate, ChannelAccount, Conversation, EntryLink, KeywordTrigger, Message, Product, Prospect, RelationalProfile,
} from '../lib/types'
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
  {
    id: 'p1', ...coreHr, analysis: analyzeWithRules(coreHr), analyzed_at: ago(60),
    closing: {
      presentation_label: 'Présentation Core HR (PDF, 8 pages)', presentation_url: 'https://exemple.com/core-hr.pdf',
      booking_url: 'https://cal.com/awa/demo-core-hr', call_minutes: 20,
    },
    knowledge: 'Paie conforme CNPS et DIPE. Congés, contrats et dossiers du personnel. Essai gratuit 14 jours. '
      + 'Mise en place en 1 semaine. Support en français et en anglais.',
  },
  {
    id: 'p2', ...boutique, analysis: analyzeWithRules(boutique), analyzed_at: ago(30),
    closing: { presentation_label: 'Catalogue Wax & Co', presentation_url: 'https://exemple.com/catalogue-wax.pdf' },
    knowledge: 'Robes et ensembles en pagne wax sur mesure. Délai de confection : 7 jours. '
      + 'Livraison à Douala et Yaoundé : 2 000 FCFA. Robe à partir de 25 000 FCFA. Paiement Mobile Money à la commande.',
  },
]

export const demoAccounts: ChannelAccount[] = [
  { id: 'a1', channel: 'whatsapp', label: 'Wax & Co', display_phone: '+237 6 99 00 00 00', status: 'active', coexistence: true },
  { id: 'a2', channel: 'facebook', label: 'Wax & Co', display_phone: null, status: 'active', coexistence: false },
  { id: 'a3', channel: 'instagram', label: 'waxandco.cm', display_phone: null, status: 'active', coexistence: false },
]

export const demoConversations: Conversation[] = [
  {
    id: 'c1', prospect_id: 'r7', channel: 'whatsapp', prospect_name: 'Mireille N.',
    last_message_preview: 'Vous livrez à Bonamoussadi avant samedi ?', last_message_at: ago(4),
    last_inbound_at: ago(4), unread_count: 2, ai_paused: false, ai_paused_reason: null,
  },
  {
    id: 'c2', prospect_id: 'r8', channel: 'instagram', prospect_name: 'estelle_design',
    last_message_preview: 'INFO', last_message_at: ago(55), last_inbound_at: ago(55), unread_count: 1,
  },
  {
    id: 'c3', prospect_id: 'r6', channel: 'facebook', prospect_name: 'Paul Mbarga',
    last_message_preview: 'Merci, je regarde avec ma femme.', last_message_at: ago(60 * 30),
    last_inbound_at: ago(60 * 30), unread_count: 0,
  },
]

export const demoMessages: Message[] = [
  { id: 'm1', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(20), body: 'Bonsoir, j\'ai vu la robe bleue sur votre page. Elle existe en taille 42 ?' },
  { id: 'm2', conversation_id: 'c1', direction: 'outbound', status: 'read', ai_generated: true, sent_at: ago(18), body: 'Bonsoir Mireille ! Oui, la robe bleue se fait sur mesure, donc le 42 ne pose aucun souci. C\'est pour une occasion particulière ?' },
  { id: 'm3', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(6), body: 'Pour un mariage le 12. C\'est combien ?' },
  { id: 'm4', conversation_id: 'c1', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(4), body: 'Vous livrez à Bonamoussadi avant samedi ?' },
  { id: 'm9', conversation_id: 'c1', direction: 'outbound', status: 'pending_approval', ai_generated: true, sent_at: ago(3), body: 'La robe bleue sur mesure est à 25 000 FCFA, et la livraison à Bonamoussadi coûte 2 000 FCFA. Elle peut être prête jeudi, donc avant samedi 😊 On la lance ?' },
  { id: 'm5', conversation_id: 'c2', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(55), body: 'INFO' },
  { id: 'm6', conversation_id: 'c3', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(60 * 31), body: 'Bonjour, vous avez des ensembles pour couple ?' },
  { id: 'm7', conversation_id: 'c3', direction: 'outbound', status: 'read', ai_generated: true, sent_at: ago(60 * 30.5), body: 'Bonjour Paul ! Oui, nous faisons des ensembles assortis homme/femme. Je vous envoie quelques modèles ?' },
  { id: 'm8', conversation_id: 'c3', direction: 'inbound', status: 'received', ai_generated: false, sent_at: ago(60 * 30), body: 'Merci, je regarde avec ma femme.' },
]

const prospect = (p: Partial<Prospect> & Pick<Prospect, 'id' | 'full_name'>): Prospect => ({
  product_id: 'p1', job_title: null, company: null, country: 'Cameroun', language: 'fr', segment_label: null,
  stage: 'new', fit_score: null, fit_reasons: [], best_channel: 'linkedin', profile_url: null,
  source: 'import_linkedin', contacted_at: null, created_at: ago(60 * 24), ...p,
})

export const demoProspects: Prospect[] = [
  prospect({ id: 'r1', full_name: 'Carine Ebongue', job_title: 'Directrice des Ressources Humaines', company: 'Brasseries du Littoral', segment_label: 'DRH, responsables RH et dirigeants de PME', fit_score: 88, fit_reasons: ['DRH d\'une entreprise de 300+ salariés', 'Basée à Douala'], profile_url: 'https://www.linkedin.com/in/carine-ebongue' }),
  prospect({ id: 'r2', full_name: 'Serge Tchoupo', job_title: 'Directeur Général', company: 'Tchoupo Logistique', segment_label: 'DRH, responsables RH et dirigeants de PME', fit_score: 76, fit_reasons: ['Dirigeant de PME de 45 salariés', 'Pas de service RH dédié'], profile_url: 'https://www.linkedin.com/in/serge-tchoupo' }),
  prospect({ id: 'r3', full_name: 'Aïcha Diallo', job_title: 'Responsable paie', company: 'Sonatel Services', country: 'Sénégal', fit_score: 64, fit_reasons: ['Utilisatrice directe du module paie', 'Influence la décision'], profile_url: 'https://www.linkedin.com/in/aicha-diallo' }),
  prospect({ id: 'r4', full_name: 'Marc Kouassi', job_title: 'Consultant RH indépendant', country: 'Côte d\'Ivoire', fit_score: 41, fit_reasons: ['Prescripteur possible', 'Pas acheteur direct'], profile_url: 'https://www.linkedin.com/in/marc-kouassi' }),
  prospect({ id: 'r5', full_name: 'Nadine Fotso', job_title: 'DRH', company: 'Hôtel Akwa Palace', stage: 'contacted', fit_score: 82, fit_reasons: ['DRH hôtellerie, forte rotation du personnel'], contacted_at: ago(60 * 20), profile_url: 'https://www.linkedin.com/in/nadine-fotso' }),
  prospect({ id: 'r6', full_name: 'Paul Mbarga', product_id: 'p2', stage: 'replied', best_channel: null, source: 'facebook_inbound', fit_score: null }),
  prospect({ id: 'r7', full_name: 'Mireille N.', product_id: 'p2', stage: 'whatsapp', best_channel: null, source: 'lien:Bio Instagram', fit_score: null }),
  prospect({ id: 'r9', full_name: 'Aline Mballa', job_title: 'DRH', company: 'Groupe Mballa BTP', stage: 'hot', fit_score: 84, best_channel: null, source: 'lien:Flyer salon RH Douala', closing_step: 'presentation_sent', followups_sent: 0, next_followup_at: ago(-60 * 24) }),
  prospect({ id: 'r10', full_name: 'Brice Nana', job_title: 'Directeur administratif', company: 'Nana Distribution', stage: 'interested', fit_score: 71, fit_reasons: ['Gère la paie de 60 salariés'], followups_sent: 1, followup_due: true, last_followup_at: ago(10), next_followup_at: ago(-60 * 24 * 5), profile_url: 'https://www.linkedin.com/in/brice-nana' }),
  prospect({ id: 'r8', full_name: 'estelle_design', product_id: 'p2', stage: 'contacted', best_channel: null, source: 'instagram_comment', fit_score: null }),
]

export const demoEntryLinks: EntryLink[] = [
  { id: 'e1', product_id: 'p2', label: 'Bio Instagram', code: 'WX4Q1', prefilled_text: 'Bonjour ! Je souhaite voir vos modèles wax (réf. WX4Q1)', conversations: 12 },
  { id: 'e2', product_id: 'p1', label: 'Flyer salon RH Douala', code: 'HR7K2', prefilled_text: 'Bonjour, je souhaite une démo de Core HR (réf. HR7K2)', conversations: 3 },
]

export const demoTriggers: KeywordTrigger[] = [
  { id: 't1', product_id: 'p2', channel_account_id: 'a3', keywords: ['info', 'prix', 'combien'], reply_text: 'Merci pour votre message ! Voici le catalogue et les prix 👗 Quelle occasion préparez-vous ?', active: true, matches: 27 },
]

export const demoBrandVoice: BrandVoice = {
  sender_name: 'Awa', signature: 'Awa – Wax & Co', formality: 'vous', emojis: true,
  banned_phrases: ['N\'hésitez pas à revenir vers moi'],
}

const profile = (p: Partial<RelationalProfile>): RelationalProfile => ({
  language: 'fr', formality: 'vous', tone: null, style: {}, interests: [], pain_points: [], objections: [],
  preferences: [], buying_signals: [], summary: null, version: 1, updated_at: ago(5), ...p,
})

export const demoProfiles: Record<string, RelationalProfile> = {
  r7: profile({
    formality: 'tu', tone: 'chaleureux, direct, rassurant',
    style: { length: 'court', emojis: true, register: 'familier' },
    interests: ['robe bleue', 'taille 42', 'livraison à Bonamoussadi'],
    objections: ['délai (mariage le 12)'],
    buying_signals: ['date précise : mariage le 12', 'demande le prix', 'demande la livraison'],
    summary: 'Mireille veut la robe bleue en 42 pour un mariage le 12, livrée à Bonamoussadi. Très réactive, écrit court avec émojis. Sensible au délai.',
    version: 3,
  }),
  r6: profile({
    tone: 'posé, informatif', style: { length: 'moyen', emojis: false, register: 'cordial' },
    interests: ['ensembles assortis pour couple'], preferences: ['décide avec sa femme'],
    summary: 'Paul cherche des ensembles assortis homme/femme. Il décide avec sa femme : lui laisser le temps, proposer des photos.',
    version: 1,
  }),
}

export const demoApprovals: Approval[] = [
  {
    id: 'ap1', message_id: 'm9', conversation_id: 'c1', prospect_id: 'r7', prospect_name: 'Mireille N.',
    channel: 'whatsapp', topics: ['prix'], created_at: ago(3),
    proposed_body: 'La robe bleue sur mesure est à 25 000 FCFA, et la livraison à Bonamoussadi coûte 2 000 FCFA. Elle peut être prête jeudi, donc avant samedi 😊 On la lance ?',
    expires_at: new Date(Date.now() + (24 * 60 - 4) * 60_000).toISOString(),
    context: [
      { from: 'prospect', text: 'Pour un mariage le 12. C\'est combien ?' },
      { from: 'prospect', text: 'Vous livrez à Bonamoussadi avant samedi ?' },
    ],
  },
]

export const demoTemplates: WhatsAppTemplate[] = [
  { id: 't-1fr', purpose: 'followup_1', name: 'closer_relance_1_fr', language: 'fr', status: 'APPROVED', rejected_reason: null, body: 'Bonjour {{1}}, je reviens vers vous au sujet de {{2}}. Avez-vous pu regarder ce que je vous ai envoyé ? Je reste disponible pour vos questions.' },
  { id: 't-2fr', purpose: 'followup_2', name: 'closer_relance_2_fr', language: 'fr', status: 'PENDING', rejected_reason: null, body: 'Bonjour {{1}}, dernier petit message de ma part au sujet de {{2}}. Si ce n\'est plus d\'actualité, pas de souci. Sinon, répondez simplement ici et on reprend.' },
]
