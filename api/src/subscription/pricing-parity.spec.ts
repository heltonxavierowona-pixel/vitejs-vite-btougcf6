import { PUBLIC_PLANS } from '../../../web/src/lib/pricing';
import { PLANS } from './plans';

/**
 * Le site public affiche les prix depuis web/src/lib/pricing.ts.
 * Ils doivent être exactement ceux facturés (plans.ts) : un écart
 * serait une publicité mensongère — et un motif de refus Stripe.
 */
describe('parité des tarifs site public ↔ facturation', () => {
  it('chaque formule facturée est affichée au même prix', () => {
    const shown = Object.fromEntries(PUBLIC_PLANS.map((p) => [p.code, p]));
    for (const plan of Object.values(PLANS)) {
      expect(shown[plan.code]).toMatchObject({
        label: plan.label,
        audience: plan.audience,
        priceMonthly: plan.priceMonthly,
        trialDays: plan.trialDays,
        features: plan.features,
      });
    }
    expect(PUBLIC_PLANS).toHaveLength(Object.keys(PLANS).length);
  });
});
