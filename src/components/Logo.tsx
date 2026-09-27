import { useId } from 'react'
import { MARK_VIEWBOX, numeraMarkSvg } from '../lib/numeraMark'

// Couleurs via variables CSS (--nm-*) : identiques au logo officiel en mode clair,
// éclaircies en mode sombre pour rester lisibles.
const CSS_COLORS = {
  navy: 'var(--nm-navy)', navyDeep: 'var(--nm-navy-deep)',
  greenFrom: 'var(--nm-green-from)', greenTo: 'var(--nm-green-to)',
}

export function NumeraMark({ size = 34 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg
      width={(size * 240) / 212}
      height={size}
      viewBox={MARK_VIEWBOX}
      aria-hidden="true"
      className="numera-mark"
      // Contenu statique généré par le code (aucune donnée utilisateur).
      dangerouslySetInnerHTML={{ __html: numeraMarkSvg(CSS_COLORS, `nm${id}`) }}
    />
  )
}

// Symbole + « Numera » + nom du produit ; `tagline` (ligne verte) pour les grands formats.
export default function Logo({ product = 'AGENTIC', tagline, size = 34 }: { product?: string; tagline?: string; size?: number }) {
  return (
    <span className="logo" aria-label={`Numera ${product}`}>
      <NumeraMark size={size} />
      <span className="logo-text">
        <span className="logo-brand">Numera</span>
        <span className="logo-product">{product}</span>
        {tagline && <span className="logo-tagline">{tagline}</span>}
      </span>
    </span>
  )
}
