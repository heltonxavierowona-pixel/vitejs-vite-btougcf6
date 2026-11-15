'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react';

import { urgencyStyles, type Urgency } from '@/lib/format';

/* ============================================================
   COMPOSANTS DE BASE
   ------------------------------------------------------------
   Volontairement peu nombreux. Un outil fiscal a besoin de
   densité et de lisibilité, pas d'une bibliothèque de cartes
   arrondies.
   ============================================================ */

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 h-10 rounded-[4px] ' +
    'text-sm font-medium transition-colors disabled:opacity-50 ' +
    'disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-primary text-white hover:bg-primaryhover',
    secondary:
      'bg-paper text-ink border border-line hover:bg-surface',
    ghost: 'text-inksoft hover:text-ink hover:bg-surface',
    danger: 'bg-critical text-white hover:opacity-90',
  };

  return (
    <button {...props} className={`${base} ${variants[variant]} ${className}`} />
  );
}

/**
 * Champ de formulaire. Libellé relié au contrôle par htmlFor/id,
 * aide et erreur rattachées par aria-describedby : le nom lu par
 * un lecteur d'écran reste le libellé seul.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }>;
}) {
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  const describedBy = error || hint ? `${id}-desc` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children, {
            id,
            'aria-describedby': describedBy,
            ...(error && { 'aria-invalid': true }),
          })
        : children}
      {hint && !error && (
        <span id={describedBy} className="block mt-1 text-xs text-inksoft">
          {hint}
        </span>
      )}
      {error && (
        <span id={describedBy} className="block mt-1 text-xs text-critical">
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        'w-full h-10 px-3 bg-paper border border-line rounded-[4px] ' +
        'text-sm placeholder:text-inksoft/60 ' +
        'focus:border-primary focus:outline-none ' +
        `${className}`
      }
    />
  );
}

export function Select({
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        'w-full h-10 px-3 bg-paper border border-line rounded-[4px] ' +
        `text-sm focus:border-primary focus:outline-none ${className}`
      }
    />
  );
}

/** Badge d'urgence — la couleur porte l'information. */
export function UrgencyBadge({
  urgency,
  children,
}: {
  urgency: Urgency;
  children: React.ReactNode;
}) {
  const style = urgencyStyles[urgency];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-[3px] text-xs font-medium ${style.bg} ${style.text}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-paper border border-line rounded-[5px] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between px-4 h-12 border-b border-line">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-inksoft">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'bg-primarysoft text-primary',
    warning: 'bg-soonbg text-soon',
    error: 'bg-criticalbg text-critical',
  };
  return (
    <div className={`px-3 py-2.5 rounded-[4px] text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Textarea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={
        'w-full px-3 py-2 bg-paper border border-line rounded-[4px] text-sm ' +
        `placeholder:text-inksoft/60 focus:border-primary focus:outline-none ${className}`
      }
    />
  );
}

/**
 * Fenêtre modale accessible : fermeture par Échap ou clic
 * extérieur, focus placé dans la fenêtre à l'ouverture.
 */
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 bg-ink/40 flex items-end sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} bg-paper rounded-[5px] p-5 space-y-4 my-auto outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Écran de chargement discret et homogène. */
export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p className="p-6 text-sm text-inksoft" role="status">
      {label}
    </p>
  );
}

/** Titre de page, avec action facultative à droite. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-inksoft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Message d'erreur lisible, quel que soit le type d'exception. */
export function errorMessage(error: unknown, fallback = 'Une erreur est survenue.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
