import type { Product } from './types'

// Textes insérés par les boutons de closing (Conversations).
export function presentationText(product: Product): string | null {
  const c = product.closing
  if (!c?.presentation_url) return null
  return `Voici ${c.presentation_label ? `« ${c.presentation_label} »` : 'la présentation'} : ${c.presentation_url}`
}

export function callText(product: Product): string {
  const c = product.closing ?? {}
  const duration = c.call_minutes ? ` de ${c.call_minutes} minutes` : ''
  return c.booking_url
    ? `Seriez-vous disponible pour un appel${duration} ? Choisissez le créneau qui vous arrange : ${c.booking_url}`
    : `Seriez-vous disponible pour un appel${duration} cette semaine ? Donnez-moi deux créneaux qui vous arrangent.`
}
