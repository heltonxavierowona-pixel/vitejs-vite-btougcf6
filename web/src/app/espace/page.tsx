'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Aiguillage après connexion.
 *
 * Un cabinet va sur son portefeuille ; une entreprise va
 * directement sur son unique dossier. C'est ici que se joue la
 * séparation des deux parcours — le reste de l'application est
 * commun.
 */
export default function HomePage() {
  const router = useRouter();
  const { current, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!current) {
      router.replace('/connexion');
      return;
    }

    if (current.organizationType === 'CABINET') {
      router.replace('/cabinet');
      return;
    }

    // Entreprise : on récupère son entité unique.
    void (async () => {
      try {
        const view = await api.get<{ defaultEntityId: string | null }>(
          `/organizations/${current.organizationId}/view`,
        );
        router.replace(
          view.defaultEntityId
            ? `/entreprise/${view.defaultEntityId}`
            : '/cabinet',
        );
      } catch {
        router.replace('/connexion');
      }
    })();
  }, [current, loading, router]);

  return (
    <p className="p-6 text-sm text-inksoft" role="status">
      Ouverture de votre espace…
    </p>
  );
}
