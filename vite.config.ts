import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { AtRule, Plugin, Rule } from 'postcss'

// Le thème sombre suit le système, sauf si la page hôte impose un thème
// avec data-theme="light" | "dark" sur <html> (aperçu intégré, par exemple).
const scope = (selector: string, prefix: string) =>
  selector.startsWith(':root') ? prefix + selector.slice(5) : `${prefix} ${selector}`
const done = new WeakSet<AtRule>()
const themeAttribute: Plugin = {
  postcssPlugin: 'numera-theme-attribute',
  AtRule: {
    media(at) {
      if (done.has(at) || !/prefers-color-scheme:\s*dark/.test(at.params)) return
      done.add(at)
      const forced: Rule[] = []
      at.each((node) => {
        if (node.type !== 'rule') return
        const copy = node.clone()
        copy.selectors = node.selectors.map((s) => scope(s, ':root[data-theme="dark"]'))
        forced.push(copy)
        node.selectors = node.selectors.map((s) => scope(s, ':root:not([data-theme="light"])'))
      })
      at.after(forced)
    },
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [themeAttribute] } },
})
