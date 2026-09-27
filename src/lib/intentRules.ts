import { extractPhone } from '../../supabase/functions/_shared/prompts.ts'
import type { Intent } from './types'

// Classification par mots-clés (mode démo). En production, c'est l'Edge Function
// classify-message (IA) qui classe ; ces règles reprennent les mêmes définitions.

const RULES: { intent: Intent; re: RegExp; confidence: number }[] = [
  { intent: 'stop', re: /(arr[êe]tez|ne (plus )?m'?[ée]cri|stop|d[ée]sabonn|spam|signaler|leave me alone|unsubscribe)/i, confidence: 0.9 },
  { intent: 'negative', re: /(non merci|pas int[ée]ress|no thanks|not interested|d[ée]j[àa] un (outil|logiciel|fournisseur)|pas besoin)/i, confidence: 0.85 },
  { intent: 'not_now', re: /(plus tard|pas maintenant|revenez|recontactez.* (en|dans)|next (month|year|quarter)|later)/i, confidence: 0.8 },
  { intent: 'interested', re: /(int[ée]ress[ée]|oui|d[ée]mo|devis|comment (on fait|commander|proc[ée]der)|je veux|envoyez|how much|combien|prix|tarif|yes|appel|rendez-vous|rdv|whatsapp)/i, confidence: 0.85 },
  { intent: 'curious', re: /\?/, confidence: 0.7 },
  { intent: 'neutral', re: /^(merci|ok|d'accord|int[ée]ressant|je (verrai|regarde)|noted|thanks|👍|🙏)[\s!.]*$/i, confidence: 0.75 },
]

export function classifyWithRules(text: string): { intent: Intent; confidence: number; evidence: string; phone: string | null } {
  const phone = extractPhone(text)
  if (phone) return { intent: 'interested', confidence: 0.9, evidence: text.slice(0, 80), phone }
  for (const r of RULES) {
    const m = text.match(r.re)
    if (m) return { intent: r.intent, confidence: r.confidence, evidence: m[0], phone: null }
  }
  return { intent: 'neutral', confidence: 0.5, evidence: '', phone: null }
}
