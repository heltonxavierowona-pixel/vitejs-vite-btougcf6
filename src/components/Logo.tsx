import { useId } from 'react'

// Marque NUMERA : un « N » tracé comme un réseau (quatre nœuds reliés), dégradé bleu → vert.
// Le symbole est commun à toute la gamme ; seul le nom du produit change (ici AGENTIC).
export function NumeraMark({ size = 32 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="numera-mark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a56db" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id})`} />
      <path d="M14 34V14l20 20V14" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="34" r="3.6" fill="#fff" />
      <circle cx="34" cy="14" r="4.6" fill="#fff" />
      <circle cx="34" cy="14" r="2" fill="#059669" />
    </svg>
  )
}

export default function Logo({ product = 'AGENTIC', size = 34 }: { product?: string; size?: number }) {
  return (
    <span className="logo" aria-label={`Numera ${product}`}>
      <NumeraMark size={size} />
      <span className="logo-text">
        <span className="logo-brand">NUMERA</span>
        <span className="logo-product">{product}</span>
      </span>
    </span>
  )
}
