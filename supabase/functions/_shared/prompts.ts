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
  // Conclusion de la vente : produit digital → lien d'achat ; physique → contact du propriétaire.
  sale?: {
    mode: 'digital' | 'physique' | null
    purchase_url?: string | null
    owner_name?: string | null
    owner_whatsapp?: string | null
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

// ---------- Pilote automatique (Partie 5) : WhatsApp, Messenger, Instagram ----------

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

const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: 'LinkedIn', x: 'X', facebook: 'Messenger (Page Facebook)', instagram: 'Instagram (message privé)', whatsapp: 'WhatsApp',
}

export const PURCHASE_PLACEHOLDER = '{{LIEN_ACHAT}}'
export const CONTACT_PLACEHOLDER = '{{LIEN_CONTACT}}'

// Vente configurée et réalisable (lien d'achat ou numéro du propriétaire présent).
export function saleReady(sale: AiContext['sale']): 'purchase' | 'contact' | null {
  if (!sale?.mode) return null
  if (sale.mode === 'digital' && sale.purchase_url) return 'purchase'
  if (sale.mode === 'physique' && sale.owner_whatsapp && sale.owner_whatsapp.replace(/\D/g, '').length >= 8) return 'contact'
  return null
}

function saleInstructions(ctx: AiContext): string {
  const v = ctx.brand_voice ?? {}
  const ready = saleReady(ctx.sale)
  if (ready === 'purchase') {
    return `
CONCLURE LA VENTE (produit digital)
Dès que le prospect est prêt à acheter (il demande comment acheter, commander, payer, s'inscrire, ou dit oui),
donne-lui le lien d'achat en écrivant EXACTEMENT ${PURCHASE_PLACEHOLDER} à l'endroit du lien (n'écris aucune URL),
avec une phrase simple sur ce qu'il obtient. Mets "closing_action" à "purchase".
Ne donne pas le lien tant qu'il n'a pas montré d'intérêt : d'abord comprendre son besoin et répondre à ses questions.`
  }
  if (ready === 'contact') {
    const owner = ctx.sale?.owner_name || v.sender_name || 'le vendeur'
    return `
CONCLURE LA VENTE (produit physique)
Dès que le prospect est prêt à acheter (prix accepté, demande de commande, de livraison, de disponibilité, ou il dit oui),
mets-le en contact avec ${owner} sur WhatsApp pour finaliser (paiement, livraison, retrait) :
écris EXACTEMENT ${CONTACT_PLACEHOLDER} à l'endroit du lien (n'écris aucune URL ni numéro), et dis-lui que ${owner} l'attend.
Mets "closing_action" à "contact".
Ne transmets pas le contact tant qu'il n'a pas montré d'intérêt réel.`
  }
  return `
CONCLURE LA VENTE
Aucun lien d'achat ni contact de vente n'est configuré. Quand le prospect est prêt à acheter, demande-lui son numéro WhatsApp
pour que ${v.sender_name ?? 'l\'équipe'} le recontacte et finalise. Ne promets aucun délai précis.`
}

export function buildAutopilotSystem(ctx: AiContext, channel: Channel = ctx.conversation?.channel ?? 'whatsapp'): string {
  const v = ctx.brand_voice ?? {}
  const p = ctx.product
  const base = buildDraftSystem(ctx, channel, 'reply')
    .replace(/Propose \d+ variantes[^\n]*\n/, '')
    .replace(/Réponds UNIQUEMENT en JSON :[\s\S]*$/, '')
  // Avec une vente configurée, l'appel est remplacé par le lien d'achat / le contact.
  const closing = saleReady(ctx.sale) && ctx.closing?.next_action === 'propose_call' ? '' : closingInstructions(ctx)
  return `${base}
MODE AGENT COMMERCIAL AUTONOME
Tu es l'agent commercial de ${v.sender_name ?? 'l\'entreprise'} et tu réponds seul, en direct, sur ${CHANNEL_LABEL[channel]}. Écris UNE seule réponse, la meilleure.
${p ? `Tu vends « ${p.name} ». Tu connais ce produit par cœur grâce à la description et aux CONNAISSANCES PRODUIT : c'est TOI qui le présentes.
- Si le prospect ne sait pas de quoi il s'agit, dit juste « bonjour », « info », « intéressé » ou réagit à une publication : présente le produit en 1 ou 2 phrases (ce que c'est, le bénéfice principal), puis pose UNE question sur son besoin.
- Ne demande jamais au prospect de quel produit il parle.` : 'Aucun produit n\'est renseigné : réponds poliment, demande au prospect ce qu\'il recherche et préviens l\'utilisateur (escalate = true).'}
Objectif : comprendre le besoin, répondre aux questions et objections, puis conclure la vente quand le prospect est chaud.
Tu peux donner un prix ou une condition s'ils figurent dans les CONNAISSANCES PRODUIT ; n'invente jamais un prix, une remise ou un délai.
Tu restes TOUJOURS en charge de la conversation : tu ne t'arrêtes jamais de toi-même et tu réponds à chaque message.
"escalate" sert uniquement à PRÉVENIR ${v.sender_name ?? 'l\'utilisateur'} (il reçoit une alerte, toi tu continues). Mets escalate = true seulement si :
- le prospect demande explicitement à parler à un humain, ou se plaint ;
- il pose une question importante dont la réponse n'est pas dans les CONNAISSANCES PRODUIT (prix spécial, commande particulière…).
Même dans ces cas, réponds : dis que tu transmets la question à ${v.sender_name ?? 'l\'équipe'}, puis continue à l'aider sur le reste.
Une information manquante n'est jamais une raison de t'arrêter : pose une question, ou propose ce que tu sais.
${closing}
${saleInstructions(ctx)}

Réponds UNIQUEMENT en JSON :
{"text": "", "language": "fr", "formality": "vous", "sensitive": {"is": false, "topics": []}, "escalate": {"is": false, "reason": ""}, "closing_action": null}`
}

