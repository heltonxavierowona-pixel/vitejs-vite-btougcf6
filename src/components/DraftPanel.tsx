import { useState } from 'react'
import type { AiDraft } from '../lib/types'

const LANG: Record<string, string> = { fr: 'Français', en: 'Anglais' }
const TOPIC: Record<string, string> = { prix: 'prix', remise: 'remise', contrat: 'contrat / devis', paiement: 'paiement' }

// Variantes proposées par l'IA. `onUse` reçoit le texte choisi (copie, ou remplissage du champ de réponse).
export default function DraftPanel({
  draft,
  useLabel,
  onUse,
  onClose,
}: {
  draft: AiDraft
  useLabel: string
  onUse: (text: string, index: number) => void
  onClose: () => void
}) {
  const [used, setUsed] = useState<number | null>(null)
  return (
    <div className="draft-panel">
      <div className="draft-head">
        <span className="badge badge-assisted">✨ {draft.source === 'ai' ? 'Proposé par l\'IA' : 'Brouillon démo'}</span>
        <span className="muted small">
          {LANG[draft.language] ?? draft.language} · {draft.formality === 'tu' ? 'tutoiement' : 'vouvoiement'}
        </span>
        <button type="button" className="link close" onClick={onClose} aria-label="Fermer">×</button>
      </div>

      {draft.sensitive.is && (
        <p className="notice">
          Sujet sensible : {draft.sensitive.topics.map((t) => TOPIC[t] ?? t).join(', ')}. Relisez avant d'envoyer
          (validation obligatoire à la Partie 5).
        </p>
      )}

      {draft.variants.map((v, i) => (
        <div key={i} className={`variant ${used === i ? 'used' : ''}`}>
          <p>{v.text}</p>
          <div className="variant-foot">
            <span className="muted small">{v.angle} · {v.text.length} caractères</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setUsed(i)
                onUse(v.text, i)
              }}
            >
              {used === i ? '✓' : useLabel}
            </button>
          </div>
        </div>
      ))}
      {draft.rationale && <p className="muted small">{draft.rationale}</p>}
    </div>
  )
}
