import {
  applyRateBp,
  computeDeclaration,
  computeInvoiceTotals,
  computeLine,
  computeWithholding,
  extractVatFromInclusive,
  roundToFranc,
} from './vat-calculator';

/**
 * Rappel d'unités : montants en centimes (1 500 FCFA = 150000),
 * quantités en millièmes (1,5 = 1500), remises en centièmes de %.
 */
describe('roundToFranc', () => {
  it('arrondit au franc le plus proche, 0,5 vers le haut', () => {
    expect(roundToFranc(28875)).toBe(28900); // 288,75 → 289
    expect(roundToFranc(28849)).toBe(28800); // 288,49 → 288
    expect(roundToFranc(28850)).toBe(28900); // 288,50 → 289
    expect(roundToFranc(0)).toBe(0);
  });

  it('reste cohérent sur les montants négatifs (avoirs)', () => {
    expect(roundToFranc(-150)).toBe(-100); // −1,5 → −1
    expect(roundToFranc(-151)).toBe(-200);
  });

  it('supporte les autres modes d’arrondi', () => {
    expect(roundToFranc(250, 'HALF_EVEN')).toBe(200);
    expect(roundToFranc(350, 'HALF_EVEN')).toBe(400);
    expect(roundToFranc(351, 'HALF_EVEN')).toBe(400);
    expect(roundToFranc(199, 'DOWN')).toBe(100);
  });

  it('refuse un montant non entier', () => {
    expect(() => roundToFranc(10.5)).toThrow(RangeError);
  });
});

describe('computeLine', () => {
  it('calcule HT, TVA 19,25 % et TTC', () => {
    // 1 × 1 500 FCFA
    expect(
      computeLine({ unitPrice: 150000, quantity: 1000, vatRate: 'STANDARD' }),
    ).toEqual({ exclVat: 150000, vat: 28875, inclVat: 178875, rateBp: 1925 });
  });

  it('gère les quantités décimales avec un seul arrondi final', () => {
    // 1,5 × 3 333,33 FCFA = 4 999,995 → 5 000,00
    const line = computeLine({
      unitPrice: 333333,
      quantity: 1500,
      vatRate: 'ZERO',
    });
    expect(line.exclVat).toBe(500000);
    expect(line.vat).toBe(0);
  });

  it('applique la remise avant la TVA', () => {
    // 3 × 1 000 FCFA − 12,5 % = 2 625 FCFA
    const line = computeLine({
      unitPrice: 100000,
      quantity: 3000,
      discountPct: 1250,
      vatRate: 'STANDARD',
    });
    expect(line.exclVat).toBe(262500);
    expect(line.vat).toBe(50531); // 505,3125 → 505,31
  });

  it('reste exact sur de très gros montants (au-delà de 2^53 en intermédiaire)', () => {
    // 1 000 unités × 10 milliards de FCFA, remise 0,01 %
    const line = computeLine({
      unitPrice: 1_000_000_000_000,
      quantity: 1_000_000,
      discountPct: 1,
      vatRate: 'EXEMPT',
    });
    expect(line.exclVat).toBe(999_900_000_000_000);
  });

  it('refuse les remises hors de 0–100 % et les valeurs non entières', () => {
    expect(() =>
      computeLine({
        unitPrice: 100,
        quantity: 1000,
        discountPct: 10001,
        vatRate: 'STANDARD',
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeLine({ unitPrice: 10.5, quantity: 1000, vatRate: 'STANDARD' }),
    ).toThrow(RangeError);
  });
});

describe('computeInvoiceTotals', () => {
  it('somme la TVA ligne par ligne puis arrondit les totaux au franc', () => {
    const totals = computeInvoiceTotals([
      { unitPrice: 150000, quantity: 1000, vatRate: 'STANDARD' },
      { unitPrice: 150000, quantity: 1000, vatRate: 'STANDARD' },
      { unitPrice: 50000, quantity: 2000, vatRate: 'EXEMPT' },
    ]);

    expect(totals.subtotalExclVat).toBe(400000);
    // 2 × 288,75 = 577,50 → 578
    expect(totals.vatAmount).toBe(57800);
    // TTC = HT + TVA arrondis, jamais un troisième arrondi
    expect(totals.totalInclVat).toBe(457800);
    expect(totals.breakdown).toEqual([
      { rate: 'STANDARD', base: 300000, vat: 57800 },
      { rate: 'EXEMPT', base: 100000, vat: 0 },
    ]);
  });

  it('retourne des totaux nuls pour une facture vide', () => {
    const totals = computeInvoiceTotals([]);
    expect(totals.totalInclVat).toBe(0);
    expect(totals.breakdown).toEqual([]);
  });
});

describe('extractVatFromInclusive', () => {
  it('retrouve la base HT depuis un TTC', () => {
    expect(extractVatFromInclusive(119250, 'STANDARD')).toEqual({
      exclVat: 100000,
      vat: 19250,
    });
    expect(extractVatFromInclusive(5000, 'EXEMPT')).toEqual({
      exclVat: 5000,
      vat: 0,
    });
  });
});

describe('applyRateBp', () => {
  it('applique un taux en points de base, signe conservé', () => {
    expect(applyRateBp(100000, 2500)).toBe(25000);
    expect(applyRateBp(-100000, 2500)).toBe(-25000);
    expect(applyRateBp(3, 5000)).toBe(2); // 1,5 → 2
  });
});

describe('computeWithholding', () => {
  it("ne s'applique qu'à un acheteur assujetti réglant un non-assujetti", () => {
    const base = { invoiceAmount: 100000 };
    expect(
      computeWithholding({
        ...base,
        buyerIsVatSubject: true,
        supplierIsVatSubject: false,
      }),
    ).toBe(19300); // 192,50 → 193
    expect(
      computeWithholding({
        ...base,
        buyerIsVatSubject: true,
        supplierIsVatSubject: true,
      }),
    ).toBe(0);
    expect(
      computeWithholding({
        ...base,
        buyerIsVatSubject: false,
        supplierIsVatSubject: false,
      }),
    ).toBe(0);
  });
});

describe('computeDeclaration', () => {
  it('calcule la TVA nette à payer', () => {
    expect(
      computeDeclaration({ vatCollected: 100000, vatDeductible: 30000 }),
    ).toEqual({
      vatCollected: 100000,
      vatDeductible: 30000,
      vatCredit: 0,
      vatDue: 70000,
      carryForward: 0,
      isNil: false,
    });
  });

  it('dégage un crédit reportable quand les achats dépassent les ventes', () => {
    const result = computeDeclaration({
      vatCollected: 10000,
      vatDeductible: 30000,
    });
    expect(result.vatDue).toBe(0);
    expect(result.carryForward).toBe(20000);
  });

  it('impute le crédit de la période précédente', () => {
    const result = computeDeclaration({
      vatCollected: 100000,
      vatDeductible: 30000,
      previousCredit: 50000,
    });
    expect(result.vatDue).toBe(20000);
    expect(result.carryForward).toBe(0);
  });

  it('signale une déclaration néant, qui reste obligatoire', () => {
    const result = computeDeclaration({ vatCollected: 0, vatDeductible: 0 });
    expect(result.isNil).toBe(true);
    expect(result.vatDue).toBe(0);
  });
});
