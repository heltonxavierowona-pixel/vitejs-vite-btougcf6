'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';

/**
 * Sur la page d'accueil publique : un utilisateur déjà connecté
 * est envoyé directement dans son espace. Les visiteurs (et les
 * robots) voient la page vitrine.
 */
export function SessionRedirect() {
  const router = useRouter();
  const { current, loading } = useAuth();

  useEffect(() => {
    if (!loading && current) router.replace('/espace');
  }, [loading, current, router]);

  return null;
}