export type ClosingAction = 'presentation' | 'call' | 'purchase' | 'contact' | null

export interface AutopilotReply {
  closing_action: ClosingAction
  text: string
  sensitive: boolean
  topics: string[]
  escalate: boolean
  reason: string | null
}

const CLOSING_ACTIONS = ['presentation', 'call', 'purchase', 'contact']

// Montants (≥ 3 chiffres) cités dans un texte, chiffres seuls.
function amounts(text: string): string[] {
  return (text.match(/\d[\d\s.,]*\d|\d{3,}/g) ?? []).map((a) => a.replace(/\D/g, '')).filter((a) => a.length >= 3)
}

// Pour un agent de vente, parler du prix ou du paiement est normal : ces sujets ne bloquent
// la réponse que si un montant cité n'est pas dans les connaissances (prix inventé).
export function salesTopics(topics: string[], text: string, knowledge: string | null | undefined): string[] {
  const known = (knowledge ?? '').replace(/[\s.,]/g, '')
  const invented = amounts(text).some((a) => !known.includes(a))
  return topics.filter((t) => (t === 'prix' || t === 'paiement') ? invented : true)
}

export function normalizeAutopilot(
  raw: Record<string, unknown>, lastInbound: string, channel: Channel = 'whatsapp', knowledge?: string | null,
): AutopilotReply {
  const max = draftFormat(channel, 'reply').max
  let text = String(raw.text ?? '').trim()
  if (text.length > max) {
    const cut = text.slice(0, max)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    text = end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…'
  }
  const e = (raw.escalate ?? {}) as { is?: unknown; reason?: unknown }
  const s = (raw.sensitive ?? {}) as { topics?: unknown }
  const declared = (Array.isArray(s.topics) ? s.topics.map(String) : [])
    .map((t) => t.toLowerCase())
    .map((t) => /prix|tarif|price|co[uû]t/.test(t) ? 'prix' : /paie|pay/.test(t) ? 'paiement' : t)
  const topics = salesTopics([...new Set([...declared, ...detectSensitive(text), ...detectSensitive(lastInbound)])], text, knowledge)
  return {
    closing_action: CLOSING_ACTIONS.includes(String(raw.closing_action)) ? raw.closing_action as ClosingAction : null,
    text,
    sensitive: topics.length > 0,
    topics,
    escalate: e.is === true || !text,
    reason: e.is === true ? String(e.reason ?? 'demande de l\'IA') : !text ? 'réponse vide' : null,
  }
}

