import { useCallback, useEffect, useState } from 'react'
import ChannelBadge from '../components/ChannelBadge'
import { channelInfo } from '../data/channels'
import {
  createEntryLink, createTrigger, importProspects, listAccounts, listEntryLinks, listProducts, listProspects,
  listTriggers, markContacted, outreachQueue, setOutreachProfile, getOutreachProfile, toggleTrigger,
} from '../lib/api'
import { PROFILE_LABEL, STAGE_LABEL } from '../lib/outreach'
import type {
  ChannelAccount, EntryLink, KeywordTrigger, OutreachProfile, Product, Prospect, ProspectStage,
} from '../lib/types'

type Tab = 'queue' | 'import' | 'pipeline' | 'sources'
type OutboundChannel = 'linkedin' | 'x'

const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'À contacter aujourd\'hui' },
  { id: 'import', label: 'Importer' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'sources', label: 'Sources entrantes' },
]

const PIPELINE: ProspectStage[] = ['new', 'contacted', 'replied', 'interested', 'whatsapp', 'hot', 'won']

function Score({ value }: { value: number | null }) {
  if (value == null) return null
  const level = value >= 70 ? 'high' : value >= 40 ? 'mid' : 'low'
  return <span className={`fit fit-${level}`} title="Adéquation avec le produit">{value}</span>
}

function sourceLabel(source: string | null) {
  if (!source) return ''
  if (source.startsWith('lien:')) return `Lien ${source.slice(5)}`
  return ({
    import_linkedin: 'Import LinkedIn', import_x: 'Import X', facebook_inbound: 'Message Facebook',
    instagram_inbound: 'Message Instagram', whatsapp_inbound: 'Message WhatsApp',
    facebook_comment: 'Commentaire Facebook', instagram_comment: 'Commentaire Instagram',
  } as Record<string, string>)[source] ?? source
}

// ---------- File du jour ----------

