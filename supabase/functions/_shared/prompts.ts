// Prompts du cerveau IA (Partie 3). Fonctions pures : aucune dépendance Deno,
// testables avec Node. Voir docs/03-cerveau-ia.md.

export type Channel = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'whatsapp'
export type DraftKind = 'invitation' | 'opening' | 'reply' | 'handoff' | 'followup'

export interface AiContext {
  brand_voice: {
    sender_name?: string
    signature?: string
    formality?: 'tu' | 'vous'
    emojis?: boolean
    banned_phrases?: string[]
  }
  product: {
    name: string
    description: string
    target?: string | null
    knowledge?: string | null
    tone?: string | null
    hooks?: string[] | null
    segments?: { name: string; description?: string; pains?: string[] }[] | null
  } | null
  prospect: {
    full_name?: string | null
    job_title?: string | null
    company?: string | null
    country?: string | null
    language?: string | null
    segment?: string | null
    fit_reasons?: string[] | null
    profile_text?: string | null
    stage?: string | null
  }
  profile: Record<string, unknown> | null
  conversation: { channel: Channel; messages: { from: 'prospect' | 'nous'; text: string; at: string }[] } | null
  closing?: {
    step: string | null
    next_action: 'send_presentation' | 'propose_call' | null
    presentation_label?: string | null
    has_presentation?: boolean
    has_booking?: boolean
    call_minutes?: number | null
    presentation_url?: string | null
    booking_url?: string | null
  } | null
}

// ---------- Contraintes par canal ----------

export const CHANNEL_FORMAT: Record<Channel, Partial<Record<DraftKind, { max: number; rules: string }>>> = {
  linkedin: {
    invitation: {
      max: 200,
      rules: 'Note d\'invitation LinkedIn : 200 caractères maximum (limite des comptes gratuits). '
        + 'Aucune vente, aucun lien. Une raison sincère de se connecter, ancrée dans un fait du profil.',
    },
    opening: {
      max: 600,
      rules: 'Premier message après acceptation de l\'invitation : 300 à 600 caractères, 3 paragraphes courts maximum. '
        + 'Pas de lien, pas de pièce jointe, pas de demande d\'appel. Termine par UNE question ouverte facile.',
    },
    reply: { max: 600, rules: 'Réponse LinkedIn : courte, précise, une seule idée.' },
  },
  x: {
    opening: {
      max: 280,
      rules: 'Message privé X : 280 caractères maximum, ton direct, pas de lien.',
    },
    reply: { max: 280, rules: 'Réponse X : 280 caractères maximum.' },
  },
  facebook: { reply: { max: 500, rules: 'Messenger : 1 à 3 phrases, style conversationnel.' } },
  instagram: { reply: { max: 400, rules: 'Message privé Instagram : 1 à 3 phrases, style conversationnel et visuel.' } },
  whatsapp: {
    reply: {
      max: 500,
      rules: 'WhatsApp : 1 à 3 phrases, comme un humain qui écrit sur son téléphone. '
        + 'Pas de mise en forme lourde, pas de liste à puces.',
    },
  },
}

export function draftFormat(channel: Channel, kind: DraftKind) {
  const mapped: DraftKind = kind === 'handoff' ? 'reply'
    : kind === 'followup' ? ((channel === 'linkedin' || channel === 'x') ? 'opening' : 'reply') : kind
  const base = CHANNEL_FORMAT[channel][mapped]
    ?? CHANNEL_FORMAT[channel].reply ?? { max: 500, rules: '' }
  // Le lien WhatsApp (≈ 90 caractères) s'ajoute au texte : on laisse la place.
  return kind === 'handoff' ? { max: base.max + 120, rules: base.rules } : base
}

// Remplacé par le vrai lien wa.me après génération : l'IA n'écrit jamais d'URL elle-même.
export const HANDOFF_PLACEHOLDER = '{{LIEN_WHATSAPP}}'

// ---------- Rédaction ----------

