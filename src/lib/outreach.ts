import type { ChannelId } from '../data/channels'
import type { OutreachProfile } from './types'

// Rythme quotidien de prospection sortante (miroir de daily_outreach_limit en SQL).
export const DAILY_LIMITS: Record<OutreachProfile, Partial<Record<ChannelId, number>>> = {
  new: { linkedin: 10, x: 10 },
  warming: { linkedin: 15, x: 20 },
  established: { linkedin: 20, x: 30 },
}

export const PROFILE_LABEL: Record<OutreachProfile, string> = {
  new: 'Compte neuf (moins d\'un mois)',
  warming: 'En chauffe (1 à 3 mois)',
  established: 'Compte établi',
}

export const STAGE_LABEL = {
  new: 'À contacter',
  contacted: 'Contacté',
  replied: 'A répondu',
  interested: 'Intéressé',
  whatsapp: 'Sur WhatsApp',
  hot: 'Chaud',
  won: 'Gagné',
  lost: 'Archivé',
  ghosted: 'Sans réponse',
} as const
