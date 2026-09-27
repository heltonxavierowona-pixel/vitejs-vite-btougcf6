export type ChannelId = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'whatsapp'
export type ChannelMode = 'auto' | 'assisted'

export interface ChecklistItem {
  id: string
  label: string
  hint?: string
}

export interface Channel {
  id: ChannelId
  name: string
  color: string
  mode: ChannelMode
  role: string
  canColdMessage: string
  api: string
  risks: string[]
  checklist: ChecklistItem[]
}

// Règles de chaque canal (voir docs/00-architecture-saas.md §2).
export const CHANNELS: Channel[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    color: '#0a66c2',
    mode: 'assisted',
    role: 'Outbound — ouverture de conversation avec RH et dirigeants',
    canColdMessage: 'Oui, envoyé par vous (l\'IA rédige)',
    api: 'Aucune API de messagerie ouverte',
    risks: [
      'Automatisation interdite par les CGU : restriction du compte',
      '~100 invitations/semaine max après la chauffe',
    ],
    checklist: [
      { id: 'account', label: 'Compte dédié créé avec une identité réelle' },
      { id: 'profile', label: 'Profil complet (photo, bannière, titre orienté bénéfice)' },
      { id: 'page', label: 'Page entreprise Core HR créée' },
      { id: 'warmup', label: 'Chauffe démarrée (3–4 semaines)', hint: '5–10 invitations/jour la 1re semaine' },
    ],
  },
  {
    id: 'x',
    name: 'X',
    color: '#71767b',
    mode: 'assisted',
    role: 'Outbound — PME et entrepreneurs actifs',
    canColdMessage: 'Oui, envoyé par vous (API DM payante)',
    api: 'Payante — hors budget en Phase 1',
    risks: ['Messages non sollicités en masse = suspension'],
    checklist: [
      { id: 'account', label: 'Compte dédié créé, bio + lien' },
      { id: 'warmup', label: 'Publication/réponses pendant 2–3 semaines' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877f2',
    mode: 'auto',
    role: 'Inbound — commentaires, messages de Page, pubs Click-to-Messenger',
    canColdMessage: 'Non — seulement en réponse (fenêtre 24 h)',
    api: 'Messenger Platform (Graph API), gratuite',
    risks: [
      'Écrire en premier est impossible via l\'API',
      'App Review requise avant de vendre le SaaS',
    ],
    checklist: [
      { id: 'business', label: 'Portefeuille Meta Business créé' },
      { id: 'page', label: 'Page Facebook créée et rattachée' },
      { id: 'app', label: 'App Meta (type Business) + produit Messenger' },
      { id: 'token', label: 'Utilisateur système + token permanent dans n8n' },
      { id: 'webhook', label: 'Webhook vérifié, Page abonnée (messages, feed)' },
      { id: 'test', label: 'Message de test visible dans Supabase' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: '#d62976',
    mode: 'auto',
    role: 'Inbound — DM, réponses aux stories, « commente INFO »',
    canColdMessage: 'Non — seulement en réponse (fenêtre 24 h)',
    api: 'Instagram Messaging API, gratuite',
    risks: ['Compte Professionnel obligatoire', 'Une seule réponse privée par commentaire'],
    checklist: [
      { id: 'pro', label: 'Compte passé en Professionnel (Entreprise)' },
      { id: 'linked', label: 'Lié à la Page Facebook' },
      { id: 'product', label: 'Produit Instagram ajouté à l\'app Meta' },
      { id: 'webhook', label: 'Webhook abonné (messages, comments)' },
      { id: 'test', label: 'DM de test visible dans Supabase' },
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    color: '#25d366',
    mode: 'auto',
    role: 'Closing — conversation IA après intérêt explicite',
    canColdMessage: 'Seulement avec modèle approuvé + consentement',
    api: 'WhatsApp Cloud API, facturée au message (modèles)',
    risks: [
      'Numéro sur l\'API = inutilisable dans l\'app (sauf coexistence)',
      'Blocages/signalements → baisse de qualité du numéro',
    ],
    checklist: [
      { id: 'number', label: 'Choix du numéro : nouvelle SIM ou coexistence' },
      { id: 'product', label: 'Produit WhatsApp ajouté, numéro vérifié par SMS' },
      { id: 'ids', label: 'PHONE_NUMBER_ID et WABA_ID notés' },
      { id: 'webhook', label: 'Webhook abonné (messages)' },
      { id: 'test', label: 'Message de test visible dans Supabase' },
    ],
  },
]

export const INFRA_CHECKLIST: ChecklistItem[] = [
  { id: 'domain', label: 'Nom de domaine + e-mail dédié' },
  { id: 'vps', label: 'VPS + n8n en HTTPS (infra/docker-compose.yml)' },
  { id: 'supabase', label: 'Projet Supabase + migration 0001 exécutée' },
  { id: 'openrouter', label: 'Clé OpenRouter avec limite de dépense' },
  { id: 'telegram', label: 'Bot Telegram + chat_id' },
  { id: 'healthcheck', label: 'Workflow 00 · Health-check actif' },
]
