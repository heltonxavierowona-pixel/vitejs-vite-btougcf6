const nf = new Intl.NumberFormat('fr-FR')
export const fmt = (n: number) => nf.format(n)

export const usd = (n: number) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} $`

export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)} %` : '—')