// Lien WhatsApp vers le propriétaire, message pré-rempli pour qu'il sache d'où vient le client.
export function ownerContactLink(sale: AiContext['sale'], productName?: string, prospectName?: string | null): string | null {
  const digits = (sale?.owner_whatsapp ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const phone = digits.length === 9 && /^[62]/.test(digits) ? `237${digits}` : digits
  const text = `Bonjour${sale?.owner_name ? ` ${sale.owner_name}` : ''}, je suis ${prospectName || 'intéressé(e)'} et je souhaite commander${productName ? ` « ${productName} »` : ''}.`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

// Insère le lien d'achat ou de contact ; la vente n'est « conclue » que si le lien figure dans le message.
export function applySaleLinks(
  text: string, ctx: AiContext, action: ClosingAction,
): { text: string; step: 'purchase_link_sent' | 'owner_contact_sent' | null } {
  const ready = saleReady(ctx.sale)
  const link = ready === 'purchase' ? ctx.sale!.purchase_url!
    : ready === 'contact' ? ownerContactLink(ctx.sale, ctx.product?.name, ctx.prospect?.full_name) : null
  let out = text
  const placeholder = ready === 'purchase' ? PURCHASE_PLACEHOLDER : CONTACT_PLACEHOLDER
  if (link) {
    if (out.includes(placeholder)) out = out.split(placeholder).join(link)
    else if (action === ready) out = `${out.trim()}\n${link}`
  }
  out = out.split(PURCHASE_PLACEHOLDER).join('').split(CONTACT_PLACEHOLDER).join('').trim()
  const step = link && out.includes(link) ? (ready === 'purchase' ? 'purchase_link_sent' : 'owner_contact_sent') : null
  return { text: out, step }
}

// Insère les vrais liens et détermine l'étape de closing réellement franchie.
export function applyClosingLinks(
  text: string,
  closing: AiContext['closing'],
  action: ClosingAction,
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

// ---------- Publications Facebook / Instagram ----------

export interface PostDraft { channel: 'facebook' | 'instagram'; body: string; angle: string; image_idea: string }

export function buildPostsSystem(ctx: Pick<AiContext, 'brand_voice' | 'product'>, channels: ('facebook' | 'instagram')[], count: number): string {
  const v = ctx.brand_voice ?? {}
  return `Tu es le community manager de ${v.sender_name ?? 'l\'entreprise'}. Tu écris des publications qui attirent des clients pour « ${ctx.product?.name ?? 'le produit'} ».
But : provoquer des commentaires et des messages privés. Un agent IA répond ensuite en privé à chaque commentaire et conclut la vente.

RÈGLES
- ${count} publication(s) par réseau parmi : ${channels.join(', ')}. Chaque publication a un angle différent (problème/solution, témoignage type, question, bénéfice, offre, coulisses).
- Accroche forte dans la première ligne, phrases courtes, langage simple, ton : ${ctx.product?.tone ?? 'chaleureux et direct'}.
- N'affirme que ce qui figure dans la description et les CONNAISSANCES PRODUIT. Un prix uniquement s'il y figure. N'invente AUCUN témoignage, citation de client (« ils nous disent… »), statistique ni promesse de résultat chiffrée.
- Termine par un appel à l'action qui pousse à COMMENTER ou à écrire en privé (ex. « Commentez INFO et on vous écrit en privé »).
- Aucun lien dans le texte.
- facebook : 300 à 900 caractères, 0 à 3 émojis, 0 à 2 hashtags.
- instagram : légende de 300 à 1500 caractères, émojis bienvenus, 5 à 10 hashtags pertinents à la fin.
- image_idea : description courte du visuel idéal (Instagram exige une image).
- Langue : ${ctx.product ? 'celle de la cible du produit (français par défaut)' : 'français'}. ${v.formality === 'tu' ? 'Tutoiement.' : 'Vouvoiement.'}

Réponds UNIQUEMENT en JSON :
{"posts": [{"channel": "facebook", "body": "", "angle": "", "image_idea": ""}]}`
}

export function buildPostsUser(ctx: Pick<AiContext, 'product'>, brief?: string): string {
  const p = ctx.product
  return JSON.stringify({
    produit: p && { nom: p.name, description: p.description, cible: p.target, accroches: p.hooks ?? [], segments: p.segments ?? [] },
    'CONNAISSANCES PRODUIT': p?.knowledge || p?.description || '',
    consigne_utilisateur: brief || null,
  })
}

export function normalizePosts(raw: Record<string, unknown>, channels: ('facebook' | 'instagram')[]): PostDraft[] {
  const max = { facebook: 2000, instagram: 2200 }
  return (Array.isArray(raw.posts) ? raw.posts : [])
    .map((p: Record<string, unknown>) => ({
      channel: p?.channel === 'instagram' ? 'instagram' as const : 'facebook' as const,
      body: String(p?.body ?? '').trim(),
      angle: String(p?.angle ?? '').slice(0, 120),
      image_idea: String(p?.image_idea ?? '').slice(0, 300),
    }))
    .filter((p) => p.body && channels.includes(p.channel))
    .map((p) => ({ ...p, body: p.body.slice(0, max[p.channel]) }))
    .slice(0, 12)
}

// ---------- Réponse privée à un commentaire ----------

export function buildCommentSystem(ctx: AiContext, channel: Channel): string {
  const auto = buildAutopilotSystem(ctx, channel).replace(/Réponds UNIQUEMENT en JSON :[\s\S]*$/, '')
  return `${auto}
PREMIER MESSAGE APRÈS UN COMMENTAIRE
Le prospect vient de commenter une publication (texte fourni). Tu lui écris en PRIVÉ pour la première fois :
- remercie-le en reprenant son commentaire en quelques mots ;
- s'il pose une question, réponds-y avec les CONNAISSANCES PRODUIT ; sinon présente le produit en 1 ou 2 phrases ;
- termine par UNE question simple sur son besoin. Pas de lien d'achat dans ce premier message, sauf s'il demande explicitement comment acheter.
- public_reply : courte réponse publique sous son commentaire (ex. « Merci ! Je vous ai écrit en privé 📩 »), sans prix ni lien.
- Si le commentaire est négatif, une insulte ou du spam : "skip" à true (aucune réponse).

Réponds UNIQUEMENT en JSON :
{"text": "", "public_reply": "", "skip": false, "language": "fr", "sensitive": {"is": false, "topics": []}, "escalate": {"is": false, "reason": ""}, "closing_action": null}`
}
