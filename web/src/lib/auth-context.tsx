'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import { api, tokens, AuthResponse, Membership, SessionUser } from './api';

interface AuthState {
  user: SessionUser | null;
  memberships: Membership[];
  /** Organisation active — un utilisateur peut en avoir plusieurs. */
  current: Membership | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  selectOrganization: (organizationId: string) => void;
  refreshMemberships: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const CURRENT_ORG_KEY = 'numera.org';

function readSavedOrg(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_ORG_KEY);
  } catch {
    return null;
  }
}

function saveOrg(organizationId: string | null) {
  try {
    if (organizationId) window.localStorage.setItem(CURRENT_ORG_KEY, organizationId);
    else window.localStorage.removeItem(CURRENT_ORG_KEY);
  } catch {
    // Stockage indisponible : l'organisation active reste en mémoire.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Applique une session fraîchement ouverte (connexion ou inscription). */
  const applySession = useCallback((data: AuthResponse) => {
    tokens.set(data.accessToken, data.refreshToken);
    setUser(data.user);

    const list = data.memberships ?? [];
    setMemberships(list);

    const first = list[0]?.organizationId ?? null;
    setCurrentId(first);
    saveOrg(first);
  }, []);

  const loadSession = useCallback(async () => {
    if (!tokens.access && !tokens.refresh) {
      setLoading(false);
      return;
    }
    try {
      const [me, list] = await Promise.all([
        api.get<SessionUser>('/auth/me'),
        api.get<Membership[]>('/auth/me/organizations'),
      ]);
      setUser(me);
      setMemberships(list);

      const saved = readSavedOrg();
      const valid = list.find((m) => m.organizationId === saved);
      setCurrentId(valid?.organizationId ?? list[0]?.organizationId ?? null);
    } catch {
      tokens.clear();
      setUser(null);
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<AuthResponse>('/auth/login', {
        email,
        password,
      });
      applySession(data);
      router.push('/');
    },
    [applySession, router],
  );

  /**
   * Inscription : la session est appliquée AVANT la redirection,
   * sinon l'aiguillage de la page d'accueil ne voit aucune
   * organisation et renvoie vers la connexion.
   */
  const register = useCallback(
    async (payload: Record<string, unknown>) => {
      const data = await api.post<AuthResponse>('/auth/register', payload);
      applySession(data);
      router.push('/');
    },
    [applySession, router],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // La session locale est effacée quoi qu'il arrive.
    }
    tokens.clear();
    saveOrg(null);
    setUser(null);
    setMemberships([]);
    setCurrentId(null);
    router.push('/connexion');
  }, [router]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      setCurrentId(organizationId);
      saveOrg(organizationId);
      router.push('/');
    },
    [router],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      memberships,
      current:
        memberships.find((m) => m.organizationId === currentId) ?? null,
      loading,
      login,
      register,
      logout,
      selectOrganization,
      refreshMemberships: loadSession,
    }),
    [
      user,
      memberships,
      currentId,
      loading,
      login,
      register,
      logout,
      selectOrganization,
      loadSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé dans AuthProvider');
  }
  return context;
}

/** Rôles autorisés à saisir et valider. */
export function canEdit(role?: string): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'ACCOUNTANT';
}

/** Rôles autorisés à créer des brouillons et des tiers. */
export function canWrite(role?: string): boolean {
  return canEdit(role) || role === 'OPERATOR';
}

export function isAdmin(role?: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
