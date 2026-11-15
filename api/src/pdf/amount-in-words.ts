/**
 * ============================================================
 *  MONTANT EN TOUTES LETTRES (français, orthographe usuelle)
 * ============================================================
 *
 *  Mention d'usage sur les factures : « Arrêtée la présente
 *  facture à la somme de … francs CFA ».
 *
 *  Règles appliquées :
 *   - « et » devant un : vingt et un … soixante et onze,
 *     mais quatre-vingt-un, quatre-vingt-onze ;
 *   - « vingts » et « cents » prennent un s quand ils sont
 *     multipliés et terminent le nombre (quatre-vingts, deux
 *     cents), mais pas devant « mille » (deux cent mille) ;
 *     devant million/milliard, qui sont des noms, ils le
 *     gardent (deux cents millions) ;
 *   - « mille » est invariable ; million et milliard s'accordent.
 * ============================================================
 */

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
  'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];

const TENS = [
  '', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante',
];

/** 0 < n < 100. `plural` : « quatre-vingts » autorisé en fin. */
function below100(n: number, plural: boolean): string {
  if (n < 20) return UNITS[n];

  const tens = Math.floor(n / 10);
  const unit = n % 10;

  if (tens < 7) {
    if (unit === 0) return TENS[tens];
    if (unit === 1) return `${TENS[tens]} et un`;
    return `${TENS[tens]}-${UNITS[unit]}`;
  }

  if (tens === 7) {
    // 70–79 : soixante-dix, soixante et onze, soixante-douze…
    return unit === 1 ? 'soixante et onze' : `soixante-${UNITS[10 + unit]}`;
  }

  // 80–99 : quatre-vingts, quatre-vingt-un, quatre-vingt-dix…
  const rest = n - 80;
  if (rest === 0) return plural ? 'quatre-vingts' : 'quatre-vingt';
  return `quatre-vingt-${UNITS[rest]}`;
}

/** 0 < n < 1000. `plural` : accord de « cents » / « vingts » en fin. */
function below1000(n: number, plural: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  const parts: string[] = [];
  if (hundreds === 1) parts.push('cent');
  else if (hundreds > 1) {
    parts.push(
      `${UNITS[hundreds]} ${rest === 0 && plural ? 'cents' : 'cent'}`,
    );
  }
  if (rest > 0) parts.push(below100(rest, plural));

  return parts.join(' ');
}

const SCALES: Array<{ value: number; singular: string; plural: string }> = [
  { value: 1_000_000_000, singular: 'milliard', plural: 'milliards' },
  { value: 1_000_000, singular: 'million', plural: 'millions' },
];

export function amountInWords(value: number): string {
  let n = Math.abs(Math.trunc(value));
  if (n === 0) return UNITS[0];
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('Montant trop grand pour être écrit en lettres');
  }

  const parts: string[] = [];

  for (const scale of SCALES) {
    const count = Math.floor(n / scale.value);
    if (count > 0) {
      // Million et milliard sont des noms : « deux cents millions ».
      const head = count >= 1000 ? amountInWords(count) : below1000(count, true);
      parts.push(`${head} ${count > 1 ? scale.plural : scale.singular}`);
      n %= scale.value;
    }
  }

  const thousands = Math.floor(n / 1000);
  if (thousands > 0) {
    // « mille » est invariable et bloque le pluriel qui précède.
    parts.push(thousands === 1 ? 'mille' : `${below1000(thousands, false)} mille`);
    n %= 1000;
  }

  if (n > 0) parts.push(below1000(n, true));

  return (value < 0 ? 'moins ' : '') + parts.join(' ');
}
