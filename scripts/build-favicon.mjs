// Régénère depuis src/lib/numeraMark.ts :
//   public/numera-mark.svg          (favicon : symbole sur fond blanc arrondi)
//   brand/numera-agentic-logo.svg   (logo complet du produit, même mise en page que le logo officiel)
// Usage : node scripts/build-favicon.mjs
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const out = await build({ entryPoints: ['src/lib/numeraMark.ts'], bundle: true, format: 'esm', write: false })
const { numeraMarkSvg, NUMERA_COLORS } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

writeFileSync('public/numera-mark.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -6 272 272" role="img" aria-label="Numera">\n` +
  `  <rect x="-14" y="-6" width="272" height="272" rx="56" fill="#ffffff"/>${numeraMarkSvg(NUMERA_COLORS, 'fav')}\n</svg>\n`)

writeFileSync('brand/numera-agentic-logo.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300" width="100%" height="100%" role="img" aria-label="Numera Agentic">\n` +
  `  <g transform="translate(40, 40)">${numeraMarkSvg(NUMERA_COLORS, 'lg')}\n  </g>\n` +
  `  <g transform="translate(320, 140)">\n` +
  `    <text x="0" y="0" font-family="'Plus Jakarta Sans', 'Inter', 'Segoe UI', sans-serif" font-weight="800" font-size="92" fill="#0A3B66" letter-spacing="-1.5">Numera</text>\n` +
  `    <text x="5" y="42" font-family="'Inter', 'Segoe UI', sans-serif" font-weight="700" font-size="18" fill="#5A6E85" letter-spacing="3.5">AGENTIC · PROSPECTION IA</text>\n` +
  `    <text x="5" y="70" font-family="'Inter', 'Segoe UI', sans-serif" font-weight="600" font-size="14" fill="#00A86B" letter-spacing="2.5">RÉSEAUX SOCIAUX • WHATSAPP • CLOSING</text>\n` +
  `  </g>\n</svg>\n`)
console.log('public/numera-mark.svg et brand/numera-agentic-logo.svg régénérés')
