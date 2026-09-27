import type { AdminStats, AdminSubscription, Entitlements, PaymentRow, Plan } from '../lib/types'

// Données de démonstration des abonnements (identiques aux formules de la migration 0009).

export const demoPlans: Plan[] = [
  {
    id: 'starter', name: 'Découverte', description: 'Pour lancer un produit et tester l\'agent.',
    prices: { XAF: { month: 15000, year: 150000 }, EUR: { month: 25, year: 250 }, USD: { month: 27, year: 270 } },
    limits: { products: 1, whatsapp_numbers: 1, ai_actions: 300, members: 1 },
    features: ['1 produit', '1 numéro WhatsApp', '300 actions IA / mois', 'Pilote automatique WhatsApp', 'Alertes Telegram et e-mail'],
  },
  {
    id: 'pro', name: 'Pro', description: 'Pour prospecter plusieurs offres, tous les jours.',
    prices: { XAF: { month: 35000, year: 350000 }, EUR: { month: 55, year: 550 }, USD: { month: 59, year: 590 } },
    limits: { products: 5, whatsapp_numbers: 3, ai_actions: 2000, members: 2 },
    features: ['5 produits', '3 numéros WhatsApp', '2 000 actions IA / mois', 'Relances automatiques', 'Rapports complets'],
  },
  {
    id: 'team', name: 'Équipe', description: 'Pour une équipe commerciale et un gros volume.',
    prices: { XAF: { month: 75000, year: 750000 }, EUR: { month: 119, year: 1190 }, USD: { month: 129, year: 1290 } },
    limits: { products: 20, whatsapp_numbers: 10, ai_actions: 8000, members: 5 },
    features: ['20 produits', '10 numéros WhatsApp', '8 000 actions IA / mois', '5 utilisateurs', 'Support prioritaire'],
  },
]

const day = 86_400_000
export const demoEntitlements: Entitlements = {
  plan_id: 'pro', plan_name: 'Pro', status: 'trialing', provider: null,
  trial_ends_at: new Date(Date.now() + 9 * day).toISOString(), current_period_end: null, cancel_at_period_end: false,
  has_access: true,
  limits: { products: 5, whatsapp_numbers: 3, ai_actions: 2000, members: 2 },
  usage: { products: 2, whatsapp_numbers: 1, ai_actions: 412, members: 1 },
}

export const demoPayments: PaymentRow[] = []

// Espace propriétaire : un portefeuille fictif mais cohérent (montants en XAF).
const names = [
  'Wax & Co', 'Groupe Mballa BTP', 'Brasseries du Littoral', 'Cabinet Ekambi', 'Tchoupo Logistique', 'Hôtel Akwa Palace',
  'Nana Distribution', 'Studio Ndoumbe', 'Clinique Sainte-Anne', 'Agence Ifrane', 'École Les Palmiers', 'AfriTech Solutions',
  'Boulangerie Moderne', 'Immo Bonapriso', 'Kmer Auto', 'Dakar Digital', 'Abidjan Events', 'Pharma Plus',
]
const plan = (i: number) => (i % 5 === 0 ? 'team' : i % 2 === 0 ? 'pro' : 'starter')
const planName = { starter: 'Découverte', pro: 'Pro', team: 'Équipe' } as const
const prices = { starter: 15000, pro: 35000, team: 75000 } as const
const providers = ['flutterwave', 'flutterwave', 'stripe', 'paypal', 'flutterwave', 'manual'] as const

const subs: AdminSubscription[] = names.map((n, i) => {
  const p = plan(i)
  const status: AdminSubscription['status'] = i < 12 ? 'active' : i < 15 ? 'trialing' : i === 15 ? 'past_due' : i === 16 ? 'canceled' : 'expired'
  const provider = status === 'trialing' ? null : providers[i % providers.length]
  const currency = provider === 'stripe' || provider === 'paypal' ? 'EUR' : 'XAF'
  const amount = currency === 'EUR' ? { starter: 25, pro: 55, team: 119 }[p] : prices[p]
  const mrr = ['active', 'past_due'].includes(status) ? Math.round(currency === 'EUR' ? amount * 655.957 : amount) : 0
  return {
    organization_id: `org-${i}`, organization: n, owner_email: `contact@${n.toLowerCase().replace(/[^a-z]/g, '')}.cm`,
    plan: planName[p], plan_id: p, status, provider, currency: status === 'trialing' ? null : currency,
    amount: status === 'trialing' ? null : amount, interval: status === 'trialing' ? null : 'month', mrr_xaf: mrr,
    trial_ends_at: status === 'trialing' ? new Date(Date.now() + (3 + i) * day).toISOString() : null,
    current_period_end: status === 'trialing' ? null : new Date(Date.now() + ((i * 7) % 28 + 1) * day).toISOString(),
    created_at: new Date(Date.now() - (i * 11 + 5) * day).toISOString(),
  }
})

export function demoAdminStats(months: number): AdminStats {
  const mrr = subs.reduce((s, x) => s + x.mrr_xaf, 0)
  const monthly = Array.from({ length: months }, (_, k) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - (months - 1 - k))
    const growth = (k + 1) / months
    return {
      month: d.toISOString().slice(0, 7),
      revenue: Math.round(mrr * growth * (0.9 + ((k * 37) % 10) / 50)),
      ai_cost: Math.round(mrr * growth * 0.11),
      signups: 2 + ((k * 5) % 6),
    }
  })
  const byPlan = (['team', 'pro', 'starter'] as const).map((p) => ({
    plan: planName[p],
    subscribers: subs.filter((s) => s.plan_id === p && s.mrr_xaf > 0).length,
    mrr: subs.filter((s) => s.plan_id === p).reduce((t, s) => t + s.mrr_xaf, 0),
  }))
  const revenue12 = monthly.reduce((t, m) => t + m.revenue, 0)
  return {
    currency: 'XAF',
    kpis: {
      mrr, arr: mrr * 12, collected_this_month: monthly[monthly.length - 1].revenue,
      active: subs.filter((s) => s.status === 'active').length, trialing: subs.filter((s) => s.status === 'trialing').length,
      past_due: subs.filter((s) => s.status === 'past_due').length, canceled_this_month: 1, organizations: subs.length,
      trial_conversion: 68, ai_cost_this_month_xaf: monthly[monthly.length - 1].ai_cost,
    },
    monthly,
    by_plan: byPlan,
    by_provider: [
      { provider: 'flutterwave', revenue: Math.round(revenue12 * 0.58) }, { provider: 'stripe', revenue: Math.round(revenue12 * 0.21) },
      { provider: 'paypal', revenue: Math.round(revenue12 * 0.13) }, { provider: 'manual', revenue: Math.round(revenue12 * 0.08) },
    ],
    subscriptions: [...subs].sort((a, b) => b.mrr_xaf - a.mrr_xaf),
    recent_payments: subs.filter((s) => s.mrr_xaf > 0).slice(0, 8).map((s, i) => ({
      organization: s.organization, provider: s.provider ?? 'manual', amount: s.amount ?? 0, currency: s.currency ?? 'XAF',
      amount_xaf: s.mrr_xaf, status: i === 5 ? 'failed' : 'succeeded', paid_at: new Date(Date.now() - i * 1.7 * day).toISOString(),
    })),
  }
}
