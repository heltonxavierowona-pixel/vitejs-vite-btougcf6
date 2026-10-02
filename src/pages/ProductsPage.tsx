import { useEffect, useState } from 'react'
import ChannelBadge from '../components/ChannelBadge'
import { channelInfo } from '../data/channels'
import { analyzeProduct, createProduct, listProducts, saveProductClosing, saveProductKnowledge, saveProductSale, uploadPostImage } from '../lib/api'
import type { Audience, OfferType, PriceLevel, Product, ProductAnalysis, ProductClosing, ProductInput, ProductSale } from '../lib/types'

const ROLE_LABEL = { outbound: 'Aller chercher', inbound: 'Attirer', closing: 'Conclure' } as const

const EMPTY: ProductInput = {
  name: '', description: '', offer_type: 'service', audience: 'b2b', target: '', countries: [], price_level: 'moyen',
}

function ProductForm({ onCreated }: { onCreated: (p: Product) => void }) {
  const [form, setForm] = useState(EMPTY)
  const [countries, setCountries] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await createProduct({
        ...form,
        countries: countries.split(',').map((c) => c.trim()).filter(Boolean),
      })
      onCreated(await analyzeProduct(created))
      setForm(EMPTY)
      setCountries('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Nouveau produit</h2>
      <label>
        Nom
        <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex. Core HR" />
      </label>
      <label>
        Que vendez-vous ?
        <textarea
          required rows={3} value={form.description} onChange={(e) => set('description', e.target.value)}
          placeholder="Décrivez le produit, le problème qu'il résout, ce qui le différencie."
        />
      </label>
      <label>
        À qui ?
        <input value={form.target} onChange={(e) => set('target', e.target.value)} placeholder="Ex. DRH de PME, jeunes mamans, restaurateurs…" />
      </label>
      <div className="form-row">
        <label>
          Type
          <select value={form.offer_type} onChange={(e) => set('offer_type', e.target.value as OfferType)}>
            <option value="saas">Logiciel / SaaS</option>
            <option value="service">Service</option>
            <option value="physique">Produit physique</option>
            <option value="formation">Formation</option>
            <option value="autre">Autre</option>
          </select>
        </label>
        <label>
          Clients
          <select value={form.audience} onChange={(e) => set('audience', e.target.value as Audience)}>
            <option value="b2b">Entreprises</option>
            <option value="b2c">Particuliers</option>
            <option value="mixte">Les deux</option>
          </select>
        </label>
        <label>
          Prix
          <select value={form.price_level} onChange={(e) => set('price_level', e.target.value as PriceLevel)}>
            <option value="bas">Bas</option>
            <option value="moyen">Moyen</option>
            <option value="eleve">Élevé</option>
          </select>
        </label>
      </div>
      <label>
        Pays visés
        <input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="Cameroun, Sénégal, France" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Analyse en cours…' : 'Analyser et trouver les bons réseaux'}</button>
    </form>
  )
}

