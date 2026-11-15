import Image from 'next/image';

import { brand } from '@/lib/brand';

/**
 * Logo de l’application.
 *
 * `variant="full"`  symbole + texte (écran large, page de connexion)
 * `variant="mark"`  symbole seul (en-tête mobile, favicon inline)
 * `variant="auto"`  symbole sur mobile, lockup complet à partir de sm
 */
export function Logo({
  variant = 'auto',
  height = 32,
  priority = false,
  className = '',
}: {
  variant?: 'full' | 'mark' | 'auto';
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  const full = (
    <Image
      src={brand.assets.logo}
      alt={brand.name}
      width={Math.round(height * 3.87)}
      height={height}
      priority={priority}
      className={variant === 'auto' ? 'hidden sm:block' : ''}
      style={{ height, width: 'auto' }}
    />
  );

  const mark = (
    <Image
      src={brand.assets.mark}
      alt={brand.name}
      width={Math.round(height * 1.33)}
      height={height}
      priority={priority}
      className={variant === 'auto' ? 'sm:hidden' : ''}
      style={{ height, width: 'auto' }}
    />
  );

  return (
    <span className={`inline-flex items-center ${className}`}>
      {variant !== 'mark' && full}
      {variant !== 'full' && mark}
    </span>
  );
}
