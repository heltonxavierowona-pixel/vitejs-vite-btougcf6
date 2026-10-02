import { useEffect, useState } from 'react'
import {
  getAlertSettings, getAutomation, getBrandVoice, isDemo, saveAlertSettings, saveAutomation, saveBrandVoice,
  sendTestAlert, telegramConfigured, telegramConnectUrl, unlinkTelegram,
} from '../lib/api'
import type { AlertSettings, Automation, BrandVoice } from '../lib/types'

const EVENTS: { key: keyof AlertSettings['events']; label: string }[] = [
  { key: 'hot', label: '🔥 Un prospect devient chaud' },
  { key: 'approval', label: '⏸ Une réponse de l\'IA attend ma validation' },
  { key: 'escalation', label: '🙋 L\'IA me passe la main' },
  { key: 'won', label: '🏆 Une vente est gagnée' },
]

// Alertes immédiates (Partie 7) : Telegram et/ou e-mail.
function AlertsForm() {
  const [a, setA] = useState<AlertSettings | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const load = () => getAlertSettings().then(setA)
  useEffect(() => {
    getAlertSettings().then(setA)
  }, [])
  if (!a) return null
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null)
    try {
      await fn()
      setMessage({ kind: 'ok', text: ok })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <form
      className="card form narrow"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => saveAlertSettings({ email: a.email?.trim() || null, events: a.events }), 'Enregistré.')
      }}
    >
      <h2>Alertes</h2>
      <p className="muted small">Prévenu tout de suite, sur votre téléphone, quand quelque chose demande votre attention.</p>

      <div className="alert-channel">
        <strong>Telegram</strong>
        {a.telegram_linked ? (
          <>
            <span className="connected">● Connecté{a.telegram_username ? ` (@${a.telegram_username})` : ''}</span>
            <button type="button" className="link small" onClick={() => run(async () => { await unlinkTelegram(); await load() }, 'Telegram déconnecté.')}>Déconnecter</button>
          </>
        ) : (
          <button
            type="button" className="btn btn-ghost" disabled={!telegramConfigured}
            onClick={() => run(async () => {
              const url = await telegramConnectUrl()
              if (!isDemo) window.open(url, '_blank', 'noopener')
              await load()
            }, isDemo ? 'Démo : Telegram connecté.' : 'Dans Telegram, appuyez sur « Démarrer » : la connexion se fait toute seule.')}
          >
            Connecter Telegram
          </button>
        )}
      </div>

      <label>
        E-mail d'alerte
        <input type="email" value={a.email ?? ''} onChange={(e) => setA({ ...a, email: e.target.value })} placeholder="vous@entreprise.com" />
      </label>

      <fieldset className="events">
        <legend className="small muted">M'alerter quand…</legend>
        {EVENTS.map((ev) => (
          <label key={ev.key} className="check">
            <input type="checkbox" checked={a.events[ev.key]} onChange={(e) => setA({ ...a, events: { ...a.events, [ev.key]: e.target.checked } })} />
            <span>{ev.label}</span>
          </label>
        ))}
      </fieldset>

      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      <div className="actions">
        <button className="btn">Enregistrer</button>
        <button type="button" className="btn btn-ghost" disabled={isDemo || (!a.telegram_linked && !a.email)}
          onClick={() => run(sendTestAlert, 'Alerte de test envoyée.')}>
          Envoyer une alerte de test
        </button>
      </div>
    </form>
  )
}

