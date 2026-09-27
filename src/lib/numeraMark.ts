// Symbole NUMERA : tracés repris à l'identique du logo officiel (brand/numera-logo-original.svg,
// groupe « Logo-Mark »). Repère d'origine du groupe ; viewBox recadré sur le symbole.
// Source unique : composant <Logo /> et scripts/build-favicon.mjs (public/numera-mark.svg).

export interface MarkColors {
  navy: string        // socle + haut du dégradé des barres
  navyDeep: string    // bas du dégradé des barres
  greenFrom: string   // dégradé de la flèche et de la barre verte
  greenTo: string
}

export const NUMERA_COLORS: MarkColors = { navy: '#0A3B66', navyDeep: '#051E36', greenFrom: '#00875A', greenTo: '#00E676' }

export const MARK_VIEWBOX = '2 20 240 212'

export function numeraMarkSvg(c: MarkColors, idPrefix = 'nm'): string {
  const green = `${idPrefix}-green`
  const blue = `${idPrefix}-blue`
  return `
  <defs>
    <linearGradient id="${green}" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c.greenFrom}"/><stop offset="100%" stop-color="${c.greenTo}"/>
    </linearGradient>
    <linearGradient id="${blue}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${c.navy}"/><stop offset="100%" stop-color="${c.navyDeep}"/>
    </linearGradient>
  </defs>
  <path d="M 20,180 L 120,200 L 220,180 L 220,210 L 120,230 L 20,210 Z" fill="${c.navy}" opacity="0.15"/>
  <path d="M 10,195 L 120,220 L 230,195" fill="none" stroke="${c.navy}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="45" y="100" width="32" height="90" rx="4" fill="url(#${blue})"/>
  <rect x="95" y="60" width="32" height="130" rx="4" fill="url(#${blue})"/>
  <rect x="145" y="30" width="32" height="160" rx="4" fill="url(#${green})"/>
  <path d="M 20,150 L 80,170 L 130,110 L 225,35" fill="none" stroke="url(#${green})" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 180,30 L 230,30 L 230,80" fill="none" stroke="url(#${green})" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`
}