export function buildDraftSystem(ctx: AiContext, channel: Channel, kind: DraftKind, followupNumber = 1): string {
  const v = ctx.brand_voice ?? {}
  const f = draftFormat(channel, kind)
  const variants = kind === 'reply' || kind === 'handoff' ? 2 : 3
  const handoff = kind === 'handoff'
    ? `
BASCULE VERS WHATSAPP
Le prospect vient d'exprimer un intérêt clair. Ton message :
1. répond en une phrase à ce qu'il vient de dire (sans donner de prix ni de conditions) ;
2. propose de continuer sur WhatsApp pour lui envoyer les détails et répondre plus vite ;
3. contient EXACTEMENT le texte ${HANDOFF_PLACEHOLDER} là où doit apparaître le lien (n'écris aucune URL) ;
4. précise que c'est à lui d'écrire en premier via ce lien, sans pression (« quand vous voulez »).
`
    : kind === 'followup'
      ? `
RELANCE n°${followupNumber} sur 2
Le prospect a montré de l'intérêt puis n'a plus répondu. Ton message :
- rappelle en une phrase le dernier sujet échangé (sans reproche, sans « je n'ai pas eu de réponse ») ;
- apporte UNE chose utile et nouvelle (un bénéfice, une réponse à son besoin, une question simple) ;
${followupNumber >= 2 ? '- c\'est la dernière relance : laisse une porte de sortie élégante (« si ce n\'est plus d\'actualité, pas de souci »).' : '- termine par une question fermée facile (oui/non).'}
`
      : ''
  return `Tu écris au nom de ${v.sender_name ?? 'l\'utilisateur'}, qui vend « ${ctx.product?.name ?? 'son offre'} ».
Tu rédiges ${kind === 'reply' || kind === 'handoff' ? 'une réponse' : kind === 'followup' ? 'une relance' : 'un premier message'} de prospection, comme un humain attentionné, jamais comme une publicité.

FORMAT DU CANAL
${f.rules}
Longueur maximale : ${f.max} caractères par variante.
${handoff}
LANGUE
- Écris dans la langue du prospect : celle de ses derniers messages s'il y en a, sinon celle de son profil.
- Mélange de langues (français/anglais/pidgin/camfranglais) : réponds dans la langue dominante, en langage simple. N'imite pas l'argot.
- Garde les noms de produits tels quels, ne les traduis pas.

TON (adapter au prospect)
- Par défaut : ${v.formality === 'tu' ? 'tutoiement' : 'vouvoiement'}${v.emojis === false ? ', sans émojis' : ''}.
- Premier contact avec un dirigeant ou un profil senior : vouvoiement.
- Si le prospect tutoie ou écrit de façon familière, tu peux le tutoyer. Ne change plus ensuite.
- Imite sa longueur de message et son usage des émojis (aucun s'il n'en met pas).
- Ton indiqué par l'analyse du produit : ${ctx.product?.tone ?? 'professionnel et chaleureux'}.

CONTENU
- Personnalise avec UN fait réel du profil ou de la conversation. Jamais de flatterie générique.
- N'affirme sur le produit que ce qui figure dans CONNAISSANCES PRODUIT. Si l'information manque, pose une question ou propose de vérifier.
- Une seule idée par message. Pas de jargon. Pas de promesse chiffrée non prouvée.
- Phrases interdites : « J'espère que vous allez bien », « Je me permets de vous contacter »${(v.banned_phrases ?? []).map((p) => `, « ${p} »`).join('')}.
${v.signature && kind !== 'reply' ? `- Signature possible si le format le permet : ${v.signature}` : ''}

HONNÊTETÉ
- Tu es l'assistant de ${v.sender_name ?? 'l\'utilisateur'}. Si on te demande si tu es un robot ou une IA, ne mens jamais : dis que tu es son assistant et que ${v.sender_name ?? 'il ou elle'} peut prendre le relais.

SUJETS SENSIBLES
Prix, remise, devis, contrat, conditions de paiement, remboursement, engagement juridique :
- si le prospect en parle ou si ta réponse en parle, mets "sensitive.is" à true et liste les sujets ;
- tu peux utiliser un prix présent dans les connaissances, mais n'invente jamais un prix ni une remise.

Propose ${variants} variantes avec des angles différents (ex. question, bénéfice, preuve).

Réponds UNIQUEMENT en JSON :
{"language": "fr", "formality": "vous", "variants": [{"text": "", "angle": ""}], "sensitive": {"is": false, "topics": []}, "rationale": "pourquoi ce ton et cette langue, en une phrase"}`
}

export function buildDraftUser(ctx: AiContext, kind: DraftKind): string {
  const p = ctx.product
  return JSON.stringify({
    type: kind,
    produit: p && {
      nom: p.name, description: p.description, cible: p.target,
      accroches_suggerees: p.hooks ?? [], segments: p.segments ?? [],
    },
    'CONNAISSANCES PRODUIT': p?.knowledge || '(aucune — ne rien affirmer de précis sur le produit)',
    prospect: ctx.prospect,
    profil_relationnel: ctx.profile,
    conversation: ctx.conversation?.messages ?? [],
  })
}