function QueueTab({ product }: { product: Product }) {
  const outbound = (product.analysis?.channels ?? [])
    .filter((c) => c.role === 'outbound')
    .map((c) => c.channel as OutboundChannel)
  const [channel, setChannel] = useState<OutboundChannel>(outbound[0] ?? 'linkedin')
  const [profile, setProfile] = useState<OutreachProfile>('new')
  const [data, setData] = useState<{ queue: Prospect[]; limit: number; doneToday: number } | null>(null)

  const load = useCallback(() => {
    getOutreachProfile().then(setProfile)
    outreachQueue(product.id, channel).then(setData)
  }, [product.id, channel])

  useEffect(() => {
    load()
  }, [load])

  const score = product.analysis?.channels.find((c) => c.channel === channel)?.score

  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {(['linkedin', 'x'] as const).map((c) => (
            <button key={c} className={channel === c ? 'active' : ''} onClick={() => setChannel(c)}>
              {channelInfo(c).name}
            </button>
          ))}
        </div>
        <label className="inline">
          Mon compte {channelInfo(channel).name} :
          <select
            value={profile}
            onChange={async (e) => {
              await setOutreachProfile(e.target.value as OutreachProfile)
              load()
            }}
          >
            {(Object.keys(PROFILE_LABEL) as OutreachProfile[]).map((p) => (
              <option key={p} value={p}>{PROFILE_LABEL[p]}</option>
            ))}
          </select>
        </label>
      </div>

      {score != null && score < 30 && (
        <p className="notice">
          {channelInfo(channel).name} est peu adapté à ce produit (score {score}). Privilégiez les sources entrantes.
        </p>
      )}

      {data && (
        <div className="quota">
          <span><strong>{data.doneToday} / {data.limit}</strong> contactés aujourd'hui sur {channelInfo(channel).name}</span>
          <div className="bar"><div style={{ width: `${Math.min(100, (data.doneToday / Math.max(1, data.limit)) * 100)}%`, background: channelInfo(channel).color }} /></div>
          <span className="muted small">
            Limite volontairement prudente pour protéger votre compte. L'IA rédigera le message personnalisé à la Partie 3.
          </span>
        </div>
      )}

      {data && data.queue.length === 0 && (
        <p className="card empty muted">
          {data.doneToday >= data.limit
            ? 'Quota du jour atteint. Revenez demain : c\'est ce qui garde votre compte en bonne santé.'
            : 'Aucun prospect à contacter. Importez des profils dans l\'onglet « Importer ».'}
        </p>
      )}

      <div className="prospect-list">
        {data?.queue.map((p) => (
          <article key={p.id} className="card prospect">
            <div className="prospect-head">
              <div>
                <strong>{p.full_name ?? 'Sans nom'}</strong>
                <p className="muted">{[p.job_title, p.company].filter(Boolean).join(' · ')}</p>
              </div>
              <Score value={p.fit_score} />
            </div>
            {p.segment_label && <span className="tag">{p.segment_label}</span>}
            {p.fit_reasons.length > 0 && <ul className="reasons">{p.fit_reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            <div className="actions">
              {p.profile_url && (
                <a className="btn btn-ghost" href={p.profile_url} target="_blank" rel="noreferrer">Ouvrir le profil</a>
              )}
              <button className="btn" onClick={async () => { await markContacted(p.id); load() }}>
                Marquer comme contacté
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

// ---------- Import ----------

function ImportTab({ product, onImported }: { product: Product; onImported: () => void }) {
  const [channel, setChannel] = useState<OutboundChannel>('linkedin')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      const r = await importProspects(product, channel, raw)
      setResult({
        kind: 'ok',
        text: `${r.added} prospect(s) ajouté(s) et qualifié(s)${r.skipped ? `, ${r.skipped} déjà présent(s)` : ''}`
          + (r.source === 'rules' ? ' (analyse par règles)' : ' (analyse IA)'),
      })
      setRaw('')
      onImported()
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Importer des profils</h2>
      <p className="muted">
        Copiez depuis {channelInfo(channel).name} le haut des profils qui vous intéressent (nom, titre, entreprise,
        lieu, « À propos ») avec leur URL. Séparez chaque profil par une ligne vide. 20 profils maximum par import.
      </p>
      <div className="segmented">
        {(['linkedin', 'x'] as const).map((c) => (
          <button type="button" key={c} className={channel === c ? 'active' : ''} onClick={() => setChannel(c)}>
            {channelInfo(c).name}
          </button>
        ))}
      </div>
      <textarea
        required
        rows={10}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={'Carine Ebongue\nDirectrice des Ressources Humaines chez Brasseries du Littoral\nDouala, Cameroun\nhttps://www.linkedin.com/in/carine-ebongue\n\nSerge Tchoupo\nDirecteur Général | Tchoupo Logistique\nhttps://www.linkedin.com/in/serge-tchoupo'}
      />
      {result && <p className={result.kind === 'ok' ? 'success' : 'error'}>{result.text}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Qualification en cours…' : 'Importer et qualifier'}</button>
      <p className="muted small">
        Pas d'extension ni de robot : vous copiez ce que vous consultez vous-même. C'est ce qui protège votre compte.
      </p>
    </form>
  )
}

// ---------- Pipeline ----------

function PipelineTab({ prospects }: { prospects: Prospect[] }) {
  const archived = prospects.filter((p) => p.stage === 'lost' || p.stage === 'ghosted').length
  return (
    <>
      <div className="pipeline">
        {PIPELINE.map((stage) => {
          const items = prospects.filter((p) => p.stage === stage)
          return (
            <section key={stage} className="pipeline-col">
              <h3>{STAGE_LABEL[stage]} <span className="muted">{items.length}</span></h3>
              {items.map((p) => (
                <div key={p.id} className="pipeline-card">
                  <div className="prospect-head">
                    <strong>{p.full_name ?? 'Sans nom'}</strong>
                    <Score value={p.fit_score} />
                  </div>
                  {p.job_title && <p className="muted small">{p.job_title}</p>}
                  <span className="muted small">{sourceLabel(p.source)}</span>
                </div>
              ))}
            </section>
          )
        })}
      </div>
      {archived > 0 && <p className="muted small">{archived} prospect(s) archivé(s) (réponse négative ou sans réponse).</p>}
    </>
  )
}

// ---------- Sources entrantes ----------

function SourcesTab({ product }: { product: Product }) {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([])
  const [links, setLinks] = useState<EntryLink[]>([])
  const [triggers, setTriggers] = useState<KeywordTrigger[]>([])
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [form, setForm] = useState({ account: '', keywords: 'info, prix', reply: '' })

  const load = useCallback(() => {
    listAccounts().then(setAccounts)
    listEntryLinks(product.id).then(setLinks)
    listTriggers(product.id).then(setTriggers)
  }, [product.id])
  useEffect(() => {
    load()
  }, [load])

  const wa = accounts.find((a) => a.channel === 'whatsapp')
  const phone = wa?.display_phone?.replace(/\D/g, '')
  const social = accounts.filter((a) => a.channel === 'facebook' || a.channel === 'instagram')
  const waLink = (l: EntryLink) => `https://wa.me/${phone}?text=${encodeURIComponent(l.prefilled_text)}`

  return (
    <div className="grid">
      <section className="card">
        <div className="card-head"><h2><ChannelBadge id="whatsapp" /> Liens WhatsApp</h2></div>
        <p className="muted small">
          Un lien par endroit où vous le diffusez (bio, affiche, statut, signature e-mail). Le code de référence
          rattache chaque nouvelle conversation à ce produit et à cette source.
        </p>
        {!phone && <p className="notice">Connectez d'abord votre WhatsApp dans « Canaux ».</p>}
        <ul className="link-list">
          {links.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{l.label}</strong> <span className="muted small">réf. {l.code} · {l.conversations} conversation(s)</span>
              </div>
              {phone && (
                <div className="copy-row">
                  <code>{waLink(l)}</code>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(waLink(l)).catch(() => {})
                      setCopied(l.id)
                    }}
                  >
                    {copied === l.id ? 'Copié' : 'Copier'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            await createEntryLink(product, label)
            setLabel('')
            load()
          }}
        >
          <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Bio Instagram, Flyer salon" />
          <button className="btn" disabled={!phone}>Créer le lien</button>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h2><ChannelBadge id="facebook" /> <ChannelBadge id="instagram" /> Mots-clés en commentaire</h2></div>
        <p className="muted small">
          Quand quelqu'un commente un mot-clé sous vos publications (« INFO », « PRIX »…), il reçoit automatiquement
          une réponse en message privé. Meta autorise une seule réponse privée par commentaire, dans les 7 jours.
        </p>
        {social.length === 0 && <p className="notice">Connectez d'abord Facebook / Instagram dans « Canaux ».</p>}
        <ul className="link-list">
          {triggers.map((t) => {
            const account = accounts.find((a) => a.id === t.channel_account_id)
            return (
              <li key={t.id}>
                <div className="trigger-head">
                  {account && <ChannelBadge id={account.channel} />}
                  <strong>{t.keywords.join(', ')}</strong>
                  <span className="muted small">{t.matches} déclenchement(s)</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={t.active}
                      onChange={async (e) => { await toggleTrigger(t.id, e.target.checked); load() }}
                    />
                    Actif
                  </label>
                </div>
                <p className="small">« {t.reply_text} »</p>
              </li>
            )
          })}
        </ul>
        {social.length > 0 && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault()
              await createTrigger({
                product_id: product.id,
                channel_account_id: form.account || social[0].id,
                keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
                reply_text: form.reply,
              })
              setForm({ account: '', keywords: 'info, prix', reply: '' })
              load()
            }}
          >
            <div className="form-row two">
              <label>
                Compte
                <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
                  {social.map((a) => <option key={a.id} value={a.id}>{channelInfo(a.channel).name} · {a.label}</option>)}
                </select>
              </label>
              <label>
                Mots-clés (séparés par des virgules)
                <input required value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
              </label>
            </div>
            <label>
              Réponse privée
              <textarea
                required rows={2} value={form.reply} onChange={(e) => setForm({ ...form, reply: e.target.value })}
                placeholder="Merci pour votre intérêt ! Voici… Qu'est-ce qui vous intéresse le plus ?"
              />
            </label>
            <button className="btn">Ajouter le déclencheur</button>
          </form>
        )}
      </section>
    </div>
  )
}

// ---------- Page ----------

export default function ProspectsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('queue')
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    listProducts().then((list) => {
      setProducts(list)
      setProductId((id) => id ?? list[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (productId) listProspects(productId).then(setProspects)
  }, [productId, tab, version])

  const product = products.find((p) => p.id === productId)

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Étape 3 · Ciblage & sourcing</p>
        <h1>Prospects</h1>
        <p className="lead">
          Pour chaque produit : les meilleurs profils à contacter aujourd'hui sur LinkedIn/X, et les sources qui
          amènent les clients vers vous sur Facebook, Instagram et WhatsApp.
        </p>
      </header>

      {products.length === 0 ? (
        <p className="card empty muted">Créez d'abord un produit dans « Produits ».</p>
      ) : (
        <>
          <div className="toolbar">
            <label className="inline">
              Produit :
              <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <span className="muted small">{prospects.length} prospect(s)</span>
          </div>

          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>

          {product && tab === 'queue' && <QueueTab key={`${product.id}-${version}`} product={product} />}
          {product && tab === 'import' && (
            <ImportTab product={product} onImported={() => setVersion((v) => v + 1)} />
          )}
          {tab === 'pipeline' && <PipelineTab prospects={prospects} />}
          {product && tab === 'sources' && <SourcesTab product={product} />}
        </>
      )}
    </>
  )
}
