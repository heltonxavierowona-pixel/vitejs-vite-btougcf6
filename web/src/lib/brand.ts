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

/** Informations légales de l'éditeur (champs libres, vides autorisés). */
export interface CompanyInfo {
  legalName: string;
  legalForm: string;
  registration: string;
  address: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  publisher: string;
  host: string;
}

/**
 * ==========================================================
 *  ÉDITEUR DU SITE — affiché sur les pages publiques
 *  (mentions légales, CGV, contact).
 *
 *  ⚠️ À RENSEIGNER avant la mise en ligne : les prestataires de
 *  paiement (Neero…) vérifient que
 *  ces informations correspondent à celles de votre compte.
 *  Une valeur vide masque la ligne correspondante.
 * ==========================================================
 */
/**
 * Chaque valeur peut être remplacée dans Vercel (projet « numera »,
 * variables NEXT_PUBLIC_COMPANY_*), puis prise en compte au
 * redéploiement du site : inutile de toucher au code.
 */
const COMPANY: CompanyInfo = {
  /** Raison sociale ou nom de l'entrepreneur. */
  legalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME || 'Numera',
  /** Forme juridique : SARL, SAS, entreprise individuelle… */
  legalForm: process.env.NEXT_PUBLIC_COMPANY_LEGAL_FORM || '',
  /** N° d'immatriculation (RCCM, NIU…). */
  registration: process.env.NEXT_PUBLIC_COMPANY_REGISTRATION || '',
  /** Adresse du siège. */
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '',
  city: process.env.NEXT_PUBLIC_COMPANY_CITY || 'Yaoundé',
  country: 'Cameroun',
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || 'heltonxavierowona@gmail.com',
  /** Un ou plusieurs numéros, séparés par « / ». */
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || '+237 656 56 67 62 / +237 654 36 40 96',
  /** Responsable de la publication. */
  publisher: process.env.NEXT_PUBLIC_COMPANY_PUBLISHER || '',
  /** Hébergeur du site (nom et adresse). */
  host: 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis',
};

/** Sépare les numéros de `company.phone` (« / » ou « , ») pour un lien d'appel chacun. */
export function phoneNumbers(phone: string): { label: string; tel: string }[] {
  return phone
    .split(/[\/,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((label) => ({ label, tel: label.replace(/[^\d+]/g, '') }));
}

export const brand = {
  name: 'Numera',

  /** Signature longue — pages publiques, PDF, métadonnées. */
  tagline: 'Solutions comptables & TVA',

  /** Signature courte — en-têtes compacts. */
  claim: 'Factures · Comptabilité · Conformité',

  description:
    'Facturation et déclaration de TVA mensuelle pour les entreprises et cabinets comptables au Cameroun.',

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

  company: COMPANY,
} as const;
