'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { Loading } from '@/components/ui';

const TABS = [
  { href: '/admin', label: 'Tableau de bord', exact: true },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/paiements', label: 'Paiements' },
  { href: '/admin/emails', label: 'E-mails' },
];

/** Espace de l'administratrice de la plateforme (PLATFORM_ADMIN_EMAILS). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  useEffect(() => {
    if (user && !user.isPlatformAdmin) router.replace('/espace');
  }, [user, router]);

  if (!user?.isPlatformAdmin) return <Loading />;

  return (
    <>
      <nav aria-label="Administration" className="bg-paper border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`px-3 h-10 flex items-center text-sm font-medium border-b-2 whitespace-nowrap ${
                  active ? 'border-primary text-primary' : 'border-transparent text-inksoft hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}
