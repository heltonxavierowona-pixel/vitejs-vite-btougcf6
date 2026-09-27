// Symbole NUMERA (reproduction vectorielle du logo de la marque), repère 108 × 84.
// Source unique : utilisée par le composant <Logo /> et par scripts/build-favicon.mjs (public/numera-mark.svg).
// Trois barres, une courbe qui monte en flèche (bleu → vert) et un cadre en forme de maison.

export interface MarkColors { navy: string; bar: string; green: string }

export const NUMERA_COLORS: MarkColors = { navy: '#134b70', bar: '#155c88', green: '#32bf7a' }

export function numeraMarkSvg(c: MarkColors, idPrefix = 'nm'): string {
  const U = [[-3, 88], [46, 52.5], [61, 67], [97, 31]]   // bande haute : dégradé bleu → vert, finit en flèche
  const N = [[-3, 95], [46, 59], [58, 71], [86, 49]]     // bande basse : toit de la maison (bleu marine)
  const gap = 9                                           // espace blanc entre les barres et la bande haute
  const pts = (a: number[][]) => a.map((p) => p.join(',')).join(' ')
  const cut = U.map(([x, y]) => `${x},${y - gap}`).join(' ')
  const d = Math.SQRT1_2
  const [ex, ey] = U[3]
  const tip = [ex + 14 * d, ey - 14 * d], b1 = [ex + 10.5 * d, ey + 10.5 * d], b2 = [ex - 10.5 * d, ey - 10.5 * d]
  return `
  <defs>
    <linearGradient id="${idPrefix}-band" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="100" y2="24">
      <stop offset="0" stop-color="${c.navy}"/><stop offset="0.45" stop-color="${c.navy}"/><stop offset="0.8" stop-color="${c.green}"/>
    </linearGradient>
    <clipPath id="${idPrefix}-box"><rect width="108" height="84"/></clipPath>
    <mask id="${idPrefix}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="84">
      <rect width="108" height="84" fill="#fff"/>
      <polygon points="${cut} 108,${U[3][1] - gap - 20} 108,84 0,84" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#${idPrefix}-cut)">
    <rect x="22" y="36" width="13" height="48" fill="${c.bar}"/>
    <rect x="46" y="23" width="13.5" height="61" fill="${c.bar}"/>
    <rect x="65" y="11" width="13.5" height="73" fill="${c.green}"/>
  </g>
  <g clip-path="url(#${idPrefix}-box)">
    <rect x="15" y="79" width="77" height="5" fill="${c.navy}"/>
    <rect x="85" y="51" width="7" height="33" fill="${c.navy}"/>
    <polyline points="${pts(N)}" fill="none" stroke="${c.navy}" stroke-width="7" stroke-linejoin="miter"/>
    <polyline points="${pts(U)}" fill="none" stroke="url(#${idPrefix}-band)" stroke-width="7" stroke-linejoin="miter"/>
    <polygon points="${pts([b2, b1, tip])}" fill="${c.green}"/>
  </g>`
}
