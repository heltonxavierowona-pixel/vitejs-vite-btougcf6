import { CHANNELS, type ChannelId } from '../data/channels'
import type { ChannelRecommendation, ProductAnalysis, ProductInput } from './types'

// Conseiller de canaux basé sur des règles.
// Deux usages :
//  1. analyse instantanée (mode démo, ou si l'IA est indisponible) ;
//  2. garde-fou appliqué à la sortie de l'IA : l'IA peut classer les canaux,
//     mais pas changer ce qu'un canal a le droit de faire (voir enforceChannelRules).

const AFRICA = ['cameroun', 'sénégal', 'senegal', 'côte d\'ivoire', 'cote d\'ivoire', 'gabon', 'congo', 'rdc',
  'bénin', 'benin', 'togo', 'mali', 'burkina', 'guinée', 'guinee', 'niger', 'tchad', 'nigeria', 'ghana',
  'kenya', 'maroc', 'tunisie', 'algérie', 'algerie', 'afrique']
const ANGLO = ['nigeria', 'ghana', 'kenya', 'usa', 'uk', 'royaume-uni', 'canada', 'afrique du sud']

const has = (text: string, words: string[]) => words.some((w) => text.includes(w))

const DECISION_MAKERS = ['rh', 'ressources humaines', 'dirigeant', 'directeur', 'ceo', 'dg', 'manager',
  'responsable', 'fondateur', 'entreprise', 'pme', 'startup', 'cabinet', 'b2b']
const TECH = ['saas', 'logiciel', 'tech', 'développeur', 'developpeur', 'startup', 'intelligence artificielle', 'crypto', 'no-code']
const VISUAL = ['mode', 'vêtement', 'vetement', 'beauté', 'beaute', 'cosmétique', 'cosmetique', 'food',
  'restaurant', 'pâtisserie', 'patisserie', 'déco', 'deco', 'bijou', 'coiffure', 'immobilier', 'voyage', 'photo']
const YOUNG = ['jeune', 'étudiant', 'etudiant', 'gen z', '18-25', 'influence']
const LOCAL_BUSINESS = ['commerçant', 'commercant', 'boutique', 'vendeur', 'artisan', 'restaurant', 'pme', 'tpe']

const APPROACH: Record<ChannelId, string> = {
  linkedin: 'Invitation personnalisée sans pitch, puis message de valeur après acceptation. L\'IA rédige, l\'utilisateur envoie.',
  x: 'Engager d\'abord en public (réponses utiles), puis message privé court. L\'IA rédige, l\'utilisateur envoie.',
  facebook: 'Publications et groupes qui font réagir, puis réponse automatique aux commentaires et messages de la Page.',
  instagram: 'Contenu visuel + appel à l\'action « commente INFO » ou réponse en story ; l\'IA répond en message privé.',
  whatsapp: 'Uniquement après intérêt explicite et numéro donné par le prospect ; l\'IA converse, l\'utilisateur valide prix et contrat.',
}

