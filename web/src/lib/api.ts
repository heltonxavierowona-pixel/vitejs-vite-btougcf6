/**
 * ============================================================
 *  CLIENT API
 * ============================================================
 *
 *  Tous les appels réseau passent d'ici. Aucun composant ne
 *  fait de fetch directement.
 *
 *  Le jeton d'accès expire en 15 minutes : le client rejoue
 *  automatiquement la requête après rafraîchissement, une seule
 *  fois, pour éviter les boucles.
 * ============================================================
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

const ACCESS_KEY = 'numera.access';
const REFRESH_KEY = 'numera.refresh';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ------------------------------------------------------------
//  Jetons
// ------------------------------------------------------------

/**
 * Stockage local : peut être indisponible (navigation privée,
 * stockage bloqué). Chaque accès est protégé pour que l'appli
 * reste utilisable, au pire sans session persistante.
 */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const tokens = {
  get access() {
    return storage()?.getItem(ACCESS_KEY) ?? null;
  },
  get refresh() {
    return storage()?.getItem(REFRESH_KEY) ?? null;
  },
  set(access: string, refresh?: string) {
    try {
      storage()?.setItem(ACCESS_KEY, access);
      if (refresh) storage()?.setItem(REFRESH_KEY, refresh);
    } catch {
      // Quota ou stockage bloqué : la session reste en mémoire le temps de l'onglet.
    }
  },
  clear() {
    try {
      storage()?.removeItem(ACCESS_KEY);
      storage()?.removeItem(REFRESH_KEY);
    } catch {
      // idem
    }
  },
};

// ------------------------------------------------------------
//  Requête
// ------------------------------------------------------------

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Interne : empêche une boucle de rafraîchissement. */
  _retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, headers, ...rest } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(tokens.access && { Authorization: `Bearer ${tokens.access}` }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      'Serveur injoignable. Vérifiez votre connexion internet.',
      0,
    );
  }

  // Jeton expiré : on rafraîchit puis on rejoue, une seule fois.
  if (response.status === 401 && !_retried && tokens.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...options, _retried: true });
    }
    tokens.clear();
    if (typeof window !== 'undefined') window.location.href = '/connexion';
    throw new ApiError('Session expirée', 401);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractMessage(payload) ?? 'Une erreur est survenue',
      response.status,
      payload,
    );
  }

  return payload as T;
}

/**
 * NestJS renvoie parfois message sous forme de tableau
 * (erreurs de validation champ par champ).
 */
function extractMessage(payload: any): string | null {
  if (!payload) return null;
  if (Array.isArray(payload.message)) return payload.message.join('. ');
  return payload.message ?? null;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Mutualise le rafraîchissement si plusieurs requêtes échouent en même temps. */
async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh }),
      });
      if (!response.ok) return false;
      const data = await response.json();
      // Rotation : le serveur émet un nouveau jeton de
      // rafraîchissement à chaque appel, l'ancien est invalidé.
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /**
   * Ouvre un PDF dans un nouvel onglet, jeton inclus.
   *
   * L'onglet est ouvert AVANT l'appel réseau : un window.open()
   * lancé après un await est bloqué par la plupart des navigateurs
   * mobiles, qui n'y voient plus un geste de l'utilisateur.
   */
  async openPdf(path: string) {
    const tab = window.open('', '_blank');
    try {
      const fetchPdf = () =>
        fetch(`${BASE_URL}${path}`, {
          headers: { Authorization: `Bearer ${tokens.access}` },
        });
      let response = await fetchPdf();
      if (response.status === 401 && (await tryRefresh())) {
        response = await fetchPdf();
      }
      if (!response.ok) throw new ApiError('PDF indisponible', response.status);

      const url = URL.createObjectURL(await response.blob());
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      throw error;
    }
  },
};

// ------------------------------------------------------------
//  Types partagés avec l'API
// ------------------------------------------------------------

export type OrganizationType = 'ENTREPRISE' | 'CABINET';
export type Role = 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'OPERATOR' | 'VIEWER';
export type Urgency = 'SAFE' | 'SOON' | 'URGENT' | 'CRITICAL' | 'LATE';

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  role: Role;
  entityCount: number;
  restrictedTo: string[] | null;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Éditeur de Numera : accès à l'écran d'administration. */
  isPlatformAdmin?: boolean;
}

export interface AuthResponse {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  memberships?: Membership[];
  organization?: { id: string; name: string; type: OrganizationType };
  entityId?: string | null;
}

export interface PortfolioRow {
  entityId: string;
  legalName: string;
  niu: string;
  taxRegime: string;
  isVatSubject: boolean;
  declarationId: string | null;
  status: string;
  vatDue: number;
  carryForward: number;
  receiptRef: string | null;
  pendingDrafts: number;
  assignedTo: Array<{ id: string; name: string }>;
  urgency: Urgency;
}

export interface CabinetDashboard {
  period: { year: number; month: number };
  periodLabel: string;
  dueDate: string;
  daysLeft: number;
  urgency: Urgency;
  summary: {
    total: number;
    submitted: number;
    pending: number;
    late: number;
    blocked: number;
    totalVatDue: number;
  };
  portfolio: PortfolioRow[];
  workload: Array<{ id: string; name: string; total: number; done: number }>;
  estimatedPenalties: number;
}

export interface EntityDashboard {
  period: { year: number; month: number };
  periodLabel: string;
  nextDeadline: {
    label: string;
    dueDate: string;
    daysLeft: number;
    urgency: Urgency;
    status: string;
    vatDue: number;
  };
  pendingDrafts: number;
  receivables: {
    totalOutstanding: number;
    overdueCount: number;
    overdueAmount: number;
    items: Array<{
      id: string;
      number: string | null;
      partyName: string | null;
      dueAt: string | null;
      totalInclVat: number;
      paidAmount: number;
      balanceDue: number;
    }>;
  };
  recentInvoices: Array<{
    id: string;
    number: string | null;
    direction: 'SALE' | 'PURCHASE';
    type: 'INVOICE' | 'CREDIT_NOTE' | 'PROFORMA';
    partyName: string | null;
    issuedAt: string;
    totalInclVat: number;
    status: string;
  }>;
}

export interface EntitySummary {
  id: string;
  legalName: string;
  tradeName: string | null;
  niu: string;
  taxRegime: string;
  isVatSubject: boolean;
  city: string;
  isActive: boolean;
}

export interface Party {
  id: string;
  name: string;
  niu: string | null;
  isVatSubject: boolean;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  _count?: { invoices: number };
}

export interface Product {
  id: string;
  reference: string | null;
  label: string;
  description: string | null;
  unitPrice: number;
  unit: string;
  vatRate: 'STANDARD' | 'ZERO' | 'EXEMPT';
  isService: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