function Analysis({ a }: { a: ProductAnalysis }) {
  const prospecting = a.channels.filter((c) => c.role !== 'closing')
  const closing = a.channels.find((c) => c.role === 'closing')
  return (
    <>
      <p className="lead">{a.summary}</p>

      <h3 className="section-title">Réseaux recommandés</h3>
      <ol className="ranking">
        {prospecting.map((c) => (
          <li key={c.channel}>
            <div className="ranking-head">
              <ChannelBadge id={c.channel} />
              <span className={`badge badge-${c.mode}`}>{ROLE_LABEL[c.role]} · {c.mode === 'auto' ? 'auto' : 'assisté'}</span>
              <span className="score">{c.score}</span>
            </div>
            <div className="bar"><div style={{ width: `${c.score}%`, background: channelInfo(c.channel).color }} /></div>
            {c.reasons.length > 0 && <ul className="reasons">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            <p className="approach">{c.approach}</p>
          </li>
        ))}
      </ol>

      {closing && (
        <div className="closing-box">
          <ChannelBadge id="whatsapp" /> <strong>Conclusion sur WhatsApp</strong>
          <p>{closing.approach}</p>
        </div>
      )}

      {a.segments.length > 0 && (
        <>
          <h3 className="section-title">Cibles</h3>
          <div className="segments">
            {a.segments.map((s) => (
              <div key={s.name} className="segment">
                <strong>{s.name}</strong>
                <p>{s.description}</p>
                {s.pains.length > 0 && <ul>{s.pains.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            ))}
          </div>
        </>
      )}

      <dl className="facts">
        <dt>Ton</dt><dd>{a.tone}</dd>
        <dt>Langues</dt><dd>{a.languages.join(', ')}</dd>
      </dl>

      {a.hooks.length > 0 && (
        <>
          <h3 className="section-title">Accroches d'ouverture</h3>
          <ul className="hooks">{a.hooks.map((h) => <li key={h}>« {h} »</li>)}</ul>
        </>
      )}
      {a.warnings.length > 0 && <ul className="notes">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </>
  )
}

// Ce que l'IA a le droit d'affirmer sur le produit. Sans connaissances, elle pose des questions
// au lieu d'inventer.
function KnowledgeEditor({ product, onSaved }: { product: Product; onSaved: (knowledge: string) => void }) {
  const [text, setText] = useState(product.knowledge ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <section className="card form">
      <div className="card-head">
        <h2>Connaissances produit</h2>
        <span className="muted small">Seule source de vérité de l'IA</span>
      </div>
      <p className="muted small">
        Tout ce qu'un bon vendeur doit savoir : à quoi sert le produit, prix, avantages, questions fréquentes, délais,
        livraison, garanties. L'IA n'affirme rien qui ne soit écrit ici (sans ce texte, elle se base sur la description).
        Un prix écrit ici est donné directement ; un prix absent passe par « Validations ».
      </p>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved(false) }}
        placeholder={'Délai de confection : 7 jours.\nLivraison Douala et Yaoundé : 2 000 FCFA.\nPaiement Mobile Money à la commande.'}
      />
      {saved && <p className="success">Enregistré.</p>}
      <button
        className="btn btn-ghost"
        onClick={async () => {
          await saveProductKnowledge(product.id, text)
          onSaved(text)
          setSaved(true)
        }}
      >
        Enregistrer les connaissances
      </button>
    </section>
  )
}

// Comment l'agent conclut : lien d'achat (digital) ou mise en contact avec le propriétaire (physique).
function SaleEditor({ product, onSaved }: { product: Product; onSaved: (sale: ProductSale) => void }) {
  const [v, setV] = useState<ProductSale>({
    sale_mode: product.sale_mode ?? (product.offer_type === 'physique' ? 'physique' : 'digital'),
    purchase_url: product.purchase_url ?? '', owner_name: product.owner_name ?? '',
    owner_whatsapp: product.owner_whatsapp ?? '', image_url: product.image_url ?? '',
  })
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: ProductSale) => { setV({ ...v, ...patch }); setSaved(false) }
  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (v.sale_mode === 'digital' && v.purchase_url && !/^https?:\/\/\S+$/.test(v.purchase_url)) {
          setError('Lien d\'achat invalide (https://… attendu)'); return
        }
        if (v.sale_mode === 'physique' && v.owner_whatsapp && v.owner_whatsapp.replace(/\D/g, '').length < 9) {
          setError('Numéro WhatsApp invalide (ex. +237 6XX XX XX XX)'); return
        }
        setError(null)
        const sale = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x])) as ProductSale
        await saveProductSale(product.id, sale)
        onSaved(sale)
        setSaved(true)
      }}
    >
      <div className="card-head">
        <h2>Vente</h2>
        <span className="muted small">Comment l'agent conclut</span>
      </div>
      <p className="muted small">
        Quand un prospect est prêt à acheter, l'agent lui envoie le lien d'achat (produit digital) ou le met en contact
        avec le propriétaire sur WhatsApp (produit physique). Vous recevez une alerte « prospect chaud ».
      </p>
      <div className="form-row two">
        <label className="check">
          <input type="radio" name={`mode-${product.id}`} checked={v.sale_mode === 'digital'} onChange={() => set({ sale_mode: 'digital' })} />
          <span>Produit digital<small className="muted">formation, logiciel, e-book, abonnement…</small></span>
        </label>
        <label className="check">
          <input type="radio" name={`mode-${product.id}`} checked={v.sale_mode === 'physique'} onChange={() => set({ sale_mode: 'physique' })} />
          <span>Produit physique ou service<small className="muted">à livrer, à retirer, sur rendez-vous…</small></span>
        </label>
      </div>
      {v.sale_mode === 'digital' ? (
        <label>
          Lien d'achat
          <input type="url" value={v.purchase_url ?? ''} onChange={(e) => set({ purchase_url: e.target.value })} placeholder="https://… (page de paiement, Chariow, Selar, Gumroad…)" />
        </label>
      ) : (
        <div className="form-row two">
          <label>
            Nom du propriétaire / vendeur
            <input value={v.owner_name ?? ''} onChange={(e) => set({ owner_name: e.target.value })} placeholder="Marie" />
          </label>
          <label>
            Son numéro WhatsApp
            <input type="tel" value={v.owner_whatsapp ?? ''} onChange={(e) => set({ owner_whatsapp: e.target.value })} placeholder="+237 6XX XX XX XX" />
          </label>
        </div>
      )}
      <label>
        Image du produit <span className="muted small">(utilisée par défaut dans les publications)</span>
        <input
          type="file" accept="image/*" disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setBusy(true)
            try { set({ image_url: await uploadPostImage(f) }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            setBusy(false)
          }}
        />
      </label>
      {v.image_url && <img src={v.image_url} alt="" className="post-thumb" />}
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Enregistré.</p>}
      <button className="btn" disabled={busy}>{busy ? 'Envoi de l\'image…' : 'Enregistrer la vente'}</button>
    </form>
  )
}