export interface Draft {
  language: string
  formality: 'tu' | 'vous'
  variants: { text: string; angle: string }[]
  sensitive: { is: boolean; topics: string[] }
  rationale: string
}

// Valide et borne la sortie du modèle. Les variantes trop longues sont coupées
// proprement (fin de phrase) plutôt que rejetées.
export function normalizeDraft(raw: Record<string, unknown>, channel: Channel, kind: DraftKind): Draft {
  const max = draftFormat(channel, kind).max
  const clip = (t: string) => {
    if (t.length <= max) return t
    const cut = t.slice(0, max)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    return end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…'
  }
  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .map((v: { text?: unknown; angle?: unknown }) => ({ text: clip(String(v?.text ?? '').trim()), angle: String(v?.angle ?? '') }))
    .filter((v) => v.text)
    .slice(0, 3)
  const s = (raw.sensitive ?? {}) as { is?: unknown; topics?: unknown }
  return {
    language: String(raw.language ?? 'fr').slice(0, 5),
    formality: String(raw.formality ?? '').toLowerCase() === 'tu' ? 'tu' : 'vous',
    variants,
    sensitive: { is: s.is === true, topics: Array.isArray(s.topics) ? s.topics.map(String) : [] },
    rationale: String(raw.rationale ?? ''),
  }
}

// ---------- Profil relationnel ----------

export const PROFILE_SYSTEM = `Tu tiens à jour le « profil relationnel » d'un prospect à partir de ses messages.
Ce profil sert à personnaliser les prochains messages. Il ne contient que ce qui aide la relation commerciale.

Mets à jour le profil existant :
- garde les informations passées sauf si le prospect les contredit ;
- n'ajoute que ce qu'il a dit ou montré (pas de suppositions) ;
- AUCUNE donnée sensible : santé, religion, origine, opinions politiques, vie privée, situation financière personnelle.

Champs :
- language : langue dominante de SES messages (code ISO)
- formality : "tu" s'il tutoie ou écrit de façon familière, sinon "vous"
- style : {"length": "court|moyen|long", "emojis": true|false, "register": "formel|cordial|familier"}
- tone : en 3 mots, comment lui parler
- interests : ce qui l'intéresse dans l'offre
- pain_points : problèmes qu'il exprime
- objections : freins exprimés (prix, délai, confiance…)
- preferences : préférences pratiques (moment, canal, format)
- buying_signals : signaux d'achat concrets (date, quantité, budget évoqué, demande de devis…)
- summary : 400 caractères maximum, à la 3e personne, ce qu'il faut savoir avant de lui répondre

Réponds UNIQUEMENT en JSON avec ces champs.`

export function buildProfileUser(ctx: AiContext): string {
  return JSON.stringify({
    produit: ctx.product?.name,
    prospect: { nom: ctx.prospect.full_name, poste: ctx.prospect.job_title, entreprise: ctx.prospect.company },
    profil_actuel: ctx.profile,
    messages: ctx.conversation?.messages ?? [],
  })
}

export function normalizeProfile(raw: Record<string, unknown>): Record<string, unknown> {
  const list = (v: unknown, n = 8) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, n) : [])
  const style = (raw.style ?? {}) as Record<string, unknown>
  const formality = String(raw.formality ?? '').toLowerCase()
  return {
    language: typeof raw.language === 'string' ? raw.language.slice(0, 5) : null,
    formality: formality === 'tu' || formality === 'vous' ? formality : null,
    style: {
      length: ['court', 'moyen', 'long'].includes(String(style.length)) ? style.length : 'moyen',
      emojis: style.emojis === true,
      register: ['formel', 'cordial', 'familier'].includes(String(style.register)) ? style.register : 'cordial',
    },
    tone: typeof raw.tone === 'string' ? raw.tone.slice(0, 80) : null,
    interests: list(raw.interests),
    pain_points: list(raw.pain_points),
    objections: list(raw.objections),
    preferences: list(raw.preferences),
    buying_signals: list(raw.buying_signals),
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 400) : '',
  }
}

// ---------- Détection d'intérêt (Partie 4) ----------

export type Intent = 'interested' | 'curious' | 'neutral' | 'not_now' | 'negative' | 'stop' | 'other'
export const INTENTS: Intent[] = ['interested', 'curious', 'neutral', 'not_now', 'negative', 'stop', 'other']

