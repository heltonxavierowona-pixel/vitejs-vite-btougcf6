import type { AiDraft, DraftKind, Message, Product, Prospect, RelationalProfile } from './types'
import type { ChannelId } from '../data/channels'

// Rédacteur de démonstration : produit des brouillons par modèles quand l'IA
// n'est pas configurée. En production, c'est l'Edge Function draft-message qui rédige.

const SENSITIVE: Record<string, RegExp> = {
  prix: /\b(prix|combien|tarif|co[uû]t|cher|price|how much|fcfa|€|\$)\b/i,
  remise: /\b(remise|r[ée]duction|promo|discount)\b/i,
  contrat: /\b(contrat|devis|facture|engagement|contract|quote|invoice)\b/i,
  paiement: /\b(paiement|payer|momo|orange money|virement|acompte|payment)\b/i,
}

export function detectSensitive(text: string): string[] {
  return Object.entries(SENSITIVE).filter(([, re]) => re.test(text)).map(([topic]) => topic)
}

const isEnglish = (text: string) =>
  (text.match(/\b(the|and|you|your|is|are|what|how|please|thanks|hello|hi)\b/gi) ?? []).length >= 2

const firstName = (name: string | null) => (name ?? '').split(/\s+/)[0] || ''

export function demoDraft(opts: {
  kind: DraftKind
  channel: ChannelId
  product: Product | undefined
  prospect: Pick<Prospect, 'full_name' | 'job_title' | 'company' | 'language'>
  profile: RelationalProfile | null
  messages: Message[]
}): AiDraft {
  const { kind, channel, product, prospect, profile, messages } = opts
  // Messages du prospect restés sans réponse depuis notre dernier message.
  const lastOut = messages.map((m) => m.direction).lastIndexOf('outbound')
  const unanswered = messages.slice(lastOut + 1).filter((m) => m.direction === 'inbound').map((m) => m.body).join('\n')
  const lastIn = unanswered || ([...messages].reverse().find((m) => m.direction === 'inbound')?.body ?? '')
  const english = profile?.language === 'en' || prospect.language === 'en' || isEnglish(lastIn)
  const tu = profile?.formality === 'tu'
  const name = firstName(prospect.full_name)
  const company = prospect.company ?? (english ? 'your company' : 'votre entreprise')
  const hook = product?.analysis?.hooks?.[0]
  const role = prospect.job_title ? prospect.job_title.charAt(0).toLowerCase() + prospect.job_title.slice(1) : null
  const pname = product?.name ?? (english ? 'our solution' : 'notre solution')

  let variants: { text: string; angle: string }[]
  if (kind === 'invitation') {
    variants = english
      ? [
          { text: `Hi ${name}, I follow HR topics in ${company}'s sector and would be glad to connect.`, angle: 'intérêt commun' },
          { text: `Hello ${name}, your role as ${prospect.job_title ?? 'leader'} caught my attention. Happy to connect!`, angle: 'poste' },
        ]
      : [
          { text: `Bonjour ${name}, votre parcours de ${role ?? 'responsable'} chez ${company} m'a interpellée. Ravie d'échanger avec vous.`, angle: 'poste' },
          { text: `Bonjour ${name}, j'échange régulièrement avec des ${role ? `${role}s` : 'responsables'} de la région. Au plaisir de vous compter dans mon réseau.`, angle: 'réseau local' },
        ]
  } else if (kind === 'opening') {
    variants = english
      ? [
          { text: `Thanks for connecting, ${name}! Quick question: how does ${company} handle this today? ${pname} helps teams like yours${hook ? ` (${hook})` : ''}. Would it be useful to compare?`, angle: 'question' },
        ]
      : [
          { text: `Merci pour la connexion, ${name} !\n\nPar curiosité : comment gérez-vous ce sujet aujourd'hui chez ${company} ?\n\n${pname} aide des équipes comme la vôtre${hook ? ` : ${hook.toLowerCase()}` : ''}. Est-ce un sujet d'actualité pour vous ?`, angle: 'question' },
          { text: `Bonjour ${name}, merci d'avoir accepté.\n\nJ'accompagne des ${role ? `${role}s` : 'responsables'} sur ce sujet avec ${pname}. Qu'est-ce qui vous prend le plus de temps en ce moment ?`, angle: 'douleur' },
        ]
  } else {
    const topics = detectSensitive(lastIn)
    const greet = english ? `Hi ${name}` : `${tu ? 'Coucou' : 'Bonjour'} ${name}`
    variants = english
      ? [
          { text: `${greet}, thanks for your message! Let me check that for you. What date do you need it for?`, angle: 'question' },
          { text: `${greet}! Great question. I'll send you the details right away.`, angle: 'réassurance' },
        ]
      : [
          { text: `${greet}, merci pour ${tu ? 'ton' : 'votre'} message ! Je vérifie et je ${tu ? 'te' : 'vous'} confirme tout ça dans un instant 🙂`, angle: 'réassurance' },
          { text: `${greet} ! Bonne question. Pour ${tu ? 'te' : 'vous'} répondre au mieux : c'est pour quelle occasion ?`, angle: 'question' },
        ]
    return {
      id: crypto.randomUUID(), kind, channel, language: english ? 'en' : 'fr', formality: tu ? 'tu' : 'vous',
      variants, sensitive: { is: topics.length > 0, topics },
      rationale: 'Brouillon de démonstration : configurez l\'IA pour des réponses fondées sur vos connaissances produit.',
      source: 'demo',
    }
  }
  return {
    id: crypto.randomUUID(), kind, channel, language: english ? 'en' : 'fr', formality: tu ? 'tu' : 'vous',
    variants, sensitive: { is: false, topics: [] },
    rationale: 'Brouillon de démonstration : configurez l\'IA pour des messages vraiment personnalisés.',
    source: 'demo',
  }
}
