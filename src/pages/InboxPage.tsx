import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ChannelBadge from '../components/ChannelBadge'
import ClosingBar from '../components/ClosingBar'
import DraftPanel from '../components/DraftPanel'
import ProfilePanel from '../components/ProfilePanel'
import {
  draftMessage, getProduct, getProfile, getProspect, isDemo, recordClosingStep, listConversations, listMergeCandidates, logAssistedMessage, mergeProspects,
  setAiPaused, simulateClientMessage, listMessages, markDraftUsed, markRead, refreshProfile, sendMessage,
  subscribeInbox, windowOpen,
} from '../lib/api'
import type { AiDraft, ClosingStep, Conversation, Message, Product, Prospect, RelationalProfile } from '../lib/types'

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''

function pauseLabel(reason: string | null | undefined): string {
  if (!reason) return 'IA en pause'
  if (reason === 'human_reply') return 'Vous avez repris la main'
  if (reason === 'manual') return 'IA mise en pause'
  if (reason === 'converted') return 'Client converti : lien d\'achat ou contact du vendeur envoyé, l\'IA s\'est retirée'
  if (reason.startsWith('escalation:')) return `L'IA vous passe la main : ${reason.slice(11)}`
  return 'IA en pause'
}

const STATUS_ICON: Record<string, string> = {
  queued: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠️', pending_approval: '⏸',
}

