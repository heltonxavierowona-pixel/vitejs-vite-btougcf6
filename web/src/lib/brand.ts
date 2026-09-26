/**
 * ============================================================
 *  IDENTITÉ DE MARQUE
 * ============================================================
 *
 *  Source unique du nom, des baselines et des visuels.
 *  Aucun composant ne doit écrire « Numera » en dur : un
 *  changement de nom ou de signature se fait ici seulement.
 * ============================================================
 */

export const brand = {
  name: 'Numera',

  /** Signature longue — pages publiques, PDF, métadonnées. */
  tagline: 'Solutions comptables & TVA',

  /** Signature courte — en-têtes compacts. */
  claim: 'Factures · Comptabilité · Conformité',

  description:
    'Factures conformes et déclaration de TVA mensuelle pour les entreprises et cabinets comptables au Cameroun.',

  assets: {
    /** Symbole + texte. À utiliser dès qu’il y a de la place. */
    logo: '/numera-logo.png',
    /** Symbole seul, pour les en-têtes étroits et le mobile. */
    mark: '/numera-mark.png',
    icon: '/icon.png',
  },

  /**
   * Couleurs du logo. Elles ne remplacent PAS les tokens
   * d’interface : le vert `--color-primary` reste la couleur
   * d’action, et l’échelle d’urgence garde la priorité visuelle.
   * Celles-ci servent aux surfaces de marque (connexion,
   * en-tête public, PDF).
   */
  colors: {
    navy: '#1e4d6b',
    navyDeep: '#173f5f',
    green: '#2eb872',
    greenDeep: '#22a05f',
  },

  legal: {
    /** Pied de page des documents générés. */
    documentFooter:
      'Document généré par Numera — Solutions comptables & TVA',
  },
} as const;
