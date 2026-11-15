# Mise en production — liste de contrôle

## Déjà fait

- Parcours complets testés :
  - inscription et essai gratuit ;
  - factures, avoirs, encaissements ;
  - déclarations de TVA et PDF ;
  - paiement par lien Neero, avec liens préparés et validation ;
  - e-mails par Gmail ;
  - mot de passe oublié ;
  - tableau de bord administrateur.
- Sécurité :
  - jetons révocables ;
  - mots de passe hachés (argon2) ;
  - limitation des tentatives ;
  - isolation des données entre comptes ;
  - écran admin réservé à `PLATFORM_ADMIN_EMAILS` ;
  - journal d'audit.
- Données de test retirées : les paiements Notch Pay étaient tous des paiements de test. Les comptes qu'ils avaient activés sont repassés en essai, sans perte d'accès (migration `20261005090000_purge_notchpay_test_payments`).
- Informations légales réglables sans code : variables `NEXT_PUBLIC_COMPANY_*` du projet Vercel **numera**.

## À faire par vous

| # | Action | Pourquoi |
|---|---|---|
| 1 | Règles fiscales alignées sur le CGI 2026 (voir docs/CGI-2026.md). Reste : faire relire par un expert-comptable, et demander à la DGI comment raccorder Numera au système de facturation électronique (CGI art. 143), condition de déductibilité de la TVA chez vos clients. | Une erreur de calcul coûterait des pénalités à vos clients. Les règles sont regroupées dans `api/src/tax/tax.constants.ts`. |
| 2 | Passer le compte Vercel à l'offre **Pro** (environ 20 $/mois). | L'offre gratuite (Hobby) est réservée à un usage non commercial. |
| 3 | Renseigner vos informations légales dans Vercel, projet **numera**, puis **Settings → Environment Variables** : `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_LEGAL_FORM`, `NEXT_PUBLIC_COMPANY_REGISTRATION` (RCCM ou NIU), `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_COMPANY_PUBLISHER`. Redéployer ensuite le site. | Obligatoire sur les pages Mentions légales et CGV ; demandé par les prestataires de paiement. |
| 4 | Acheter un nom de domaine (par exemple `numera.cm`) et le relier au projet **numera** dans Vercel. | Confiance des clients ; e-mails envoyés depuis une adresse professionnelle, moins souvent classés en indésirables. |
| 5 | Vérifier la durée de restauration des sauvegardes Neon, et passer à une offre payante dès les premiers clients payants. | L'offre gratuite garde un historique court. |
| 6 | Séparer les produits dans deux dépôts GitHub : ce dépôt contient aussi Le Closer (NUMERA-agentic). Puis publier depuis la branche `main` de chaque dépôt. | Évite qu'une fusion publie un produit dans le mauvais projet Vercel. |
| 7 | Comptes de test restants (inscriptions d'essai) : les repérer dans **Admin → Clients**. Les suspendre au besoin. | Des chiffres du tableau de bord exacts. |
