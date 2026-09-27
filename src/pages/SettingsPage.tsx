import { useEffect, useState } from 'react'
import { getAutomation, getBrandVoice, saveAutomation, saveBrandVoice } from '../lib/api'
import type { Automation, BrandVoice } from '../lib/types'

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
      <h2>Bascule vers WhatsApp</h2>
      <p className="muted small">
        WhatsApp n'est proposé que lorsque l'intérêt est clair et explicite. Les réponses neutres ou négatives
        sont archivées sans relance ; une demande d'arrêt bloque définitivement le contact.
      </p>
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
    </>
  )
}
