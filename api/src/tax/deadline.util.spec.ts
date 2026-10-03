import {
  daysUntilDue,
  estimateLatePenalty,
  monthsLate,
  formatPeriod,
  previousPeriod,
  urgencyLevel,
  vatDueDate,
} from './deadline.util';

describe('vatDueDate', () => {
  it('fixe l’échéance au 15 du mois suivant, 23:59:59 UTC', () => {
    expect(vatDueDate({ year: 2026, month: 4 }).toISOString()).toBe(
      '2026-05-15T23:59:59.000Z',
    );
  });

  it('passe à l’année suivante pour la période de décembre', () => {
    expect(vatDueDate({ year: 2025, month: 12 }).toISOString()).toBe(
      '2026-01-15T23:59:59.000Z',
    );
  });
});

describe('daysUntilDue', () => {
  const due = new Date('2026-05-15T23:59:59Z');

  it('compte les jours restants', () => {
    expect(daysUntilDue(due, new Date('2026-05-10T08:00:00Z'))).toBe(6);
    expect(daysUntilDue(due, new Date('2026-05-15T08:00:00Z'))).toBe(1);
  });

  it('devient négatif une fois l’échéance passée', () => {
    expect(daysUntilDue(due, new Date('2026-05-17T08:00:00Z'))).toBeLessThan(0);
  });
});

describe('urgencyLevel', () => {
  it.each([
    [-1, 'LATE'],
    [0, 'CRITICAL'],
    [2, 'CRITICAL'],
    [3, 'URGENT'],
    [5, 'URGENT'],
    [6, 'SOON'],
    [10, 'SOON'],
    [11, 'SAFE'],
  ])('%i jour(s) → %s', (days, level) => {
    expect(urgencyLevel(days)).toBe(level);
  });
});

describe('divers', () => {
  it('estime la pénalité de retard : 10 % par mois, plafond 30 % (LPF L 106)', () => {
    expect(estimateLatePenalty(100000)).toBe(10000);
    expect(estimateLatePenalty(100000, 2)).toBe(20000);
    expect(estimateLatePenalty(100000, 3)).toBe(30000);
    expect(estimateLatePenalty(100000, 7)).toBe(30000);
  });

  it('compte les mois de retard, tout mois commencé étant dû', () => {
    const due = vatDueDate({ year: 2026, month: 4 }); // 15 mai 2026
    expect(monthsLate(due, new Date(Date.UTC(2026, 4, 10)))).toBe(0);
    expect(monthsLate(due, new Date(Date.UTC(2026, 4, 16)))).toBe(1);
    expect(monthsLate(due, new Date(Date.UTC(2026, 5, 15, 12)))).toBe(1);
    expect(monthsLate(due, new Date(Date.UTC(2026, 5, 16)))).toBe(2);
    expect(monthsLate(due, new Date(Date.UTC(2026, 8, 1)))).toBe(4);
  });

  it('remonte à la période précédente', () => {
    expect(previousPeriod({ year: 2026, month: 1 })).toEqual({
      year: 2025,
      month: 12,
    });
    expect(previousPeriod({ year: 2026, month: 5 })).toEqual({
      year: 2026,
      month: 4,
    });
  });

  it('formate la période en français', () => {
    expect(formatPeriod({ year: 2026, month: 4 })).toBe('Avril 2026');
  });
});