// Automatisation de la bascule WhatsApp (Partie 4).
function AutomationForm() {
  const [a, setA] = useState<Automation | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    getAutomation().then(setA)
  }, [])
  if (!a) return null
  const update = (patch: Partial<Automation>) => {
    setSaved(false)
    setA({ ...a, ...patch })
  }
  return (
    <form
      className="card form narrow"
      onSubmit={async (e) => {
        e.preventDefault()
        await saveAutomation(a)
        setSaved(true)
      }}
    >
      <h2>Automatisation</h2>
      <p className="muted small">
        WhatsApp n'est proposé que lorsque l'intérêt est clair et explicite. Les réponses neutres ou négatives
        sont archivées sans relance ; une demande d'arrêt bloque définitivement le contact.
      </p>
      <label className="check">
        <input type="checkbox" checked={a.autopilot_whatsapp} onChange={(e) => update({ autopilot_whatsapp: e.target.checked })} />
        <span>
          Pilote automatique sur WhatsApp
          <small className="muted">L'IA répond seule, en texte. Prix, remise, devis, contrat et paiement passent par « Validations ».</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={a.autopilot_social} onChange={(e) => update({ autopilot_social: e.target.checked })} />
        <span>
          Agent commercial sur Messenger et Instagram
          <small className="muted">L'IA répond seule aux messages privés, présente le produit et conclut (lien d'achat ou contact WhatsApp du vendeur).</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={a.ai_comments !== false} onChange={(e) => update({ ai_comments: e.target.checked })} />
        <span>
          Répondre en privé aux commentaires
          <small className="muted">Chaque personne qui commente une publication reçoit un message privé de l'agent (sauf commentaires négatifs ou spam).</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={a.handoff_auto} onChange={(e) => update({ handoff_auto: e.target.checked })} />
        <span>
          Sur Facebook et Instagram, envoyer automatiquement la proposition WhatsApp
          <small className="muted">Sur LinkedIn et X, le message est toujours préparé pour que vous l'envoyiez.</small>
        </span>
      </label>
      <label>
        Certitude minimale de l'IA pour agir seule : <strong>{Math.round(a.min_confidence * 100)} %</strong>
        <input
          type="range" min={0.5} max={0.95} step={0.05} value={a.min_confidence}
          onChange={(e) => update({ min_confidence: Number(e.target.value) })}
        />
        <small className="muted">En dessous, le prospect passe dans « À vérifier » et c'est vous qui tranchez.</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={a.followups_enabled} onChange={(e) => update({ followups_enabled: e.target.checked })} />
        <span>
          Relancer les prospects intéressés restés silencieux
          <small className="muted">2 relances maximum, entre 8 h et 19 h, puis abandon. Toute réponse du prospect arrête les relances.</small>
        </span>
      </label>
      <div className="form-row two">
        <label>
          1re relance après (jours)
          <input type="number" min={1} max={14} value={a.followup_delays[0]}
            onChange={(e) => update({ followup_delays: [Math.max(1, Number(e.target.value) || 1), a.followup_delays[1]] })} />
        </label>
        <label>
          2e relance, puis abandon, après (jours)
          <input type="number" min={1} max={30} value={a.followup_delays[1]}
            onChange={(e) => update({ followup_delays: [a.followup_delays[0], Math.max(1, Number(e.target.value) || 1)] })} />
        </label>
      </div>
      {saved && <p className="success">Enregistré.</p>}
      <button className="btn">Enregistrer</button>
    </form>
  )
}

// Voix de marque : comment l'IA écrit au nom de l'utilisateur.
export default function SettingsPage() {
  const [voice, setVoice] = useState<BrandVoice | null>(null)
  const [banned, setBanned] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getBrandVoice().then((v) => {
      setVoice(v)
      setBanned((v.banned_phrases ?? []).join('\n'))
    })
  }, [])

  if (!voice) return null
  const set = <K extends keyof BrandVoice>(k: K, value: BrandVoice[K]) => {
    setSaved(false)
    setVoice({ ...voice, [k]: value })
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Paramètres</p>
        <h1>Voix de marque</h1>
        <p className="lead">
          L'IA écrit en votre nom. Elle part de ces réglages, puis s'adapte à chaque prospect : sa langue,
          le tutoiement s'il tutoie, la longueur de ses messages, ses émojis.
        </p>
      </header>

      <form
        className="card form narrow"
        onSubmit={async (e) => {
          e.preventDefault()
          await saveBrandVoice({
            ...voice,
            banned_phrases: banned.split('\n').map((b) => b.trim()).filter(Boolean),
          })
          setSaved(true)
        }}
      >
        <div className="form-row two">
          <label>
            Prénom affiché
            <input value={voice.sender_name ?? ''} onChange={(e) => set('sender_name', e.target.value)} placeholder="Awa" />
          </label>
          <label>
            Signature
            <input value={voice.signature ?? ''} onChange={(e) => set('signature', e.target.value)} placeholder="Awa – Wax & Co" />
          </label>
        </div>
        <div className="form-row two">
          <label>
            Par défaut
            <select value={voice.formality ?? 'vous'} onChange={(e) => set('formality', e.target.value as 'tu' | 'vous')}>
              <option value="vous">Vouvoiement</option>
              <option value="tu">Tutoiement</option>
            </select>
          </label>
          <label>
            Émojis
            <select value={voice.emojis === false ? 'non' : 'oui'} onChange={(e) => set('emojis', e.target.value === 'oui')}>
              <option value="oui">Autorisés (si le prospect en utilise)</option>
              <option value="non">Jamais</option>
            </select>
          </label>
        </div>
        <label>
          Phrases à ne jamais utiliser <span className="muted small">(une par ligne)</span>
          <textarea rows={3} value={banned} onChange={(e) => { setBanned(e.target.value); setSaved(false) }} />
        </label>
        {saved && <p className="success">Enregistré. Les prochains messages de l'IA en tiendront compte.</p>}
        <button className="btn">Enregistrer</button>
      </form>

      <AutomationForm />
      <AlertsForm />
    </>
  )
}
