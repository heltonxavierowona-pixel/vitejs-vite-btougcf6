import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ChannelBadge from '../components/ChannelBadge'
import { decideApproval, listApprovals } from '../lib/api'
import type { Approval } from '../lib/types'

const TOPIC_LABEL: Record<string, string> = {
  prix: 'Prix', remise: 'Remise', contrat: 'Contrat / devis', paiement: 'Paiement', remboursement: 'Remboursement',
}

function remaining(expires: string | null): { text: string; urgent: boolean; expired: boolean } {
  if (!expires) return { text: '', urgent: false, expired: false }
  const ms = new Date(expires).getTime() - Date.now()
  if (ms <= 0) return { text: 'Fenêtre de 24 h fermée', urgent: true, expired: true }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return { text: `Envoi possible encore ${h ? `${h} h ` : ''}${m} min`, urgent: ms < 2 * 3_600_000, expired: false }
}

function ApprovalCard({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [text, setText] = useState(approval.proposed_body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const edited = text.trim() !== approval.proposed_body.trim()
  const time = remaining(approval.expires_at)

  async function decide(decision: 'approve' | 'edit' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      await decideApproval(approval.id, decision, decision === 'edit' ? text : undefined)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <article className="card approval">
      <div className="card-head">
        <h2>
          {approval.prospect_name} <ChannelBadge id={approval.channel} />
        </h2>
        <span className={`small ${time.urgent ? 'urgent' : 'muted'}`}>{time.text}</span>
      </div>
      <div className="chips">
        {approval.topics.map((t) => <span key={t} className="pchip pchip-objection">{TOPIC_LABEL[t] ?? t}</span>)}
      </div>

      {approval.context.length > 0 && (
        <div className="approval-context">
          {approval.context.map((m, i) => <p key={i} className="bubble bubble-inbound">{m.text}</p>)}
        </div>
      )}

      <label className="approval-label">
        Réponse proposée par l'IA {edited && <span className="tag">modifiée</span>}
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button className="btn" disabled={busy || time.expired || !text.trim()} onClick={() => decide(edited ? 'edit' : 'approve')}>
          {edited ? 'Envoyer ma version' : 'Approuver et envoyer'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => decide('reject')}>Rejeter</button>
        <Link className="btn btn-ghost" to="/conversations">Voir la conversation</Link>
      </div>
    </article>
  )
}

export default function ValidationsPage() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const load = useCallback(() => listApprovals().then(setApprovals), [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Pilote automatique</p>
        <h1>Validations</h1>
        <p className="lead">
          L'IA converse seule sur WhatsApp, sauf quand il s'agit de prix, remise, devis, contrat ou paiement :
          sa réponse attend ici votre accord. Vous pouvez la modifier avant de l'envoyer.
        </p>
      </header>

      {approvals && approvals.length === 0 && (
        <p className="card empty muted">Rien à valider pour le moment.</p>
      )}
      <div className="approval-list">
        {approvals?.map((a) => <ApprovalCard key={a.id} approval={a} onDone={load} />)}
      </div>
    </>
  )
}