export default function InboxPage() {
  // ?c=<id> : ouverture directe depuis une alerte Telegram / e-mail ou le tableau de bord.
  const [params] = useSearchParams()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(params.get('c'))
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<AiDraft | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [profile, setProfile] = useState<RelationalProfile | null>(null)
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [pendingStep, setPendingStep] = useState<ClosingStep | null>(null)
  const [simText, setSimText] = useState('')
  const [simResult, setSimResult] = useState<string | null>(null)
  const [mergeList, setMergeList] = useState<{ id: string; full_name: string | null; source: string | null }[] | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const refresh = useCallback(
    () => listConversations().then((list) => {
      setConversations(list)
      setSelected((s) => s ?? list[0]?.id ?? null)
    }),
    [],
  )

  const loadMessages = useCallback((id: string) => listMessages(id).then(setMessages), [])

  useEffect(() => {
    listConversations().then((list) => {
      setConversations(list)
      setSelected((s) => s ?? list[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    listMessages(selected).then(setMessages)
    markRead(selected).then(refresh)
  }, [selected, refresh])

  const prospectId = conversations.find((c) => c.id === selected)?.prospect_id
  useEffect(() => {
    if (prospectId) getProfile(prospectId).then(setProfile)
  }, [prospectId, messages])

  const loadProspect = useCallback((id: string) => getProspect(id).then(async (p) => {
    setProspect(p)
    setProduct(await getProduct(p?.product_id ?? null))
  }), [])
  useEffect(() => {
    if (prospectId) loadProspect(prospectId)
  }, [prospectId, messages, loadProspect])

  // Nouveau message d'un client → la liste et le fil se mettent à jour.
  useEffect(
    () => subscribeInbox(() => {
      refresh()
      if (selected) loadMessages(selected)
    }),
    [selected, refresh, loadMessages],
  )

  // Accolades : sur les navigateurs récents scrollIntoView renvoie une promesse, que React
  // prendrait pour une fonction de nettoyage (« … is not a function »).
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const current = conversations.find((c) => c.id === selected)
  // LinkedIn / X : pas d'API d'envoi, l'utilisateur copie la réponse et l'envoie lui-même.
  const assisted = current?.channel === 'linkedin' || current?.channel === 'x'
  const open = current ? assisted || windowOpen(current) : false

  async function suggest() {
    if (!current) return
    setSuggesting(true)
    setError(null)
    try {
      setSuggestion(await draftMessage({
        kind: 'reply',
        prospect: { id: current.prospect_id, full_name: current.prospect_name },
        conversation: current,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSuggesting(false)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!current || !draft.trim()) return
    setError(null)
    try {
      if (assisted) {
        await navigator.clipboard?.writeText(draft.trim()).catch(() => {})
        await logAssistedMessage(current.prospect_id, 'outbound', draft.trim())
      } else {
        await sendMessage(current.id, draft.trim())
      }
      // Étape de closing insérée par un bouton et toujours présente dans le message envoyé.
      const c = product?.closing
      if (pendingStep === 'presentation_sent' && c?.presentation_url && draft.includes(c.presentation_url)) {
        await recordClosingStep(current.prospect_id, 'presentation_sent')
      } else if (pendingStep === 'call_proposed' && (!c?.booking_url || draft.includes(c.booking_url))) {
        await recordClosingStep(current.prospect_id, 'call_proposed')
      }
      setPendingStep(null)
      setDraft('')
      setSuggestion(null)
      await Promise.all([loadMessages(current.id), refresh()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Boîte de réception</p>
        <h1>Conversations</h1>
        <p className="lead">Vos clients écrivent sur WhatsApp, Messenger ou Instagram. Vous répondez d'ici.</p>
      </header>

      <div className="inbox card">
        <aside className="inbox-list">
          {conversations.length === 0 && <p className="muted pad">Aucune conversation pour l'instant.</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`inbox-item ${c.id === selected ? 'active' : ''}`}
              onClick={() => {
                setSelected(c.id)
                setSuggestion(null)
                setDraft('')
                setSimResult(null)
                setMergeList(null)
              }}
            >
              <div className="inbox-item-top">
                <strong>{c.prospect_name}</strong>
                <span className="muted small">{time(c.last_message_at)}</span>
              </div>
              <div className="inbox-item-bottom">
                <ChannelBadge id={c.channel} />
                <span className="preview">{c.last_message_preview}</span>
                {c.unread_count > 0 && <span className="unread">{c.unread_count}</span>}
              </div>
            </button>
          ))}
        </aside>

        {current ? (
          <section className="thread">
            <header className="thread-head">
              <strong>{current.prospect_name}</strong>
              <ChannelBadge id={current.channel} />
              {!assisted && (
                <label className="switch autopilot" title="Pilote automatique : l'IA répond seule (sauf sujets sensibles)">
                  <input
                    type="checkbox"
                    checked={!current.ai_paused}
                    onChange={async (e) => { await setAiPaused(current.id, !e.target.checked); refresh() }}
                  />
                  Pilote auto
                </label>
              )}
              {assisted ? (
                <span className="window window-open">Mode assisté : copier puis envoyer</span>
              ) : (
                <span className={`window ${open ? 'window-open' : 'window-closed'}`}>
                  {open ? 'Fenêtre 24 h ouverte' : 'Fenêtre 24 h fermée'}
                </span>
              )}
            </header>

            {prospect && (
              <ClosingBar
                prospect={prospect}
                product={product}
                onInsert={(text, step) => {
                  setDraft((d) => (d.trim() ? `${d.trim()}\n${text}` : text))
                  setPendingStep(step)
                }}
                onChange={() => loadProspect(current.prospect_id)}
              />
            )}
            {current.ai_paused && !assisted && (
              <p className={`pause-banner ${current.ai_paused_reason?.startsWith('escalation:') ? 'escalation' : ''}`}>
                {pauseLabel(current.ai_paused_reason)}. Réactivez le pilote quand vous voulez.
              </p>
            )}
            <div className="thread-body">
              {messages.map((m) => (
                <div key={m.id} className={`bubble bubble-${m.direction} bubble-${m.status}`}>
                  <p>{m.body}</p>
                  {m.status === 'pending_approval' && (
                    <Link className="bubble-pending" to="/validations">En attente de votre validation →</Link>
                  )}
                  <span className="bubble-meta">
                    {m.ai_generated && 'IA · '}
                    {m.status === 'rejected' && 'rejeté · '}
                    {time(m.sent_at)}
                    {m.direction === 'outbound' && ` ${STATUS_ICON[m.status] ?? ''}`}
                  </span>
                </div>
              ))}
              <div ref={bottom} />
            </div>

            <form className="composer" onSubmit={send}>
              {error && <p className="error">{error}</p>}
              {suggestion && (
                <DraftPanel
                  draft={suggestion}
                  useLabel="Utiliser"
                  onUse={(text, i) => {
                    setDraft(text)
                    markDraftUsed(suggestion, i)
                  }}
                  onClose={() => setSuggestion(null)}
                />
              )}
              {!open && (
                <p className="notice">
                  Le client n'a pas écrit depuis plus de 24 h : Meta n'autorise qu'un modèle de message approuvé
                  (disponible à la Partie 6).
                </p>
              )}
              <div className="composer-row">
                <textarea
                  rows={2}
                  value={draft}
                  disabled={!open}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) send(e)
                  }}
                  placeholder={open ? 'Votre réponse… (Entrée pour envoyer)' : 'Réponse libre indisponible'}
                />
                <div className="composer-actions">
                  <button type="button" className="btn btn-ghost" disabled={!open || suggesting} onClick={suggest}>
                    {suggesting ? 'Rédaction…' : '✨ Suggérer'}
                  </button>
                  <button className="btn" disabled={!open || !draft.trim()}>{assisted ? 'Copier' : 'Envoyer'}</button>
                </div>
              </div>
              {!assisted && !current.ai_paused && (
                <p className="muted small">Si vous répondez vous-même, le pilote automatique se met en pause.</p>
              )}
            </form>
            {isDemo && !assisted && (
              <form
                className="simulator"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!simText.trim()) return
                  const r = await simulateClientMessage(current.id, simText.trim())
                  setSimResult({
                    sent: 'L\'IA a répondu seule.',
                    pending_approval: 'Sujet sensible : réponse de l\'IA mise en attente dans Validations.',
                    escalated: 'L\'IA a passé la main (voir le bandeau).',
                    skipped: 'Pilote en pause : pas de réponse automatique.',
                  }[r] ?? r)
                  setSimText('')
                  await Promise.all([loadMessages(current.id), refresh()])
                }}
              >
                <span className="muted small">Démo : écrire comme le client</span>
                <input value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="Ex. Et le prix ? / Je veux parler à quelqu'un / Vous livrez à Yaoundé ?" />
                <button className="btn btn-ghost">Simuler</button>
                {simResult && <span className="small sim-result">{simResult}</span>}
              </form>
            )}
          </section>
        ) : (
          <section className="thread empty-thread muted">Sélectionnez une conversation</section>
        )}

        {current && (
          <div className="side-panel">
            <ProfilePanel
              profile={profile}
              onRefresh={isDemo ? undefined : async () => {
                await refreshProfile(current.id)
                setProfile(await getProfile(current.prospect_id))
              }}
            />
            <div className="merge">
              {mergeList === null ? (
                <button className="link small" onClick={async () => setMergeList(await listMergeCandidates(current.prospect_id))}>
                  Même personne qu'une autre fiche ? Fusionner
                </button>
              ) : (
                <label className="small">
                  Rattacher à {current.prospect_name} la fiche :
                  <select
                    defaultValue=""
                    onChange={async (e) => {
                      const other = mergeList.find((m) => m.id === e.target.value)
                      if (!other || !window.confirm(`Fusionner « ${other.full_name ?? 'Sans nom'} » dans « ${current.prospect_name} » ? Ses conversations et son historique seront regroupés.`)) return
                      await mergeProspects(current.prospect_id, other.id)
                      setMergeList(null)
                      refresh()
                    }}
                  >
                    <option value="" disabled>Choisir…</option>
                    {mergeList.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? 'Sans nom'}{m.source ? ` · ${m.source}` : ''}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
