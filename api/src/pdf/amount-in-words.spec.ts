import { amountInWords } from './amount-in-words';

describe('amountInWords', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt et un'],
    [22, 'vingt-deux'],
    [61, 'soixante et un'],
    [70, 'soixante-dix'],
    [71, 'soixante et onze'],
    [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [90, 'quatre-vingt-dix'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [101, 'cent un'],
    [180, 'cent quatre-vingts'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [1000, 'mille'],
    [1001, 'mille un'],
    [2000, 'deux mille'],
    [80_000, 'quatre-vingt mille'],
    [200_000, 'deux cent mille'],
    [178_900, 'cent soixante-dix-huit mille neuf cents'],
    [1_000_000, 'un million'],
    [2_000_000, 'deux millions'],
    [200_000_000, 'deux cents millions'],
    [80_000_000, 'quatre-vingts millions'],
    [
      1_234_567,
      'un million deux cent trente-quatre mille cinq cent soixante-sept',
    ],
    [1_000_000_000, 'un milliard'],
    [3_000_000_001, 'trois milliards un'],
  ])('%i → %s', (value, words) => {
    expect(amountInWords(value)).toBe(words);
  });
});
