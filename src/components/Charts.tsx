import { useEffect, useRef, useState } from 'react'

// Graphiques du tableau de bord, sans bibliothèque. Règles appliquées :
// barres ≤ 24 px, bout arrondi 4 px et base carrée, lignes 2 px, grille en filets,
// texte jamais dans la couleur des séries, infobulle au survol ET au clavier,
// et un tableau de données pour chaque graphique (la valeur n'est jamais cachée dans l'infobulle).

import { fmt } from '../lib/format'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

interface Tip { x: number; y: number; title: string; rows: { label: string; value: string; series?: 1 | 2 }[] }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="viz-tooltip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="viz-tooltip-row">
          {r.series && <span className={`viz-key viz-key-line s${r.series}`} />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-table">
      <summary>Voir les données</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === 'number' ? fmt(v) : v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

export function StatTile({ label, value, hint, hero }: { label: string; value: string; hint?: string; hero?: boolean }) {
  return (
    <div className={`stat-tile ${hero ? 'hero' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

// Barres horizontales, une ou deux séries (même échelle). Valeur au bout de chaque barre.
export function HBars({
  rows,
  series,
  format = fmt,
  detail,
}: {
  rows: { label: string; values: number[] }[]
  series: string[]
  format?: (n: number) => string
  detail?: (row: { label: string; values: number[] }, index: number) => string | null
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const max = Math.max(1, ...rows.flatMap((r) => r.values))
  const show = (e: React.MouseEvent | React.FocusEvent, row: { label: string; values: number[] }, i: number) => {
    const b = box.current!.getBoundingClientRect()
    const t = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const extra = detail?.(row, i)
    setTip({
      x: Math.min(t.left - b.left + t.width / 2, b.width - 180), y: t.top - b.top - 8, title: row.label,
      rows: [
        ...row.values.map((v, s) => ({ label: series[s], value: format(v), series: series.length > 1 ? ((s + 1) as 1 | 2) : undefined })),
        ...(extra ? [{ label: extra, value: '' }] : []),
      ],
    })
  }
  return (
    <div className="viz-hbars" ref={box} onMouseLeave={() => setTip(null)}>
      {series.length > 1 && (
        <div className="viz-legend">
          {series.map((s, i) => <span key={s}><span className={`viz-key viz-key-rect s${i + 1}`} />{s}</span>)}
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={row.label}
          className="viz-hbar-row"
          tabIndex={0}
          onMouseEnter={(e) => show(e, row, i)}
          onFocus={(e) => show(e, row, i)}
          onBlur={() => setTip(null)}
          aria-label={`${row.label} : ${row.values.map((v, s) => `${series[s]} ${format(v)}`).join(', ')}`}
        >
          <span className="viz-hbar-label">{row.label}</span>
          <div className="viz-hbar-track">
            {row.values.map((v, s) => (
              <div key={s} className="viz-hbar-line">
                <div className={`viz-hbar s${s + 1}`} style={{ width: `${(v / max) * 100}%` }} />
                <span className="viz-hbar-value">{format(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  )
}

// Courbes quotidiennes (même échelle), réticule vertical qui s'aligne sur le jour le plus proche.
export function LineChart({ points, series }: { points: { label: string; values: [number, number] }[]; series: [string, string] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 220
  const pad = { l: 36, r: 96, t: 12, b: 28 }
  const w = Math.max(0, width - pad.l - pad.r)
  const h = H - pad.t - pad.b
  const raw = Math.max(1, ...points.flatMap((p) => p.values))
  const step = raw <= 5 ? 1 : raw <= 10 ? 2 : raw <= 25 ? 5 : raw <= 50 ? 10 : Math.ceil(raw / 5 / 10) * 10
  const max = Math.ceil(raw / step) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * w)
  const y = (v: number) => pad.t + h - (v / max) * h
  const path = (s: 0 | 1) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.values[s]).toFixed(1)}`).join('')
  // Une date tous les ~80 px au plus, pour que les libellés ne se chevauchent jamais.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 80))))
  const xTicks = points.map((p, i) => ({ p, i }))
    .filter(({ i }) => (i % every === 0 && points.length - 1 - i >= every * 0.6) || i === points.length - 1)
  const last = points.length - 1

  const onMove = (clientX: number) => {
    const b = ref.current!.getBoundingClientRect()
    const rel = (clientX - b.left - pad.l) / Math.max(1, w)
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))))
  }
  const hp = hover != null ? points[hover] : null

  return (
    <div
      className="viz-line"
      ref={ref}
      tabIndex={0}
      aria-label={`${series[0]} et ${series[1]} par jour. Utilisez les flèches pour parcourir les jours.`}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setHover((h0) => Math.min(last, (h0 ?? -1) + 1))
        if (e.key === 'ArrowLeft') setHover((h0) => Math.max(0, (h0 ?? last + 1) - 1))
      }}
      onBlur={() => setHover(null)}
    >
      <div className="viz-legend">
        {series.map((s, i) => <span key={s}><span className={`viz-key viz-key-line s${i + 1}`} />{s}</span>)}
      </div>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text className="viz-axis-text" x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          {xTicks.map(({ p, i }) => (
            <text key={i} className="viz-axis-text" x={x(i)} y={H - 8} textAnchor={i === last ? 'end' : i === 0 ? 'start' : 'middle'}>{p.label}</text>
          ))}
          {([0, 1] as const).map((s) => <path key={s} className={`viz-path s${s + 1}`} d={path(s)} />)}
          {([0, 1] as const).map((s) => (
            <g key={`end${s}`}>
              <circle className={`viz-dot s${s + 1}`} cx={x(last)} cy={y(points[last].values[s])} r={4} />
              <text className="viz-end-label" x={x(last) + 10} y={y(points[last].values[s])} dy={s === 0 ? '-0.2em' : '0.9em'}>
                {series[s]} {fmt(points[last].values[s])}
              </text>
            </g>
          ))}
          {hp && hover != null && (
            <g>
              <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} />
              {([0, 1] as const).map((s) => <circle key={s} className={`viz-dot s${s + 1}`} cx={x(hover)} cy={y(hp.values[s])} r={4} />)}
            </g>
          )}
        </svg>
      )}
      {hp && hover != null && (
        <Tooltip tip={{
          x: Math.min(x(hover) + 12, width - 180), y: 24, title: hp.label,
          rows: series.map((s, i) => ({ label: s, value: fmt(hp.values[i]), series: (i + 1) as 1 | 2 })),
        }} />
      )}
    </div>
  )
}
