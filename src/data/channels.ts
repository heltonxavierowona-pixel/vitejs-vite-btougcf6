export type ChannelId = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'whatsapp'
export type ChannelMode = 'auto' | 'assisted'

export interface Channel {
  id: ChannelId
  name: string
  color: string
  mode: ChannelMode
  role: string
  canColdMessage: string
  api: string
  notes: string[]
}

// Règles de chaque canal (voir docs/00-architecture-saas.md §2).
export const CHANNELS: Channel[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    color: '#0a66c2',
    mode: 'assisted',
    role: 'Prospection sortante — cibler par poste et par entreprise',
    canColdMessage: 'Oui, envoyé par vous (l\'IA rédige)',
    api: 'Aucune API de messagerie ouverte',
    notes: [
      'Automatisation interdite par les CGU : restriction du compte',
      '~100 invitations/semaine max après la chauffe',
    ],
  },
  {
    id: 'x',
    name: 'X',
    color: '#71767b',
    mode: 'assisted',
    role: 'Prospection sortante — audiences tech, médias, anglophones',
    canColdMessage: 'Oui, envoyé par vous (API DM payante)',
    api: 'Payante — hors budget en Phase 1',
    notes: ['Messages non sollicités en masse = suspension'],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877f2',
    mode: 'auto',
    role: 'Prospection entrante — commentaires et messages reçus par la Page',
    canColdMessage: 'Non — seulement en réponse (fenêtre 24 h)',
    api: 'Messenger Platform (Graph API), gratuite',
    notes: [
      'Écrire en premier est impossible via l\'API',
      'Chaque utilisateur connecte sa propre Page',
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: '#d62976',
    mode: 'auto',
    role: 'Prospection entrante — messages privés, stories, « commente INFO »',
    canColdMessage: 'Non — seulement en réponse (fenêtre 24 h)',
    api: 'Instagram Messaging API, gratuite',
    notes: ['Compte Professionnel obligatoire', 'Une seule réponse privée par commentaire'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    color: '#25d366',
    mode: 'auto',
    role: 'Conclusion — le client écrit sur WhatsApp, l\'utilisateur répond depuis la plateforme',
    canColdMessage: 'Seulement avec modèle approuvé + consentement',
    api: 'WhatsApp Cloud API, facturée au message (modèles)',
    notes: [
      'Avec la coexistence, le client garde son numéro et son app WhatsApp Business',
      'Blocages/signalements → baisse de qualité du numéro',
    ],
  },
]

export function channelInfo(id: ChannelId): Channel {
  return CHANNELS.find((c) => c.id === id)!
}
