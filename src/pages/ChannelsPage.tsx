import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CHANNELS, type ChannelId } from '../data/channels'
import { connectMeta, connectWhatsApp, isDemo, listAccounts } from '../lib/api'
import { facebookLoginRedirect, META_STATE_PREFIX, metaConfigured, metaRedirectUri, metaStateOk, whatsappEmbeddedSignup } from '../lib/meta'
import type { ChannelAccount } from '../lib/types'

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [params, setParams] = useSearchParams()
  const handled = useRef(false)

  const reload = () => listAccounts().then(setAccounts)
  useEffect(() => {
    reload()
  }, [])

  // Retour de Facebook Login for Business (redirection) : échange du code côté serveur.
  useEffect(() => {
    const state = params.get('state')
    if (handled.current || !state?.startsWith(META_STATE_PREFIX)) return
    handled.current = true
    const code = params.get('code')
    const denied = params.get('error_description') ?? params.get('error_reason')
    setParams({}, { replace: true })
    if (!code) {
      Promise.resolve().then(() => setMessage({ kind: 'error', text: `Connexion Facebook annulée${denied ? ` : ${denied}` : ''}` }))
      return
    }
    if (!metaStateOk(state)) {
      Promise.resolve().then(() => setMessage({ kind: 'error', text: 'Retour de Facebook non reconnu : recommencez la connexion.' }))
      return
    }
    run('meta', async () => {
      const { connected, warnings } = await connectMeta(code, metaRedirectUri())
      const warn = (warnings ?? []).length ? ` · Attention : ${warnings.join(' ; ')}` : ''
      return connected.length
        ? `Connecté : ${connected.map((c: { label: string }) => c.label).join(', ')}${warn}`
        : 'Aucune Page connectée : elle est peut-être déjà reliée à un autre compte Numera Agentic.'
    })
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key)
    setMessage(null)
    try {
      setMessage({ kind: 'ok', text: await fn() })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const connectWa = (coexistence: boolean) =>
    run(coexistence ? 'wa-coex' : 'wa-new', async () => {
      const result = await whatsappEmbeddedSignup(coexistence)
      const saved = await connectWhatsApp(result)
      return `WhatsApp connecté : ${saved.display_phone}`
    })

  const connectFbIg = () => {
    setBusy('meta')
    try {
      facebookLoginRedirect()
    } catch (e) {
      setBusy(null)
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const canConnect = metaConfigured && !isDemo
  const connectedOf = (id: ChannelId) => accounts.filter((a) => a.channel === id)

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Étape 2 · Vos comptes</p>
        <h1>Canaux</h1>
        <p className="lead">
          Connectez vos propres comptes. Vos clients continuent d'utiliser WhatsApp, Messenger et Instagram ;
          vous leur répondez depuis Numera Agentic.
        </p>
      </header>

      {!canConnect && (
        <p className="notice">
          {isDemo
            ? 'Mode démo : les boutons de connexion s\'activeront une fois Supabase configuré.'
            : 'App Meta non configurée (VITE_META_APP_ID, VITE_META_WA_CONFIG_ID, VITE_META_LOGIN_CONFIG_ID).'}
        </p>
      )}
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}

      <div className="grid">
        {CHANNELS.map((c) => {
          const connected = connectedOf(c.id)
          return (
            <section key={c.id} className="card channel" style={{ '--accent': c.color } as React.CSSProperties}>
              <div className="card-head">
                <h2><span className="dot" /> {c.name}</h2>
                <span className={`badge badge-${c.mode}`}>{c.mode === 'auto' ? 'Auto' : 'Assisté'}</span>
              </div>
              <p className="role">{c.role}</p>
              <dl className="facts">
                <dt>Premier message</dt><dd>{c.canColdMessage}</dd>
                <dt>API</dt><dd>{c.api}</dd>
              </dl>
              <ul className="notes">{c.notes.map((r) => <li key={r}>{r}</li>)}</ul>

              {connected.map((a) => (
                <p key={a.id} className="connected">
                  ● {a.label}{a.display_phone ? ` · ${a.display_phone}` : ''}{a.coexistence ? ' · coexistence' : ''}
                </p>
              ))}

              {c.id === 'whatsapp' && (
                <div className="actions">
                  <button className="btn" disabled={!canConnect || !!busy} onClick={() => connectWa(true)}>
                    {busy === 'wa-coex' ? 'Connexion…' : 'Garder mon numéro WhatsApp Business'}
                  </button>
                  <button className="btn btn-ghost" disabled={!canConnect || !!busy} onClick={() => connectWa(false)}>
                    {busy === 'wa-new' ? 'Connexion…' : 'Utiliser un nouveau numéro'}
                  </button>
                </div>
              )}
              {(c.id === 'facebook' || c.id === 'instagram') && (
                <div className="actions">
                  <button className="btn" disabled={!canConnect || !!busy} onClick={connectFbIg}>
                    {busy === 'meta' ? 'Connexion…' : 'Connecter Facebook et Instagram'}
                  </button>
                </div>
              )}
              {c.mode === 'assisted' && (
                <p className="muted small">
                  Pas de connexion : l'IA prépare les messages dans Numera Agentic, vous les envoyez depuis votre compte.
                </p>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
