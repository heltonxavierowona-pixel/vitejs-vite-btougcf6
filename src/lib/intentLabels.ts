import type { Intent } from './types'

export const INTENT_LABEL: Record<Intent, string> = {
  interested: 'Intérêt explicite',
  curious: 'Curieux (pose une question)',
  neutral: 'Neutre',
  not_now: 'Pas maintenant',
  negative: 'Négatif',
  stop: 'Demande d\'arrêt',
  other: 'Hors sujet',
}

export const ARCHIVE_LABEL: Record<string, string> = {
  neutral: 'réponse neutre', negative: 'réponse négative', not_now: 'pas maintenant', stop: 'demande d\'arrêt',
  manual: 'archivé à la main',
}

export function actionMessage(action: string, intent: Intent): { kind: 'ok' | 'notice' | 'error'; text: string } {
  switch (action) {
    case 'handoff_draft':
    case 'propose_handoff':
      return { kind: 'ok', text: 'Intérêt explicite : envoyez-lui ce message avec votre lien WhatsApp. Son code personnel rattachera la conversation WhatsApp à son historique.' }
    case 'handoff_sent':
      return { kind: 'ok', text: 'Intérêt explicite : la proposition WhatsApp a été envoyée automatiquement.' }
    case 'handoff_no_whatsapp':
      return { kind: 'notice', text: 'Intérêt explicite, mais aucun WhatsApp n\'est connecté. Connectez-le dans « Canaux » pour lui proposer la suite.' }
    case 'phone_received':
      return { kind: 'ok', text: 'Il a donné son numéro : il accepte d\'être contacté sur WhatsApp (message modèle, Partie 6).' }
    case 'continue':
      return { kind: 'ok', text: 'Intérêt explicite sur WhatsApp : place au closing.' }
    case 'reply':
      return { kind: 'notice', text: 'Il pose une question : répondez-lui (✨ Suggérer dans Conversations). WhatsApp sera proposé quand l\'intérêt sera explicite.' }
    case 'archive':
      return { kind: 'notice', text: `${INTENT_LABEL[intent]} : prospect archivé, aucune relance.` }
    case 'stop':
      return { kind: 'error', text: 'Demande d\'arrêt : prospect archivé, il ne sera plus jamais contacté.' }
    case 'review':
      return { kind: 'notice', text: 'Intention incertaine : c\'est à vous de trancher (section « À vérifier »).' }
    default:
      return { kind: 'notice', text: 'Aucune action automatique.' }
  }
}