export const INTENT_SYSTEM = `Tu analyses la réponse d'un prospect à une démarche commerciale.
Classe l'intention de SON DERNIER MESSAGE (les messages précédents servent de contexte).

Intentions :
- interested : intérêt CLAIR et EXPLICITE. Il demande une démo, un prix, un devis, comment acheter ou commander,
  accepte un échange ou un appel, dit oui à la proposition, ou demande à être contacté (ex. « Oui ça m'intéresse »,
  « Comment on fait pour commander ? », « Envoyez-moi les détails », « Yes please », « I go like am, how much? »).
- curious : il pose une question sur l'offre sans s'engager (« C'est quoi exactement ? », « Ça marche pour les PME ? »).
- neutral : poli mais sans engagement ni question (« Merci », « Ok », « Intéressant », « Je verrai », un pouce 👍).
- not_now : intéressé plus tard, explicitement (« Revenez vers moi en janvier », « Pas ce trimestre »).
- negative : refus (« Non merci », « Pas intéressé », « On a déjà un outil »).
- stop : demande de ne plus être contacté, agacement fort, menace de signaler.
- other : hors sujet, spam, réponse automatique d'absence.

Règles :
- La politesse n'est PAS de l'intérêt. Dans le doute entre interested et curious : curious.
- S'il y a une vraie question sur l'offre, ce n'est pas neutral.
- confidence : 0 à 1, ta certitude. Sois honnête : un message ambigu vaut moins de 0.7.
- evidence : la citation exacte (courte) qui justifie ton choix.
- phone : le numéro de téléphone s'il en donne un pour être recontacté, sinon null.
- wants_whatsapp : true s'il mentionne WhatsApp.
- revisit : pour not_now, la période indiquée (« janvier »), sinon null.

Réponds UNIQUEMENT en JSON :
{"intent": "interested", "confidence": 0.9, "evidence": "", "phone": null, "wants_whatsapp": false, "revisit": null, "language": "fr"}`

export function buildIntentUser(ctx: AiContext): string {
  return JSON.stringify({
    produit: ctx.product?.name,
    prospect: { nom: ctx.prospect.full_name, poste: ctx.prospect.job_title },
    conversation: (ctx.conversation?.messages ?? []).slice(-8),
  })
}

// Numéro de téléphone au format international (E.164). Numéros camerounais
// reconnus sans indicatif (9 chiffres commençant par 6 ou 2).
export function extractPhone(text: string, defaultCountry = '237'): string | null {
  const candidates = text.match(/(?:\+|00)?\d[\d\s.\-()]{7,18}\d/g) ?? []
  for (const raw of candidates) {
    const plus = raw.trim().startsWith('+') || raw.trim().startsWith('00')
    let digits = raw.replace(/\D/g, '')
    if (digits.startsWith('00')) digits = digits.slice(2)
    if (plus && digits.length >= 8 && digits.length <= 15) return `+${digits}`
    if (defaultCountry === '237') {
      if (digits.length === 12 && digits.startsWith('237') && /^[62]/.test(digits.slice(3))) return `+${digits}`
      if (digits.length === 9 && /^[62]/.test(digits)) return `+237${digits}`
    }
  }
  return null
}

export interface IntentResult {
  intent: Intent
  confidence: number
  evidence: string
  phone: string | null
  wants_whatsapp: boolean
  revisit: string | null
}

export function normalizeIntent(raw: Record<string, unknown>, lastMessage: string): IntentResult {
  const intent = INTENTS.includes(raw.intent as Intent) ? (raw.intent as Intent) : 'other'
  const conf = Number(raw.confidence)
  // Le numéro vient du texte lui-même : jamais d'un numéro « deviné » par le modèle.
  const phone = extractPhone(lastMessage) ?? (typeof raw.phone === 'string' ? extractPhone(raw.phone) : null)
  return {
    intent,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, Math.round(conf * 100) / 100)) : 0,
    evidence: String(raw.evidence ?? '').slice(0, 300),
    phone: phone && lastMessage.replace(/\D/g, '').includes(phone.replace(/\D/g, '').slice(-8)) ? phone : null,
    wants_whatsapp: raw.wants_whatsapp === true,
    revisit: typeof raw.revisit === 'string' ? raw.revisit.slice(0, 60) : null,
  }
}

