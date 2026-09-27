import type { Product, Prospect } from './types'

// Qualification par règles d'un profil collé (mode démo, ou repli si l'IA est indisponible).
// Volontairement simple et explicable : mots de la cible retrouvés dans le profil.

const STOP = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'avec', 'aux', 'au', 'un', 'une',
  'the', 'and', 'of', 'for', 'to', 'in', 'a', 'sur', 'par', 'ou', 'qui', 'que', 'dans'])

const EN_WORDS = [' the ', ' and ', ' at ', ' with ', ' manager', ' head of', ' director']
const FR_WORDS = [' et ', ' chez ', ' de la ', ' responsable', ' directeur', ' directrice', ' chargé']

// Mots normalisés : minuscules, sans accents, sans pluriel simple (« responsables » = « responsable »).
const words = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .map((w) => SYNONYMS[w] ?? w)

// Postes équivalents ramenés à un même mot.
const SYNONYMS: Record<string, string> = {
  directeur: 'dirigeant', directrice: 'dirigeant', dg: 'dirigeant', ceo: 'dirigeant', gerant: 'dirigeant',
  gerante: 'dirigeant', fondateur: 'dirigeant', fondatrice: 'dirigeant', founder: 'dirigeant', owner: 'dirigeant',
  drh: 'rh', hr: 'rh', hrbp: 'rh', manager: 'responsable', head: 'responsable',
}

// Profils rarement acheteurs pour une offre aux entreprises.
const NOT_BUYER = ['etudiant', 'student', 'stagiaire', 'intern', 'alternant', 'eleve']

export function splitProfiles(raw: string): { profile_url?: string; text: string }[] {
  return raw
    .split(/\n\s*(?:---+)?\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((text) => {
      const url = text.match(/https?:\/\/(?:[a-z]{2,3}\.)?(?:linkedin\.com|x\.com|twitter\.com)\/\S+/i)?.[0]
      return { profile_url: url?.replace(/[?#].*$/, '').replace(/\/$/, ''), text }
    })
}

export function qualifyWithRules(
  product: Pick<Product, 'target' | 'description' | 'analysis' | 'audience'>,
  item: { profile_url?: string; text: string },
): Omit<Prospect, 'id' | 'product_id' | 'best_channel' | 'stage' | 'source' | 'contacted_at' | 'created_at'> {
  const lines = item.text.split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:/i.test(l))
  const full_name = lines[0] ?? null
  const headline = lines[1] ?? ''
  const companyMatch = headline.match(/(?:chez|at|@|\|)\s*(.+)$/i)
  const lower = ` ${item.text.toLowerCase()} `

  const segments = product.analysis?.segments ?? []
  const vocabulary = new Set(words(`${product.target ?? ''} ${segments.map((s) => s.name).join(' ')}`))
  const profileWords = new Set(words(item.text))
  const matched = [...vocabulary].filter((w) => profileWords.has(w))

  const segment = segments
    .map((s) => ({ name: s.name, hits: words(s.name).filter((w) => profileWords.has(w)).length }))
    .sort((a, b) => b.hits - a.hits)[0]

  const notBuyer = NOT_BUYER.filter((w) => profileWords.has(w))
  const penalty = notBuyer.length && product.audience !== 'b2c' ? 20 : 0

  const en = EN_WORDS.filter((w) => lower.includes(w)).length
  const fr = FR_WORDS.filter((w) => lower.includes(w)).length

  return {
    full_name,
    job_title: headline ? headline.replace(/(?:chez|at|@|\|).*$/i, '').trim() || null : null,
    company: companyMatch?.[1]?.trim() ?? null,
    country: null,
    language: en > fr ? 'en' : 'fr',
    segment_label: segment && segment.hits > 0 ? segment.name : null,
    fit_score: Math.max(0, Math.min(90, 25 + matched.length * 15 - penalty)),
    fit_reasons: [
      matched.length
        ? `Mots de la cible retrouvés : ${matched.slice(0, 4).join(', ')}`
        : 'Aucun mot de la cible retrouvé dans le profil',
      ...(penalty ? ['Profil en formation : rarement décisionnaire'] : []),
    ],
    profile_url: item.profile_url ?? null,
  }
}
