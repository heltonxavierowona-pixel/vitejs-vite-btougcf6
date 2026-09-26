import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';

import { AuthProvider } from '@/lib/auth-context';
import { brand } from '@/lib/brand';
import './globals.css';

/**
 * IBM Plex Sans : choisi pour ses chiffres tabulaires, qui
 * s'alignent en colonne. Indispensable quand on empile des
 * montants sur plusieurs lignes.
 */
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
});

export const metadata: Metadata = {
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  applicationName: brand.name,
  icons: { icon: brand.assets.icon, apple: brand.assets.icon },
};

export const viewport: Viewport = {
  themeColor: brand.colors.navy,
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={plex.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
