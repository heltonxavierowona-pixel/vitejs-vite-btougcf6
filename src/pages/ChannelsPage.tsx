import { CHANNELS, INFRA_CHECKLIST, type ChecklistItem } from '../data/channels'
import { useChecklist } from '../lib/useChecklist'

function Checklist({
  scope,
  items,
  done,
  toggle,
}: {
  scope: string
  items: ChecklistItem[]
  done: Record<string, boolean>
  toggle: (key: string) => void
}) {
  return (
    <ul className="checklist">
      {items.map((item) => {
        const key = `${scope}.${item.id}`
        return (
          <li key={key}>
            <label>
              <input type="checkbox" checked={!!done[key]} onChange={() => toggle(key)} />
              <span>
                {item.label}
                {item.hint && <small>{item.hint}</small>}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div className="progress" aria-label={`${value} sur ${total}`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span>
        {value}/{total}
      </span>
    </div>
  )
}

export default function ChannelsPage() {
  const { done, toggle } = useChecklist()
  const count = (scope: string, items: ChecklistItem[]) =>
    items.filter((i) => done[`${scope}.${i.id}`]).length

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Partie 1 · Fondations & comptes</p>
        <h1>Canaux</h1>
        <p className="lead">
          Chaque réseau a ses propres règles. Les canaux <strong>auto</strong> utilisent une API
          officielle ; les canaux <strong>assistés</strong> : l'IA rédige, vous envoyez.
        </p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Infrastructure</h2>
          <Progress value={count('infra', INFRA_CHECKLIST)} total={INFRA_CHECKLIST.length} />
        </div>
        <Checklist scope="infra" items={INFRA_CHECKLIST} done={done} toggle={toggle} />
      </section>

      <div className="grid">
        {CHANNELS.map((c) => (
          <section key={c.id} className="card channel" style={{ '--accent': c.color } as React.CSSProperties}>
            <div className="card-head">
              <h2>
                <span className="dot" /> {c.name}
              </h2>
              <span className={`badge badge-${c.mode}`}>{c.mode === 'auto' ? 'Auto' : 'Assisté'}</span>
            </div>
            <p className="role">{c.role}</p>
            <dl className="facts">
              <dt>Premier message</dt>
              <dd>{c.canColdMessage}</dd>
              <dt>API</dt>
              <dd>{c.api}</dd>
            </dl>
            <ul className="risks">
              {c.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Progress value={count(c.id, c.checklist)} total={c.checklist.length} />
            <Checklist scope={c.id} items={c.checklist} done={done} toggle={toggle} />
          </section>
        ))}
      </div>
    </>
  )
}
