'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

import { canEdit, isAdmin, useAuth } from '@/lib/auth-context';
import { api, tokens, type EntitySummary } from '@/lib/api';
import { roleLabel } from '@/lib/format';
import { Button, Loading } from '@/components/ui';
import { Logo } from '@/components/brand';

/**
 * Enveloppe des pages authentifiées.
 *
 * En-tête : le logo identifie le produit, le nom qui suit
 * identifie le cabinet ou l'entreprise connectée.
 *
 * Navigation : un cabinet navigue dans un portefeuille, puis
 * dans un dossier ; une entreprise reste sur son propre dossier.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, current, memberships, loading, logout, selectOrganization } =
    useAuth();

  useEffect(() => {
    if (!loading && (!tokens.access || !current)) router.replace('/connexion');
  }, [loading, current, router]);

  if (loading || !current) return <Loading />;

  const isCabinet = current.organizationType === 'CABINET';
  const entityId = pathname.match(/^\/entreprise\/([^/]+)/)?.[1] ?? null;

  return (
    <div className="min-h-screen">
      <header className="bg-paper border-b border-line sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link
            href="/espace"
            className="flex items-center gap-3 min-w-0"
            aria-label="Accueil"
          >
            <Logo height={26} priority />
            <span className="text-line" aria-hidden>
              |
            </span>
            <span className="font-medium truncate text-sm">
              {current.organizationName}
            </span>
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            {memberships.length > 1 && (
              <select
                value={current.organizationId}
                onChange={(e) => selectOrganization(e.target.value)}
                aria-label="Changer d’organisation"
                className="hidden sm:block h-8 max-w-44 px-2 text-sm bg-surface border border-line rounded-[3px]"
              >
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName}
                  </option>
                ))}
              </select>
            )}

            <span
              className="hidden md:block text-xs text-inksoft text-right leading-tight"
              title={user?.email}
            >
              {user ? `${user.firstName} ${user.lastName}` : ''}
              <span className="block">{roleLabel[current.role]}</span>
            </span>

            {user?.isPlatformAdmin && (
              <Link
                href="/admin/paiements"
                className={`h-8 px-3 flex items-center text-sm font-medium rounded-[4px] ${
                  pathname.startsWith('/admin') ? 'bg-primarysoft text-primary' : 'text-inksoft hover:text-ink hover:bg-surface'
                }`}
              >
                Admin
              </Link>
            )}

            <Button variant="ghost" onClick={logout} className="h-8 px-3">
              Déconnexion
            </Button>
          </div>
        </div>

        {isCabinet && !entityId && (
          <Tabs
            items={[
              { href: '/cabinet', label: 'Portefeuille', exact: true },
              ...(isAdmin(current.role)
                ? [{ href: '/cabinet/dossiers/nouveau', label: 'Nouveau dossier' }]
                : []),
              { href: '/abonnement', label: 'Abonnement' },
            ]}
            pathname={pathname}
          />
        )}

        {entityId && (
          <EntityNav
            entityId={entityId}
            organizationId={current.organizationId}
            isCabinet={isCabinet}
            role={current.role}
            pathname={pathname}
          />
        )}

        {!isCabinet && !entityId && pathname === '/abonnement' && (
          <Tabs
            items={[{ href: '/abonnement', label: 'Abonnement' }]}
            pathname={pathname}
            back={{ href: '/espace', label: 'Mon entreprise' }}
          />
        )}
      </header>

      <main>{children}</main>
    </div>
  );
}

// ------------------------------------------------------------

function EntityNav({
  entityId,
  organizationId,
  isCabinet,
  role,
  pathname,
}: {
  entityId: string;
  organizationId: string;
  isCabinet: boolean;
  role: string;
  pathname: string;
}) {
  const [entity, setEntity] = useState<EntitySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<EntitySummary>(`/organizations/${organizationId}/entities/${entityId}`)
      .then((data) => !cancelled && setEntity(data))
      .catch(() => !cancelled && setEntity(null));
    return () => {
      cancelled = true;
    };
  }, [entityId, organizationId]);

  const base = `/entreprise/${entityId}`;

  return (
    <>
      {isCabinet && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 flex items-center gap-2 text-sm">
          <Link href="/cabinet" className="text-inksoft hover:text-ink">
            ← Portefeuille
          </Link>
          {entity && (
            <>
              <span className="text-line" aria-hidden>
                /
              </span>
              <span className="font-medium truncate">{entity.legalName}</span>
              {!entity.isActive && (
                <span className="text-xs text-soon">· archivé</span>
              )}
            </>
          )}
        </div>
      )}
      <Tabs
        pathname={pathname}
        items={[
          { href: base, label: 'Tableau de bord', exact: true },
          { href: `${base}/factures`, label: 'Factures' },
          { href: `${base}/tiers`, label: 'Clients et fournisseurs' },
          { href: `${base}/catalogue`, label: 'Catalogue' },
          { href: `${base}/declarations`, label: 'Déclarations TVA' },
          ...(canEdit(role) ? [{ href: `${base}/parametres`, label: 'Paramètres' }] : []),
          ...(!isCabinet ? [{ href: '/abonnement', label: 'Abonnement' }] : []),
        ]}
      />
    </>
  );
}

function Tabs({
  items,
  pathname,
  back,
}: {
  items: Array<{ href: string; label: string; exact?: boolean }>;
  pathname: string;
  back?: { href: string; label: string };
}) {
  return (
    <nav
      aria-label="Navigation principale"
      className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto no-scrollbar"
    >
      {back && (
        <Link
          href={back.href}
          className="px-3 h-10 flex items-center text-sm text-inksoft hover:text-ink whitespace-nowrap"
        >
          ← {back.label}
        </Link>
      )}
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 h-10 flex items-center text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-inksoft hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
