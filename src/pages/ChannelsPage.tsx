import { useEffect, useState } from 'react'
import { CHANNELS, type ChannelId } from '../data/channels'
import { connectMeta, connectWhatsApp, isDemo, listAccounts } from '../lib/api'
import { facebookLoginForBusiness, metaConfigured, whatsappEmbeddedSignup } from '../lib/meta'
import type { ChannelAccount } from '../lib/types'

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = () => listAccounts().then(setAccounts)
  useEffect(() => {
    reload()
  }, [])

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

  const connectFbIg = () =>
    run('meta', async () => {
      const { connected } = await connectMeta(await facebookLoginForBusiness())
      return `Connecté : ${connected.map((c: { label: string }) => c.label).join(', ')}`
    })

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
