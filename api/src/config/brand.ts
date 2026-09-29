/**
 * Identité de marque côté serveur.
 * Utilisée dans les PDF générés, les e-mails et les messages
 * de relance. Doit rester alignée sur web/src/lib/brand.ts.
 */
export const BRAND = {
  name: 'Numera',
  tagline: 'Solutions comptables & TVA',
  documentFooter:
    'Document généré par Numera — Solutions comptables & TVA. ' +
    'Le dépôt officiel doit être effectué sur le portail de la DGI.',
  supportEmail: process.env.SUPPORT_EMAIL ?? 'heltonxavierowona@gmail.com',
} as const;
