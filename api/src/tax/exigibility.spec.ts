import {
  nonDeductibleReasons,
  serviceVatExigibleBefore,
  serviceVatForPeriod,
} from './exigibility';

const d = (m: number, day = 1) => new Date(Date.UTC(2026, m - 1, day));

// Prestation de 1 000 000 HT + 192 500 TVA, en centimes.
const service = {
  totalInclVat: 119_250_000,
  serviceInclVat: 119_250_000,
  serviceVat: 19_250_000,
  settlements: [] as Array<{ at: Date; amount: number }>,
  credits: [] as Array<{ at: Date; serviceInclVat: number }>,
};

describe('TVA sur services exigible à l’encaissement (CGI art. 134)', () => {
  it('rien n’est exigible tant que rien n’est encaissé', () => {
    expect(serviceVatForPeriod(service, d(3), d(4))).toBe(0);
  });

  it('suit les encaissements, acomptes compris', () => {
    const inv = {
      ...service,
      settlements: [
        { at: d(3, 20), amount: 59_625_000 }, // moitié en mars
        { at: d(5, 10), amount: 59_625_000 }, // solde en mai
      ],
    };
    expect(serviceVatForPeriod(inv, d(3), d(4))).toBe(9_625_000);
    expect(serviceVatForPeriod(inv, d(4), d(5))).toBe(0);
    expect(serviceVatForPeriod(inv, d(5), d(6))).toBe(9_625_000);
  });

  it('un avoir sur une facture impayée ne crée aucune déduction', () => {
    const inv = {
      ...service,
      credits: [{ at: d(3, 25), serviceInclVat: 119_250_000 }],
    };
    expect(serviceVatForPeriod(inv, d(3), d(4))).toBe(0);
  });

  it('un avoir après encaissement récupère la TVA déjà déclarée (art. 146)', () => {
    const inv = {
      ...service,
      settlements: [{ at: d(3, 5), amount: 119_250_000 }],
      credits: [{ at: d(4, 2), serviceInclVat: 59_625_000 }],
    };
    expect(serviceVatForPeriod(inv, d(3), d(4))).toBe(19_250_000);
    expect(serviceVatForPeriod(inv, d(4), d(5))).toBe(-9_625_000);
  });

  it('ne retient que la part services d’une facture mixte', () => {
    const inv = {
      totalInclVat: 238_500_000, // moitié biens, moitié services
      serviceInclVat: 119_250_000,
      serviceVat: 19_250_000,
      settlements: [{ at: d(3, 5), amount: 119_250_000 }],
      credits: [],
    };
    expect(serviceVatExigibleBefore(inv, d(4))).toBe(9_625_000);
  });
});

describe('droit à déduction', () => {
  const base = {
    partyNiu: 'M012345678901A',
    totalInclVat: 5_000_000,
    vatNonDeductible: false,
    paymentMethods: [] as string[],
  };

  it('accepte un achat régulier', () => {
    expect(nonDeductibleReasons(base)).toEqual([]);
  });

  it('refuse une facture sans NIU (LPF L 101)', () => {
    expect(nonDeductibleReasons({ ...base, partyNiu: null })).toEqual(['NO_NIU']);
  });

  it('refuse un achat de 100 000 FCFA ou plus payé en espèces (art. 143-1-d)', () => {
    expect(
      nonDeductibleReasons({ ...base, totalInclVat: 10_000_000, paymentMethods: ['CASH'] }),
    ).toEqual(['CASH']);
    expect(
      nonDeductibleReasons({ ...base, totalInclVat: 9_999_900, paymentMethods: ['CASH'] }),
    ).toEqual([]);
    expect(
      nonDeductibleReasons({
        ...base,
        totalInclVat: 10_000_000,
        paymentMethods: ['BANK_TRANSFER'],
      }),
    ).toEqual([]);
  });

  it('refuse une dépense exclue par nature (art. 144)', () => {
    expect(nonDeductibleReasons({ ...base, vatNonDeductible: true })).toEqual([
      'EXCLUDED_EXPENSE',
    ]);
  });
});
