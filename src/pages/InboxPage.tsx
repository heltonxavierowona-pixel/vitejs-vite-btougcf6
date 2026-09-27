import { useCallback, useEffect, useRef, useState } from 'react'
import ChannelBadge from '../components/ChannelBadge'
import DraftPanel from '../components/DraftPanel'
import ProfilePanel from '../components/ProfilePanel'
import {
  draftMessage, getProfile, isDemo, listConversations, logAssistedMessage, listMessages, markDraftUsed, markRead, refreshProfile, sendMessage,
  subscribeInbox, windowOpen,
} from '../lib/api'
import type { AiDraft, Conversation, Message, RelationalProfile } from '../lib/types'

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''

const STATUS_ICON: Record<string, string> = {
  queued: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠️', pending_approval: '⏸',
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<AiDraft | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [profile, setProfile] = useState<RelationalProfile | null>(null)
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

  // Nouveau message d'un client → la liste et le fil se mettent à jour.
  useEffect(
    () => subscribeInbox(() => {
      refresh()
      if (selected) loadMessages(selected)
    }),
    [selected, refresh, loadMessages],
  )

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages])

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
              {assisted ? (
                <span className="window window-open">Mode assisté : copier puis envoyer</span>
              ) : (
                <span className={`window ${open ? 'window-open' : 'window-closed'}`}>
                  {open ? 'Fenêtre 24 h ouverte' : 'Fenêtre 24 h fermée'}
                </span>
              )}
            </header>

            <div className="thread-body">
              {messages.map((m) => (
                <div key={m.id} className={`bubble bubble-${m.direction}`}>
                  <p>{m.body}</p>
                  <span className="bubble-meta">
                    {m.ai_generated && 'IA · '}
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
            </form>
          </section>
        ) : (
          <section className="thread empty-thread muted">Sélectionnez une conversation</section>
        )}

        {current && (
          <ProfilePanel
            profile={profile}
            onRefresh={isDemo ? undefined : async () => {
              await refreshProfile(current.id)
              setProfile(await getProfile(current.prospect_id))
            }}
          />
        )}
      </div>
    </>
  )
}
