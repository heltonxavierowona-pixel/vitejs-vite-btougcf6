// Régénère public/numera-mark.svg (favicon, fond blanc) depuis src/lib/numeraMark.ts.
// Usage : node scripts/build-favicon.mjs
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const out = await build({ entryPoints: ['src/lib/numeraMark.ts'], bundle: true, format: 'esm', write: false })
const { numeraMarkSvg, NUMERA_COLORS } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
writeFileSync('public/numera-mark.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -22 128 128" role="img" aria-label="Numera">\n` +
  `  <rect x="-10" y="-22" width="128" height="128" rx="26" fill="#ffffff"/>${numeraMarkSvg(NUMERA_COLORS, 'fav')}\n</svg>\n`)
console.log('public/numera-mark.svg régénéré')
