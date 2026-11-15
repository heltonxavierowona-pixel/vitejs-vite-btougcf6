# API Numera

API NestJS + Prisma + PostgreSQL. Voir le [README principal](../README.md) pour le démarrage, les conventions et les points à valider avant la mise en production.

| Dossier | Rôle |
|---|---|
| `src/auth` | Authentification, sessions révocables, jetons renouvelés, **TenancyGuard** |
| `src/invoice` | Factures, avoirs, numérotation, règlements |
| `src/declaration` | Déclaration TVA mensuelle, liquidation, dépôt |
| `src/dashboard` | Deux vues distinctes : cabinet et entreprise |
| `src/tax` | Calculs purs : TVA, arrondis, échéances (partagés avec le front) |
| `src/pdf` | Factures et déclarations en PDF, montant en lettres |
| `src/subscription` | Plans, essai, paiement Flutterwave, relances |
| `src/audit` | Journal d'audit |
| `src/config/brand.ts` | Marque côté serveur (PDF) |

```bash
npm test                 # tests unitaires
npm run lint             # vérification des types
npm run smoke            # scénario de bout en bout (API démarrée, base de test)
```