export function whatsappLink(displayPhone: string, code: string, productName?: string): string {
  const text = `Bonjour, je reviens vers vous${productName ? ` pour ${productName}` : ''} (réf. ${code})`
  return `https://wa.me/${displayPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

// Insère le lien à la place du marqueur (ou à la fin s'il manque).
export function insertHandoffLink(text: string, link: string): string {
  return text.includes(HANDOFF_PLACEHOLDER) ? text.split(HANDOFF_PLACEHOLDER).join(link) : `${text.trim()}\n${link}`
}

// ---------- Pilote automatique WhatsApp (Partie 5) ----------

// Filet de sécurité déterministe : s'ajoute au jugement de l'IA, ne le remplace pas.
const SENSITIVE_PATTERNS: Record<string, RegExp> = {
  prix: /\b(prix|combien|tarifs?|co[uû]ts?|cher|price|how much|cost)\b|\d[\d\s.,]*\s?(fcfa|xaf|cfa|f\b|€|eur|euros?|\$|usd)/i,
  remise: /\b(remises?|r[ée]ductions?|promos?|rabais|discounts?|gratuit)\b|\d+\s?%/i,
  contrat: /\b(contrats?|devis|factures?|bons? de commande|engagements?|conditions g[ée]n[ée]rales|contract|quote|invoice)\b/i,
  paiement: /\b(paiements?|payer|momo|mobile money|orange money|virements?|acomptes?|avances?|payment|pay)\b/i,
  remboursement: /\b(rembours\w*|refund|garantie)\b/i,
}

export function detectSensitive(text: string): string[] {
  return Object.entries(SENSITIVE_PATTERNS).filter(([, re]) => re.test(text)).map(([topic]) => topic)
}

// Messages non textuels : l'IA ne les comprend pas, l'humain reprend.
export const MEDIA_PLACEHOLDER = /^\[(audio|voice|image|video|document|sticker|location|contacts|pièce jointe|message non textuel)[^\]]*\]$/i

export const PRESENTATION_PLACEHOLDER = '{{LIEN_PRESENTATION}}'
export const BOOKING_PLACEHOLDER = '{{LIEN_RDV}}'

// Étape de closing imposée par la plateforme (closing_next_action en SQL).
function closingInstructions(ctx: AiContext): string {
  const c = ctx.closing
  const v = ctx.brand_voice ?? {}
  if (!c?.next_action) return ''
  if (c.next_action === 'send_presentation') {
    return `
ÉTAPE DE CLOSING : ENVOYER LA PRÉSENTATION
Le prospect est prêt. Réponds d'abord à son message, puis propose-lui « ${c.presentation_label || 'la présentation'} »
en écrivant EXACTEMENT ${PRESENTATION_PLACEHOLDER} à l'endroit du lien (n'écris aucune URL).
Ne demande PAS encore d'appel : ce sera l'étape suivante, après qu'il l'aura regardée.
Mets "closing_action" à "presentation".`
  }
  return `
ÉTAPE DE CLOSING : PROPOSER UN APPEL
Il a reçu la présentation et a répondu. Réponds à son message puis propose un appel${c.call_minutes ? ` de ${c.call_minutes} minutes` : ''} avec ${v.sender_name ?? 'l\'utilisateur'}.
${c.has_booking
    ? `Invite-le à choisir son créneau en écrivant EXACTEMENT ${BOOKING_PLACEHOLDER} à l'endroit du lien (n'écris aucune URL).`
    : 'Propose-lui de donner deux créneaux qui l\'arrangent cette semaine.'}
Si sa réponse montre un blocage (objection, question), traite-le d'abord et ne propose l'appel que s'il reste pertinent.
Mets "closing_action" à "call" seulement si tu proposes effectivement l'appel.`
}

export function buildAutopilotSystem(ctx: AiContext): string {
  const v = ctx.brand_voice ?? {}
  const base = buildDraftSystem(ctx, 'whatsapp', 'reply')
    .replace(/Propose \d+ variantes[^\n]*\n/, '')
    .replace(/Réponds UNIQUEMENT en JSON :[\s\S]*$/, '')
  return `${base}
MODE AUTONOME
Tu réponds seul, en direct, sur WhatsApp. Écris UNE seule réponse, la meilleure.
Objectif : aider sincèrement et faire avancer vers l'étape suivante (comprendre le besoin, répondre, proposer la présentation quand le prospect est prêt).
Passe la main à ${v.sender_name ?? 'l\'utilisateur'} (escalate = true) si :
- le prospect demande à parler à un humain, se plaint ou est mécontent ;
- la réponse exige une information absente des CONNAISSANCES PRODUIT ;
- il s'agit d'un cas particulier (réclamation, litige, commande spéciale, urgence).
Dans ce cas, écris quand même une courte réponse d'attente (« je vérifie avec ${v.sender_name ?? 'l\'équipe'} et je reviens vers vous »).
${closingInstructions(ctx)}

Réponds UNIQUEMENT en JSON :
{"text": "", "language": "fr", "formality": "vous", "sensitive": {"is": false, "topics": []}, "escalate": {"is": false, "reason": ""}, "closing_action": null}`
}

