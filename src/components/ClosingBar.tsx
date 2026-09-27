import { recordClosingStep, setOutcome } from '../lib/api'
import { callText, presentationText } from '../lib/closing'
import type { ClosingStep, Product, Prospect } from '../lib/types'

const STEPS: { id: ClosingStep; label: string }[] = [
  { id: 'presentation_sent', label: 'Présentation' },
  { id: 'call_proposed', label: 'Appel proposé' },
  { id: 'call_booked', label: 'Appel planifié' },
]
const ORDER: Record<ClosingStep, number> = { presentation_sent: 0, call_proposed: 1, call_booked: 2 }

// Avancement du closing + actions rapides : présentation, puis appel ; issue gagnée ou perdue.
export default function ClosingBar({
  prospect,
  product,
  onInsert,
  onChange,
}: {
  prospect: Prospect
  product: Product | null
  onInsert: (text: string, step: ClosingStep) => void
  onChange: () => void
}) {
  const current = prospect.closing_step ? ORDER[prospect.closing_step] : -1
  const done = prospect.stage === 'won' || prospect.stage === 'lost'
  const pres = product ? presentationText(product) : null

  return (
    <div className="closing-bar">
      <ol className="closing-steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i <= current ? 'done' : ''}>{i <= current ? '✓ ' : ''}{s.label}</li>
        ))}
      </ol>
      {done ? (
        <span className={`intent ${prospect.stage === 'won' ? 'intent-interested' : 'intent-negative'}`}>
          {prospect.stage === 'won' ? 'Gagné 🏆' : 'Perdu'}
        </span>
      ) : (
        <div className="closing-actions">
          {pres && current < 0 && (
            <button type="button" className="link small" onClick={() => onInsert(pres, 'presentation_sent')}>📎 Présentation</button>
          )}
          {product && current < 1 && (
            <button type="button" className="link small" onClick={() => onInsert(callText(product), 'call_proposed')}>📞 Proposer un appel</button>
          )}
          {current < 2 && (
            <button type="button" className="link small" onClick={async () => { await recordClosingStep(prospect.id, 'call_booked'); onChange() }}>
              ✅ Appel planifié
            </button>
          )}
          <button type="button" className="link small" onClick={async () => { await setOutcome(prospect.id, 'won'); onChange() }}>🏆 Gagné</button>
          <button type="button" className="link small muted" onClick={async () => { await setOutcome(prospect.id, 'lost'); onChange() }}>Perdu</button>
        </div>
      )}
    </div>
  )
}