export function recommendChannels(p: ProductInput): ChannelRecommendation[] {
  const text = `${p.description} ${p.target}`.toLowerCase()
  const countries = p.countries.join(' ').toLowerCase()
  const africa = has(countries, AFRICA)
  const anglo = has(countries, ANGLO)
  const b2b = p.audience !== 'b2c'
  const b2c = p.audience !== 'b2b'

  const scores: Record<ChannelId, { score: number; reasons: string[] }> = {
    linkedin: { score: 20, reasons: [] },
    x: { score: 15, reasons: [] },
    facebook: { score: 25, reasons: [] },
    instagram: { score: 20, reasons: [] },
    whatsapp: { score: 70, reasons: ['Canal de conclusion : conversation directe, taux de lecture très élevé'] },
  }
  const add = (c: ChannelId, n: number, reason: string) => {
    scores[c].score += n
    scores[c].reasons.push(reason)
  }

  if (b2b) add('linkedin', 30, 'Vente aux entreprises : les décideurs y sont identifiables par poste')
  if (has(text, DECISION_MAKERS)) add('linkedin', 20, 'La cible est définie par une fonction (RH, dirigeant…)')
  if (p.price_level === 'eleve') add('linkedin', 10, 'Offre à forte valeur : une approche individuelle se justifie')
  if (p.audience === 'b2c') add('linkedin', -25, 'Grand public : peu présent ou peu réceptif sur LinkedIn')

  if (has(text, TECH)) add('x', 25, 'Audience tech/startup très active sur X')
  if (anglo) add('x', 10, 'X plus utilisé dans les marchés anglophones visés')
  if (africa && !anglo) add('x', -10, 'Usage de X plus faible en Afrique francophone')

  if (africa) add('facebook', 25, 'Facebook reste le réseau social n°1 dans les pays africains visés')
  if (has(text, LOCAL_BUSINESS)) add('facebook', 15, 'Commerçants et PME gèrent souvent leur activité depuis Facebook')
  if (b2c) add('facebook', 15, 'Portée grand public, groupes communautaires')

  if (has(text, VISUAL) || p.offer_type === 'physique') add('instagram', 30, 'Produit qui se montre : le visuel fait vendre')
  if (has(text, YOUNG)) add('instagram', 20, 'Cible jeune, très présente sur Instagram')
  if (b2c) add('instagram', 10, 'Audience grand public')
  if (p.audience === 'b2b' && !has(text, VISUAL)) add('instagram', -10, 'Peu adapté à une vente B2B non visuelle')

  if (africa) add('whatsapp', 20, 'WhatsApp est le canal de discussion par défaut en Afrique')
  if (p.price_level !== 'bas') add('whatsapp', 5, 'Les questions avant achat se règlent mieux en direct')

  return CHANNELS.map((c) => ({
    channel: c.id,
    score: Math.max(0, Math.min(100, scores[c.id].score)),
    reasons: scores[c.id].reasons,
    ...channelRole(c.id),
    approach: APPROACH[c.id],
  })).sort((a, b) => b.score - a.score)
}

function channelRole(id: ChannelId): Pick<ChannelRecommendation, 'role' | 'mode'> {
  if (id === 'whatsapp') return { role: 'closing', mode: 'auto' }
  if (id === 'facebook' || id === 'instagram') return { role: 'inbound', mode: 'auto' }
  return { role: 'outbound', mode: 'assisted' }
}

// Garde-fou appliqué à toute analyse IA : le rôle et le mode d'un canal
// viennent des règles des plateformes, jamais du modèle.
export function enforceChannelRules(channels: ChannelRecommendation[]): ChannelRecommendation[] {
  return channels
    .filter((c) => CHANNELS.some((k) => k.id === c.channel))
    .map((c) => ({ ...c, ...channelRole(c.channel), score: Math.max(0, Math.min(100, Math.round(c.score))) }))
    .sort((a, b) => b.score - a.score)
}

export function analyzeWithRules(p: ProductInput): ProductAnalysis {
  const channels = recommendChannels(p)
  const africa = has(p.countries.join(' ').toLowerCase(), AFRICA)
  return {
    summary: `${p.name} : ${p.audience === 'b2c' ? 'vente au grand public' : 'vente aux professionnels'}, `
      + `prospection conseillée sur ${channels.filter((c) => c.role !== 'closing').slice(0, 2)
        .map((c) => CHANNELS.find((k) => k.id === c.channel)!.name).join(' et ')}, conclusion sur WhatsApp.`,
    segments: [{ name: p.target || 'Cible principale', description: p.description.slice(0, 160), pains: [] }],
    channels,
    tone: p.audience === 'b2c' ? 'chaleureux et direct' : 'professionnel et concis',
    languages: africa ? ['fr', 'en'] : ['fr'],
    hooks: [],
    warnings: ['Analyse par règles : lancez l\'analyse IA pour des segments, accroches et objections détaillés.'],
    source: 'rules',
  }
}