// Supports de closing : présentation, puis prise de rendez-vous (Partie 6).
function ClosingEditor({ product, onSaved }: { product: Product; onSaved: (closing: ProductClosing) => void }) {
  const [c, setC] = useState<ProductClosing>(product.closing ?? {})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: ProductClosing) => { setC({ ...c, ...patch }); setSaved(false) }
  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault()
        const bad = [c.presentation_url, c.booking_url].filter(Boolean).find((u) => !/^https:\/\//.test(u!))
        if (bad) { setError(`Lien invalide (https:// attendu) : ${bad}`); return }
        setError(null)
        await saveProductClosing(product.id, c)
        onSaved(c)
        setSaved(true)
      }}
    >
      <div className="card-head">
        <h2>Présentation et appel <span className="muted small">(facultatif)</span></h2>
        <span className="muted small">1. présentation → 2. appel</span>
      </div>
      <p className="muted small">
        Si vous avez une présentation, l'IA l'envoie au prospect intéressé avant de conclure. L'appel n'est proposé que si
        aucune vente (lien d'achat ou WhatsApp du vendeur) n'est configurée. Les liens sont insérés tels quels.
      </p>
      <div className="form-row two">
        <label>
          Nom de la présentation
          <input value={c.presentation_label ?? ''} onChange={(e) => set({ presentation_label: e.target.value })} placeholder="Présentation Core HR (PDF)" />
        </label>
        <label>
          Lien de la présentation
          <input type="url" value={c.presentation_url ?? ''} onChange={(e) => set({ presentation_url: e.target.value })} placeholder="https://…/presentation.pdf" />
        </label>
      </div>
      <div className="form-row two">
        <label>
          Durée de l'appel (min)
          <input type="number" min={5} max={120} value={c.call_minutes ?? ''} onChange={(e) => set({ call_minutes: e.target.value ? Number(e.target.value) : undefined })} placeholder="20" />
        </label>
        <label>
          Lien de prise de rendez-vous <span className="muted small">(Calendly, Cal.com, Google Agenda…)</span>
          <input type="url" value={c.booking_url ?? ''} onChange={(e) => set({ booking_url: e.target.value })} placeholder="https://cal.com/vous/demo" />
        </label>
      </div>
      <p className="muted small">Sans lien de rendez-vous, l'IA demandera au prospect deux créneaux qui l'arrangent.</p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Enregistré.</p>}
      <button className="btn btn-ghost">Enregistrer le closing</button>
    </form>
  )
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    listProducts().then((list) => {
      setProducts(list)
      setSelected((s) => s ?? list[0]?.id ?? null)
      if (!list.length) setCreating(true)
    })
  }, [])

  const current = products.find((p) => p.id === selected)

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Étape 1 · Votre offre</p>
        <h1>Produits</h1>
        <p className="lead">
          Décrivez ce que vous vendez : l'agent en déduit vos cibles, les réseaux où les trouver,
          le ton à adopter et les langues de prospection.
        </p>
      </header>

      <div className="split">
        <aside className="split-list">
          <button className="btn btn-ghost" onClick={() => setCreating(true)}>+ Nouveau produit</button>
          {products.map((p) => (
            <button
              key={p.id}
              className={`list-item ${p.id === selected && !creating ? 'active' : ''}`}
              onClick={() => { setSelected(p.id); setCreating(false) }}
            >
              <strong>{p.name}</strong>
              <span>{p.target || p.description.slice(0, 50)}</span>
            </button>
          ))}
        </aside>

        <div>
          {creating ? (
            <ProductForm
              onCreated={(p) => {
                setProducts((list) => [p, ...list])
                setSelected(p.id)
                setCreating(false)
              }}
            />
          ) : current ? (
            <section className="card">
              <div className="card-head">
                <h2>{current.name}</h2>
                {current.analysis && (
                  <span className="muted small">
                    {current.analysis.source === 'ai' ? 'Analyse IA' : 'Analyse par règles'}
                  </span>
                )}
              </div>
              {current.analysis ? <Analysis a={current.analysis} /> : <p className="muted">Pas encore analysé.</p>}
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const updated = await analyzeProduct(current)
                  setProducts((list) => list.map((p) => (p.id === updated.id ? updated : p)))
                }}
              >
                Relancer l'analyse
              </button>
            </section>
          ) : null}
          {current && !creating && (
            <SaleEditor
              key={`sale-${current.id}`}
              product={current}
              onSaved={(sale) => setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, ...sale } : p)))}
            />
          )}
          {current && !creating && (
            <KnowledgeEditor
              key={current.id}
              product={current}
              onSaved={(knowledge) => setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, knowledge } : p)))}
            />
          )}
          {current && !creating && (
            <ClosingEditor
              key={`closing-${current.id}`}
              product={current}
              onSaved={(closing) => setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, closing } : p)))}
            />
          )}
        </div>
      </div>
    </>
  )
}
