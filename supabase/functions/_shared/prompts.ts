// Prompts du cerveau IA (Partie 3). Fonctions pures : aucune dépendance Deno,
// testables avec Node. Voir docs/03-cerveau-ia.md.

export type Channel = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'whatsapp'
export type DraftKind = 'invitation' | 'opening' | 'reply'

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
  return CHANNEL_FORMAT[channel][kind] ?? CHANNEL_FORMAT[channel].reply ?? { max: 500, rules: '' }
}

// ---------- Rédaction ----------

export function buildDraftSystem(ctx: AiContext, channel: Channel, kind: DraftKind): string {
  const v = ctx.brand_voice ?? {}
  const f = draftFormat(channel, kind)
  const variants = kind === 'reply' ? 2 : 3
  return `Tu écris au nom de ${v.sender_name ?? 'l\'utilisateur'}, qui vend « ${ctx.product?.name ?? 'son offre'} ».
Tu rédiges ${kind === 'reply' ? 'une réponse' : 'un premier message'} de prospection, comme un humain attentionné, jamais comme une publicité.

FORMAT DU CANAL
${f.rules}
Longueur maximale : ${f.max} caractères par variante.

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