export interface AutopilotReply {
  closing_action: 'presentation' | 'call' | null
  text: string
  sensitive: boolean
  topics: string[]
  escalate: boolean
  reason: string | null
}

export function normalizeAutopilot(raw: Record<string, unknown>, lastInbound: string): AutopilotReply {
  const max = draftFormat('whatsapp', 'reply').max
  let text = String(raw.text ?? '').trim()
  if (text.length > max) {
    const cut = text.slice(0, max)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    text = end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…'
  }
  const s = (raw.sensitive ?? {}) as { is?: unknown; topics?: unknown }
  const e = (raw.escalate ?? {}) as { is?: unknown; reason?: unknown }
  const topics = [...new Set([
    ...(Array.isArray(s.topics) ? s.topics.map(String) : []),
    ...detectSensitive(text),
    ...detectSensitive(lastInbound),
  ])]
  return {
    closing_action: raw.closing_action === 'presentation' || raw.closing_action === 'call' ? raw.closing_action : null,
    text,
    sensitive: s.is === true || topics.length > 0,
    topics,
    escalate: e.is === true || !text,
    reason: e.is === true ? String(e.reason ?? 'demande de l\'IA') : !text ? 'réponse vide' : null,
  }
}

// Insère les vrais liens et détermine l'étape de closing réellement franchie.
export function applyClosingLinks(
  text: string,
  closing: AiContext['closing'],
  action: AutopilotReply['closing_action'],
): { text: string; step: 'presentation_sent' | 'call_proposed' | null } {
  if (!closing?.next_action) {
    return { text: text.split(PRESENTATION_PLACEHOLDER).join('').split(BOOKING_PLACEHOLDER).join('').trim(), step: null }
  }
  let out = text
  let step: 'presentation_sent' | 'call_proposed' | null = null
  if (closing.next_action === 'send_presentation' && closing.presentation_url) {
    if (out.includes(PRESENTATION_PLACEHOLDER)) out = out.split(PRESENTATION_PLACEHOLDER).join(closing.presentation_url)
    else if (action === 'presentation') out = `${out.trim()}\n${closing.presentation_url}`
    if (out.includes(closing.presentation_url)) step = 'presentation_sent'
  }
  if (closing.next_action === 'propose_call') {
    if (closing.booking_url) {
      if (out.includes(BOOKING_PLACEHOLDER)) out = out.split(BOOKING_PLACEHOLDER).join(closing.booking_url)
      else if (action === 'call') out = `${out.trim()}\n${closing.booking_url}`
      if (out.includes(closing.booking_url)) step = 'call_proposed'
    } else if (action === 'call') {
      step = 'call_proposed'
    }
  }
  out = out.split(PRESENTATION_PLACEHOLDER).join('').split(BOOKING_PLACEHOLDER).join('')
  return { text: out.trim(), step }
}

// Modèles WhatsApp de relance proposés par défaut ({{1}} = prénom, {{2}} = produit).
// Règles Meta : pas de variable en tout début ni en toute fin de texte.
export const DEFAULT_FOLLOWUP_TEMPLATES: { purpose: 'followup_1' | 'followup_2'; language: 'fr' | 'en'; body: string }[] = [
  { purpose: 'followup_1', language: 'fr', body: 'Bonjour {{1}}, je reviens vers vous au sujet de {{2}}. Avez-vous pu regarder ce que je vous ai envoyé ? Je reste disponible pour vos questions.' },
  { purpose: 'followup_2', language: 'fr', body: 'Bonjour {{1}}, dernier petit message de ma part au sujet de {{2}}. Si ce n\'est plus d\'actualité, pas de souci. Sinon, répondez simplement ici et on reprend.' },
  { purpose: 'followup_1', language: 'en', body: 'Hello {{1}}, just following up about {{2}}. Did you get a chance to look at what I sent? Happy to answer any questions.' },
  { purpose: 'followup_2', language: 'en', body: 'Hello {{1}}, one last message from me about {{2}}. If it is no longer relevant, no problem at all. Otherwise, just reply here and we will pick it up.' },
]

export function templateName(purpose: string, language: string): string {
  return `numera_${purpose.replace('followup_', 'relance_')}_${language}`
}
