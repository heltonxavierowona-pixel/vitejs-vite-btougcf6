import { centsToStripeXaf, stripePeriodEnd, stripeXafToCents } from './stripe.service';

describe('conversion XAF ↔ Stripe', () => {
  it('le XAF est sans décimale chez Stripe : 10 000 FCFA → 10000', () => {
    expect(centsToStripeXaf(10_000 * 100)).toBe(10_000);
    expect(stripeXafToCents(10_000)).toBe(1_000_000);
  });
});

describe('stripePeriodEnd', () => {
  const item = (end: number) => ({ current_period_end: end });

  it('lit la fin de période sur les éléments de l’abonnement (API récente)', () => {
    const sub = { items: { data: [item(1_800_000_000), item(1_700_000_000)] } };
    expect(stripePeriodEnd(sub as never).getTime()).toBe(1_700_000_000_000);
  });

  it('se rabat sur l’ancien champ de l’abonnement', () => {
    const sub = { current_period_end: 1_750_000_000, items: { data: [] } };
    expect(stripePeriodEnd(sub as never).getTime()).toBe(1_750_000_000_000);
  });
});
