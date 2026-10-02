import { useCallback, useEffect, useState } from 'react'
import ChannelBadge from '../components/ChannelBadge'
import {
  createPost, deletePost, generatePosts, listAccounts, listPosts, listProducts, publishPostNow, updatePost, uploadPostImage,
} from '../lib/api'
import type { ChannelAccount, Post, PostStatus, Product } from '../lib/types'

type Net = 'facebook' | 'instagram'

const STATUS: Record<PostStatus, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'badge-assisted' },
  scheduled: { label: 'Planifiée', cls: 'badge-assisted' },
  publishing: { label: 'Publication…', cls: 'badge-assisted' },
  published: { label: 'Publiée', cls: 'badge-auto' },
  failed: { label: 'Échec', cls: 'badge-error' },
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// datetime-local ↔ ISO, à l'heure du téléphone.
const toLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function Generator({ products, connected, onCreated }: {
  products: Product[]; connected: Net[]; onCreated: (posts: Post[]) => void
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [nets, setNets] = useState<Net[]>(connected.length ? connected : ['facebook', 'instagram'])
  const [count, setCount] = useState(2)
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (n: Net) => setNets((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]))

  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          onCreated(await generatePosts({ productId, channels: nets, count, brief: brief.trim() || undefined }))
          setBrief('')
        } catch (err) {
          setError(errorText(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="card-head">
        <h2>Créer des publications avec l'IA</h2>
      </div>
      <p className="muted small">
        L'agent analyse votre produit et écrit des publications qui donnent envie de commenter. Chaque personne qui
        commente reçoit ensuite un message privé de l'agent, qui discute avec elle et conclut la vente.
      </p>
      <label>
        Produit
        <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="actions">
        {(['facebook', 'instagram'] as Net[]).map((n) => (
          <label key={n} className="check">
            <input type="checkbox" checked={nets.includes(n)} onChange={() => toggle(n)} />
            <span>{n === 'facebook' ? 'Facebook' : 'Instagram'}</span>
          </label>
        ))}
      </div>
      <div className="form-row">
        <label>
          Nombre par réseau
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
      </div>
      <label>
        Consigne <span className="muted small">(facultatif)</span>
        <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ex. promo de la rentrée, insister sur la livraison gratuite" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || !productId || !nets.length}>
        {busy ? 'L\'IA écrit…' : 'Générer les publications'}
      </button>
    </form>
  )
}

function PostCard({ post, onChange, onDelete }: { post: Post; onChange: (p: Post) => void; onDelete: () => void }) {
  const [body, setBody] = useState(post.body)
  const [at, setAt] = useState(toLocal(post.scheduled_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editable = post.status === 'draft' || post.status === 'failed' || post.status === 'scheduled'
  const status = STATUS[post.status]

  async function run(label: string, fn: () => Promise<Partial<Post> | void>) {
    setBusy(label)
    setError(null)
    try {
      const patch = await fn()
      if (patch) onChange({ ...post, ...patch })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const saveBody = async () => {
    if (body !== post.body) await updatePost(post.id, { body })
    return { body }
  }

  return (
    <section className="card post-card">
      <div className="card-head">
        <span className="chips">
          <ChannelBadge id={post.channel} />
          <span className={`badge ${status.cls}`}>{status.label}</span>
          {post.source === 'ai' && <span className="muted small">IA</span>}
        </span>
        {post.status === 'published' && (
          <span className="muted small">{post.comments} commentaire{post.comments > 1 ? 's' : ''}</span>
        )}
      </div>

      {editable ? (
        <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      ) : (
        <p className="post-body">{post.body}</p>
      )}

      {post.image_url ? (
        <div className="post-image">
          <img src={post.image_url} alt="" className="post-thumb" />
          {editable && (
            <button className="link small" onClick={() => run('img', async () => {
              await updatePost(post.id, { image_url: null })
              return { image_url: null }
            })}>Retirer l'image</button>
          )}
        </div>
      ) : post.image_idea && editable ? (
        <p className="muted small">Idée de visuel : {post.image_idea}</p>
      ) : null}

      {editable && (
        <label className="small">
          {post.image_url ? 'Changer l\'image' : `Ajouter une image${post.channel === 'instagram' ? ' (obligatoire sur Instagram)' : ''}`}
          <input
            type="file" accept="image/*" disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) run('img', async () => {
                const url = await uploadPostImage(f)
                await updatePost(post.id, { image_url: url })
                return { image_url: url }
              })
            }}
          />
        </label>
      )}

      {post.status === 'failed' && post.error && <p className="error">{post.error}</p>}
      {post.status === 'scheduled' && post.scheduled_at && (
        <p className="muted small">Publication prévue le {new Date(post.scheduled_at).toLocaleString('fr-FR')}</p>
      )}
      {post.status === 'published' && post.permalink && (
        <p className="small"><a href={post.permalink} target="_blank" rel="noreferrer">Voir la publication</a></p>
      )}
      {error && <p className="error">{error}</p>}

      {editable && (
        <>
          <div className="actions">
            <button className="btn small" disabled={!!busy} onClick={() => run('pub', async () => {
              await saveBody()
              await publishPostNow(post.id)
              return { body, status: 'publishing', error: null }
            })}>
              {busy === 'pub' ? 'Envoi…' : 'Publier maintenant'}
            </button>
            {body !== post.body && (
              <button className="btn btn-ghost small" disabled={!!busy} onClick={() => run('save', saveBody)}>Enregistrer</button>
            )}
            <button className="btn btn-ghost small" disabled={!!busy} onClick={() => {
              if (confirm('Supprimer cette publication ?')) run('del', async () => { await deletePost(post.id); onDelete() })
            }}>Supprimer</button>
          </div>
          <div className="actions">
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            <button className="btn btn-ghost small" disabled={!!busy || !at} onClick={() => run('plan', async () => {
              const when = new Date(at)
              if (when.getTime() < Date.now() - 60_000) throw new Error('Choisissez une date à venir')
              if (post.channel === 'instagram' && !post.image_url) throw new Error('Instagram exige une image')
              await saveBody()
              await updatePost(post.id, { status: 'scheduled', scheduled_at: when.toISOString() })
              return { body, status: 'scheduled', scheduled_at: when.toISOString() }
            })}>Planifier</button>
            {post.status === 'scheduled' && (
              <button className="btn btn-ghost small" disabled={!!busy} onClick={() => run('unplan', async () => {
                await updatePost(post.id, { status: 'draft', scheduled_at: null })
                return { status: 'draft', scheduled_at: null }
              })}>Annuler la planification</button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [accounts, setAccounts] = useState<ChannelAccount[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => listPosts().then(setPosts).catch(() => {}), [])

  useEffect(() => {
    Promise.all([listPosts(), listProducts(), listAccounts()]).then(([po, pr, ac]) => {
      setPosts(po)
      setProducts(pr)
      setAccounts(ac)
      setLoaded(true)
    })
  }, [])

  // Publication en cours côté serveur : on suit son résultat.
  const pending = posts.some((p) => p.status === 'publishing')
  useEffect(() => {
    if (!pending) return
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [pending, refresh])

  const connected = (['facebook', 'instagram'] as Net[])
    .filter((n) => accounts.some((a) => a.channel === n && a.status === 'active'))
  const replace = (p: Post) => setPosts((l) => l.map((x) => (x.id === p.id ? p : x)))

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Étape 2 · Attirer les clients</p>
        <h1>Publications</h1>
        <p className="lead">
          L'agent écrit et publie vos posts sur Facebook et Instagram. Quand quelqu'un commente ou écrit en privé,
          il lui répond, le qualifie, puis lui envoie le lien d'achat ou le met en contact avec vous sur WhatsApp.
        </p>
      </header>

      {loaded && !connected.length && (
        <p className="notes">Connectez d'abord votre Page Facebook (et Instagram) dans « Canaux » pour pouvoir publier.</p>
      )}
      {loaded && !products.length && (
        <p className="notes">Ajoutez d'abord un produit dans « Produits » : l'agent doit savoir ce qu'il vend.</p>
      )}

      {products.length > 0 && (
        <Generator products={products} connected={connected} onCreated={(created) => setPosts((l) => [...created, ...l])} />
      )}

      <div className="actions">
        {(['facebook', 'instagram'] as Net[]).map((n) => (
          <button
            key={n}
            className="btn btn-ghost small"
            onClick={async () => setPosts([
              await createPost({ channel: n, body: 'Votre texte ici', image_url: null, product_id: products[0]?.id ?? null }),
              ...posts,
            ])}
          >
            + Écrire ma publication {n === 'facebook' ? 'Facebook' : 'Instagram'}
          </button>
        ))}
      </div>

      <div className="grid posts-grid">
        {posts.map((p) => (
          <PostCard
            key={`${p.id}-${p.status}`}
            post={p}
            onChange={replace}
            onDelete={() => setPosts((l) => l.filter((x) => x.id !== p.id))}
          />
        ))}
      </div>
      {loaded && !posts.length && <p className="muted">Aucune publication pour l'instant.</p>}
    </>
  )
}
