import { useEffect, useState } from 'react'
import { getBrandVoice, saveBrandVoice } from '../lib/api'
import type { BrandVoice } from '../lib/types'

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
    </>
  )
}
