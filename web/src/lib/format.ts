/**
 * ============================================================
 *  FORMATAGE
 * ============================================================
 *
 *  ⚠️ L'API travaille en CENTIMES de FCFA. Le front ne doit
 *  JAMAIS afficher une valeur brute ni envoyer un nombre
 *  décimal : toute conversion passe par ces fonctions.
 *
 *   Montants  : centimes        1 500 FCFA  ↔ 150000
 *   Quantités : millièmes       1,5         ↔ 1500
 *   Remises   : centièmes de %  12,5 %      ↔ 1250
 * ============================================================
 */

const NBSP = '\u202f';

/** Centimes → "1 500" (sans devise). */
export function formatAmount(cents: number): string {
  const francs = Math.round(cents / 100);
  return francs
    .toLocaleString('fr-FR')
    .replace(/[\u202f\u00a0]/g, NBSP);
}

/** Centimes → "1 500 FCFA". */
export function formatMoney(cents: number): string {
  return `${formatAmount(cents)}${NBSP}FCFA`;
}

/**
 * Saisie utilisateur "1 500" ou "1 500,50" → centimes.
 * Le FCFA n'ayant pas de sous-unité, les décimales sont
 * acceptées mais rarement utiles. Toute saisie invalide ou
 * négative donne 0.
 */
export function parseAmount(input: string): number {
  const cleaned = input
    .replace(/[\s\u202f\u00a0.]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return 0;
  const [whole, decimals = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
}

/** Centimes → saisie éditable "1500" (sans séparateurs). */
export function amountToInput(cents: number): string {
  return cents % 100 === 0
    ? String(cents / 100)
    : (cents / 100).toFixed(2).replace('.', ',');
}

/** Millièmes → "1,5". */
export function formatQuantity(thousandths: number): string {
  const value = thousandths / 1000;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace('.', ',');
}

export function parseQuantity(input: string): number {
  const value = Number.parseFloat(input.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0;
}

/** Centièmes de % → "12,5 %". */
export function formatPercent(hundredths: number): string {
  const value = hundredths / 100;
  return `${value.toString().replace('.', ',')}${NBSP}%`;
}

export function parsePercent(input: string): number {
  const value = Number.parseFloat(input.replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value * 100)));
}

// ------------------------------------------------------------
//  Dates
// ------------------------------------------------------------

/** Les dates métier sont stockées à minuit UTC : on les affiche en UTC. */
export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateLong(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Libellé d'une période : "Août 2026". */
export function formatPeriod(year: number, month: number): string {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    'fr-FR',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Champ <input type="date"> attend "YYYY-MM-DD".
 * Pour « aujourd'hui », on prend la date LOCALE : toISOString()
 * donnerait la date UTC, fausse d'un jour en soirée à l'ouest
 * de Greenwich ou peu après minuit à l'est.
 */
export function toDateInput(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (typeof value === 'string') return date.toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * "YYYY-MM-DD" → ISO à minuit UTC. Les dates fiscales sont des
 * jours calendaires : l'API les range par période en UTC.
 */
export function fromDateInput(value: string): string {
  return `${value}T00:00:00.000Z`;
}

// ------------------------------------------------------------
//  Urgence
// ------------------------------------------------------------

export type Urgency = 'SAFE' | 'SOON' | 'URGENT' | 'CRITICAL' | 'LATE';

/** Libellé du compte à rebours, en langage direct. */
export function urgencyLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const late = Math.abs(daysLeft);
    return late === 1 ? 'En retard d’un jour' : `En retard de ${late} jours`;
  }
  if (daysLeft === 0) return 'Dernier jour';
  if (daysLeft === 1) return 'Demain';
  return `Dans ${daysLeft} jours`;
}

/**
 * Classes Tailwind associées à chaque cran d'urgence.
 * Écrites en entier (jamais construites par concaténation) :
 * Tailwind ne génère que les classes qu'il trouve telles quelles
 * dans le code source.
 */
export const urgencyStyles: Record<
  Urgency,
  { text: string; bg: string; border: string; borderLeft: string }
> = {
  SAFE: {
    text: 'text-safe',
    bg: 'bg-safebg',
    border: 'border-safe',
    borderLeft: 'border-l-safe',
  },
  SOON: {
    text: 'text-soon',
    bg: 'bg-soonbg',
    border: 'border-soon',
    borderLeft: 'border-l-soon',
  },
  URGENT: {
    text: 'text-urgent',
    bg: 'bg-urgentbg',
    border: 'border-urgent',
    borderLeft: 'border-l-urgent',
  },
  CRITICAL: {
    text: 'text-critical',
    bg: 'bg-criticalbg',
    border: 'border-critical',
    borderLeft: 'border-l-critical',
  },
  LATE: {
    text: 'text-late',
    bg: 'bg-latebg',
    border: 'border-late',
    borderLeft: 'border-l-late',
  },
};

// ------------------------------------------------------------
//  Libellés métier
// ------------------------------------------------------------

export const declarationStatusLabel: Record<string, string> = {
  PENDING: 'À faire',
  IN_PROGRESS: 'En cours',
  READY: 'Prête à déposer',
  SUBMITTED: 'Déposée',
  PAID: 'Payée',
  LATE: 'En retard',
};

export const invoiceStatusLabel: Record<string, string> = {
  DRAFT: 'Brouillon',
  VALIDATED: 'Validée',
  SENT: 'Envoyée',
  PAID: 'Payée',
  PARTIALLY_PAID: 'Partiellement payée',
  CANCELLED: 'Annulée',
};

export const paymentMethodLabel: Record<string, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY_MTN: 'MTN Mobile Money',
  MOBILE_MONEY_ORANGE: 'Orange Money',
  BANK_TRANSFER: 'Virement bancaire',
  CHECK: 'Chèque',
  OTHER: 'Autre',
};

export const legalFormLabel: Record<string, string> = {
  EI: 'Entreprise individuelle',
  ETS: 'Établissement',
  SARL: 'SARL',
  SARLU: 'SARL unipersonnelle',
  SA: 'SA',
  SAS: 'SAS',
  GIE: 'GIE',
  ASSOCIATION: 'Association',
  AUTRE: 'Autre',
};

export const roleLabel: Record<string, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  ACCOUNTANT: 'Comptable',
  OPERATOR: 'Opérateur de saisie',
  VIEWER: 'Lecture seule',
};

export const taxRegimeLabel: Record<string, string> = {
  IGS: 'Impôt général synthétique (sans TVA)',
  RSI: 'Régime simplifié',
  REEL_NORMAL: 'Réel (TVA)',
};

export const vatRateLabel: Record<string, string> = {
  STANDARD: 'TVA 19,25 %',
  ZERO: 'Taux zéro',
  EXEMPT: 'Exonéré',
};
