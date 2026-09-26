# Numera — Facturation normalisée & déclaration de TVA (Cameroun)

**Numera** sert deux publics depuis une base de code unique :

- les **PME**, qui émettent leurs factures et préparent leur déclaration de TVA mensuelle ;
- les **cabinets comptables**, qui pilotent un portefeuille d'entreprises clientes et voient en un coup d'œil qui risque une pénalité avant le 15.

```
.
├── api/                NestJS + Prisma + PostgreSQL
├── web/                Next.js 15 + Tailwind CSS 4
├── docker-compose.yml  base de données + API + front
└── CHANGELOG.md        corrections apportées au code d'origine
```

---

## Démarrage rapide (Docker)

```bash
cp .env.example .env          # renseigner POSTGRES_PASSWORD et JWT_ACCESS_SECRET
openssl rand -base64 48       # → JWT_ACCESS_SECRET
docker compose up -d --build
```

- Front : http://localhost:3001
- API : http://localhost:3000/api (santé : `GET /api/health`)

Les migrations de base de données s'appliquent automatiquement au démarrage de l'API.

## Démarrage en développement

Prérequis : Node.js 20 ou plus, PostgreSQL 16.

**API** (port 3000)

```bash
cd api
cp .env.example .env          # DATABASE_URL + JWT_ACCESS_SECRET (32 caractères minimum)
npm install
npx prisma migrate deploy
npm run start:dev
```

**Front** (port 3001)

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

## Vérifications

| Commande | Rôle |
|---|---|
| `cd api && npm test` | Tests unitaires : moteur de TVA, échéances, montant en lettres, parité API ↔ front |
| `cd api && npm run lint` | Vérification des types de l'API |
| `cd api && API_URL=http://localhost:3000/api npm run smoke` | 50 vérifications de bout en bout sur une API démarrée : facturation, avoirs, TVA, dépôt, PDF, isolation entre comptes, jetons |
| `cd web && npm run typecheck && npm run build` | Types et build du front |

---

## Fonctionnalités

- **Inscription** entreprise ou cabinet, avec un essai gratuit ouvert automatiquement (14 jours pour une PME, 30 pour un cabinet).
- **Factures de vente** : brouillon modifiable, puis validation qui attribue un numéro définitif (`FA-2026-00001`) et fige la facture.
- **Factures d'achat** : TVA déductible, numéro d'enregistrement interne (`AC-…`) et référence du fournisseur.
- **Avoirs** totaux ou partiels (`AV-…`), plafonnés au montant de la facture corrigée.
- **Encaissements** (Mobile Money MTN et Orange, espèces, virement, chèque) et suivi des impayés.
- **Clients, fournisseurs et catalogue** d'articles réutilisables.
- **Déclaration de TVA mensuelle** : calcul automatique depuis les factures validées, report du crédit, déclaration néant, alerte si des factures ont changé depuis le calcul, enregistrement du dépôt et du paiement.
- **PDF** des factures (montant en toutes lettres, ventilation de la TVA, filigrane « BROUILLON ») et des déclarations.
- **Tableau de bord cabinet** : portefeuille trié par urgence, dossiers bloqués par des brouillons, majorations de retard estimées, charge par collaborateur.
- **Abonnements** payés par Flutterwave (Mobile Money ou carte), avec relances et période de grâce.
- **Journal d'audit** de toutes les opérations.

## Marque

La marque Numera est centralisée à deux endroits :

- `web/src/lib/brand.ts` : nom, signatures, logos, couleurs (front) ;
- `api/src/config/brand.ts` : pied de page des PDF (serveur).

Aucun composant n'écrit « Numera » en dur. Les factures portent l'identité de **l'entreprise émettrice** : Numera n'y apparaît qu'en mention discrète de pied de page. Pour l'impression ou les grands formats, demandez la version vectorielle (SVG) du logo : les PNG fournis font 929 × 243 px.

---

## Conventions non négociables

**Unités entières.** Aucun nombre à virgule flottante pour l'argent, et des calculs exacts en BigInt.

| Donnée | Unité | Exemple |
|---|---|---|
| Montants | centimes de FCFA | 1 500 FCFA → `150000` |
| Quantités | millièmes | 1,5 → `1500` |
| Remises | centièmes de % | 12,5 % → `1250` |
| Taux | points de base | 19,25 % → `1925` |

Le FCFA n'a pas de sous-unité : les centimes servent uniquement à la précision des calculs intermédiaires. Tout montant officiel est arrondi au franc entier via `roundToFranc()`.

**Un seul moteur de TVA.** `web/src/lib/tax/` est une copie exacte de `api/src/tax/` : l'aperçu affiché pendant la saisie est calculé par le même code que le serveur. Un test échoue si les deux copies divergent. Pour modifier une règle, éditez `api/src/tax/` puis lancez `npm run sync:tax` dans `web/`.

**Immuabilité.** Une facture validée ne se modifie jamais. Seule correction possible : un avoir. Aucune facture ne peut être datée dans un mois dont la déclaration est déjà déposée.

**Isolation.** Toute requête métier filtre sur `entityId`, fourni exclusivement par le `TenancyGuard`. Un service ne lit jamais `entityId` depuis le corps ou les paramètres de la requête.

**Numérotation.** Le numéro est attribué à la validation, dans une transaction avec verrou de ligne. Un brouillon abandonné ne laisse pas de trou dans la séquence.

**Accès.** Une organisation dont l'abonnement est suspendu garde l'accès en lecture à toutes ses données ; seule la saisie est bloquée.

---

## ⚠️ À faire avant toute mise en production

1. **Faire valider les règles fiscales par un expert-comptable.** Tout est centralisé dans `api/src/tax/tax.constants.ts` :
   - règle d'arrondi exigée par la DGI ;
   - modalités exactes du report de crédit de TVA ;
   - périmètre de la retenue à la source ;
   - glissement ou non de l'échéance du 15 si c'est un jour non ouvré ;
   - format du cachet fiscal / QR code de la facture normalisée.
2. **Vérifier Flutterwave** : couverture réelle MTN MoMo et Orange Money au Cameroun, frais par transaction, paiement récurrent.
3. **Choisir le canal de notification** : `api/src/subscription/subscription-cron.service.ts` contient deux méthodes `dispatch*` qui ne font que journaliser (WhatsApp, SMS ou e-mail).
4. **Servir l'API et le front en HTTPS**, derrière un reverse proxy (ajuster `TRUST_PROXY_HOPS`).

## Reste à construire

- Invitation de collaborateurs (le modèle `Invitation` existe, les écrans et l'API non).
- Envoi des factures par e-mail ou WhatsApp.
- Réinitialisation du mot de passe par e-mail.

## Dépôt à la DGI

Le dépôt est **manuel** : l'utilisateur dépose sur le portail de la DGI, puis saisit la référence de l'accusé dans Numera. Aucune API publique ne permet aujourd'hui le dépôt automatisé par un tiers : cela suppose une homologation éditeur. Le jour où elle est obtenue, seule la méthode `DeclarationService.submit()` est à modifier.
