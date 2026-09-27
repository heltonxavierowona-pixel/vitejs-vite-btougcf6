import { useId } from 'react'
import { numeraMarkSvg } from '../lib/numeraMark'

// Couleurs du logo via variables CSS (--nm-*) : variante lisible en mode sombre.
const CSS_COLORS = { navy: 'var(--nm-navy)', bar: 'var(--nm-bar)', green: 'var(--nm-green)' }

export function NumeraMark({ size = 34 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg
      width={(size * 108) / 84}
      height={size}
      viewBox="0 0 108 84"
      aria-hidden="true"
      className="numera-mark"
      // Contenu statique généré par le code (aucune donnée utilisateur).
      dangerouslySetInnerHTML={{ __html: numeraMarkSvg(CSS_COLORS, `nm${id}`) }}
    />
  )
}

export default function Logo({ product = 'AGENTIC', size = 34 }: { product?: string; size?: number }) {
  return (
    <span className="logo" aria-label={`Numera ${product}`}>
      <NumeraMark size={size} />
      <span className="logo-text">
        <span className="logo-brand">Nume<span className="logo-r">r</span>a</span>
        <span className="logo-product">{product}</span>
      </span>
    </span>
  )
}
