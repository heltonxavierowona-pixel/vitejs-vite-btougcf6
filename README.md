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

## Mettre le site en ligne (Vercel, gratuit)

Le site public (accueil, tarifs, CGV, confidentialité, mentions légales, contact) est une page statique : il peut être en ligne avant l'API. C'est l'adresse à donner à Stripe.

1. Se connecter sur [vercel.com](https://vercel.com) avec son compte GitHub.
2. **Add New → Project**, importer ce dépôt.
3. **Root Directory** : `web`. Laisser le reste par défaut, puis **Deploy**.
4. Le site est en ligne sur `https://<nom-du-projet>.vercel.app` (nom de domaine personnalisé possible ensuite, par exemple `numera.cm`).

Avant de donner l'adresse à Stripe, renseigner les informations de l'éditeur dans `web/src/lib/brand.ts` (bloc `COMPANY`) : raison sociale, adresse et contact doivent correspondre au compte Stripe. Quand l'API sera hébergée, ajouter dans Vercel la variable `NEXT_PUBLIC_API_URL` et redéployer pour activer la connexion et l'inscription.

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
| `cd api && npm test` | Tests unitaires : moteur de TVA, échéances, montant en lettres, parité API ↔ front, conversions Stripe |
| `cd api && npm run lint` | Vérification des types de l'API |
| `cd api && API_URL=http://localhost:3000/api npm run smoke` | 50 vérifications de bout en bout sur une API démarrée : facturation, avoirs, TVA, dépôt, PDF, isolation entre comptes, jetons |
| `cd api && node scripts/manual-payment-flow-test.js` | 45 vérifications du paiement par lien Neero (voir l'en-tête du script) |
| `cd api && node scripts/password-reset-flow-test.js` | 13 vérifications du « mot de passe oublié », avec `scripts/fake-smtp-server.py` |
| `cd api && node scripts/admin-dashboard-test.js` | 27 vérifications du tableau de bord administrateur (chiffres, clients, gestes, exports, e-mails) |
| `cd api && node scripts/neero-flow-test.js` | 30 vérifications de l'encaissement Neero contre un faux serveur Neero (voir docs/NEERO.md) |
| `cd api && API_URL=http://localhost:3000/api python3 scripts/cgi-2026-test.py` | 22 vérifications des règles de TVA du CGI 2026 (services à l'encaissement, exclusions de déduction, retenue à la source, IGS) |
| `cd api && node scripts/stripe-flow-test.js` | 28 vérifications du cycle d'abonnement par carte, contre un faux serveur Stripe (voir l'en-tête du script) |
| `cd web && npm run typecheck && npm run build` | Types et build du front |

---

## Fonctionnalités

- **Inscription** entreprise ou cabinet, avec un essai gratuit ouvert automatiquement (7 jours pour une PME, 14 pour un cabinet).
- **Factures de vente** : brouillon modifiable, puis validation qui attribue un numéro définitif (`FA-2026-00001`) et fige la facture.
- **Factures d'achat** : TVA déductible, numéro d'enregistrement interne (`AC-…`) et référence du fournisseur.
- **Avoirs** totaux ou partiels (`AV-…`), plafonnés au montant de la facture corrigée.
- **Encaissements** (Mobile Money MTN et Orange, espèces, virement, chèque) et suivi des impayés.
- **Clients, fournisseurs et catalogue** d'articles réutilisables.
- **Déclaration de TVA mensuelle** conforme au CGI 2026 : biens à la date de facture et services à l'encaissement, exclusions du droit à déduction (sans NIU, espèces ≥ 100 000 FCFA, dépenses de l'art. 144), retenue à la source, report du crédit, déclaration néant, alerte si des factures ont changé depuis le calcul, enregistrement du dépôt et du paiement. Pas de TVA pour les entreprises à l'IGS.
- **PDF** des factures (montant en toutes lettres, ventilation de la TVA, filigrane « BROUILLON ») et des déclarations.
- **Tableau de bord cabinet** : portefeuille trié par urgence, dossiers bloqués par des brouillons, majorations de retard estimées, charge par collaborateur.
- **Abonnements** payés par lien de paiement Neero (validation par l'administrateur, notifications Telegram, relances), ou en ligne (Notch Pay, Stripe) ; période de grâce en cas d'impayé.
- **Journal d'audit** de toutes les opérations.
- **Tableau de bord administrateur** (`/admin`) : chiffres clés, revenus sur 12 mois, clients, prolongations et changements de formule, suspensions, exports CSV, e-mails aux clients.

## Paiement des abonnements (lien Neero)

Par défaut, les abonnements se paient par un **lien de paiement Neero** envoyé à la main (paiements en ligne désactivés) :

1. Le client choisit sa formule sur la page Abonnement. Sa demande passe « en attente de paiement » et il lit « Votre lien de paiement vous sera envoyé sous quelques heures » (également par e-mail).
2. L'administrateur reçoit une notification (Telegram, WhatsApp ou e-mail) : client, projet, offre, montant.
3. **Liens préparés** : si l'administrateur a enregistré dans /admin/paiements un lien Neero pour cette formule, le client le reçoit instantanément (e-mail et page Abonnement), même la nuit. Sinon, l'administrateur génère le lien dans Neero et le colle sur la demande ; un bouton prépare aussi le message WhatsApp.
4. Le client paie puis saisit la référence de transaction. Nouvelle notification ; l'administrateur vérifie dans Neero et clique **Valider** : l'accès s'active pour un mois. Une référence ne peut servir qu'une fois.
5. Trois jours avant chaque échéance, les relances quotidiennes créent la demande de renouvellement, préviennent l'administrateur et relancent le client par e-mail jusqu'au paiement.

**Configuration** (variables de l'API) :

| Variable | Rôle |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | e-mails ayant accès à /admin/paiements (bouton « Admin » dans l'en-tête) |
| `WHATSAPP_NOTIFY_PHONE`, `WHATSAPP_NOTIFY_APIKEY` | notifications WhatsApp vers votre numéro via CallMeBot (gratuit) : envoyez « I allow callmebot to send me messages » au numéro indiqué sur callmebot.com, qui répond la clé |
| `TELEGRAM_BOT_TOKEN` | jeton du bot créé avec @BotFather ; la conversation se relie ensuite depuis l'écran admin | (prioritaire sur WhatsApp) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | e-mails aux clients et à l'administrateur. Brevo (gratuit, 300 e-mails/jour) : `smtp-relay.brevo.com`, `587`, identifiant SMTP du compte, clé SMTP (Brevo → SMTP & API → Clés SMTP) ; `MAIL_FROM` doit être un expéditeur validé dans Brevo |
| `PAYMENT_MODE` | `online` pour réactiver Notch Pay / Stripe (voir ci-dessous) |

Sans SMTP, le client retrouve son lien sur sa page Abonnement et l'administrateur l'envoie par WhatsApp en un clic. L'envoi WhatsApp entièrement automatique exigerait l'API WhatsApp Business (payante).

**Tester** : `api/scripts/fake-telegram-server.py` simule Telegram et `api/scripts/manual-payment-flow-test.js` rejoue le parcours complet (52 vérifications). Mode d'emploi en tête du script.

## Encaissement automatique par Neero (`PAYMENT_MODE=online`)

Paiement sur la page hébergée par Neero (MTN, Orange), webhook signé, relecture de chaque transaction chez Neero, rattrapage des webhooks perdus, liens de renouvellement à J-5 et J-1. Mise en service, points à vérifier en Sandbox et réutilisation dans les autres projets : **[docs/NEERO.md](docs/NEERO.md)**.

## Paiement en ligne par Notch Pay (désactivé, `PAYMENT_MODE=online`)

Notch Pay permet le paiement immédiat par MTN Mobile Money, Orange Money ou carte bancaire, sur la page hébergée par Notch Pay. Chaque mois se paie à l'avance, sans prélèvement automatique.

**Connecter le compte Notch Pay**

1. Tableau de bord Notch Pay → **Paramètres → Développeurs** : copier la **clé publique** dans `NOTCHPAY_PUBLIC_KEY`.
2. Déclarer le webhook `https://<adresse-de-l-api>/api/webhooks/notchpay` et copier la **clé de hachage** dans `NOTCHPAY_HASH_KEY`.
3. Mettre `PAYMENT_MODE=online` et redéployer l'API.

Sécurité : ni le retour du navigateur ni le webhook n'activent seuls un abonnement ; la transaction est toujours relue chez Notch Pay. Test sans compte : `api/scripts/fake-notchpay-server.py` et `api/scripts/notchpay-flow-test.js`.

## Paiement par carte (Stripe, facultatif)

Les abonnements par carte passent par **Stripe Checkout** : la carte est saisie sur la page hébergée par Stripe, jamais sur Numera. Stripe prélève ensuite chaque mois automatiquement. Aucun produit n'est à créer dans Stripe : les prix sont envoyés à chaque paiement depuis `api/src/subscription/plans.ts`, en FCFA (XAF), et Stripe convertit vers la devise de versement du compte.

**Connecter un compte Stripe**

1. Dans le tableau de bord Stripe, rubrique **Développeurs → Clés API**, copier la clé secrète dans `STRIPE_SECRET_KEY` (`sk_test_…` pour tester, `sk_live_…` en production). Ne la collez jamais dans le code ni dans une discussion.
2. Rubrique **Développeurs → Webhooks**, ajouter le point de terminaison `https://<adresse-publique-de-l-api>/api/webhooks/stripe` avec ces événements :
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copier son **secret de signature** (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`.
3. Rubrique **Paramètres → Facturation → Portail client**, activer le portail (mise à jour de la carte, factures, résiliation).
4. Redémarrer l'API : le bouton « Payer par carte » apparaît sur la page Abonnement.

En local, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (CLI Stripe) relaie les webhooks et affiche le secret à utiliser.

**Tester sans compte Stripe** : `api/scripts/fake-stripe-server.py` simule l'API Stripe, et `api/scripts/stripe-flow-test.js` rejoue tout le cycle (paiement, renouvellement, impayé, résiliation, changement de formule) avec des webhooks signés. Mode d'emploi en tête du script.

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

Liste de contrôle complète (fait / reste à faire) : **[docs/MISE-EN-PRODUCTION.md](docs/MISE-EN-PRODUCTION.md)**.

1. **Règles fiscales** : alignées sur le CGI 2026, article par article, dans **[docs/CGI-2026.md](docs/CGI-2026.md)** (avec les limites connues : facturation électronique DGI, droits d'accises, prorata). Une relecture par un expert-comptable reste recommandée ; tout est centralisé dans `api/src/tax/tax.constants.ts`.
2. **Vérifier Flutterwave** : couverture réelle MTN MoMo et Orange Money au Cameroun, frais par transaction, paiement récurrent.
3. **Faire un paiement Stripe de test** (clé `sk_test_…`, carte `4242 4242 4242 4242`) avant de passer aux clés réelles, et vérifier dans Stripe que les webhooks arrivent bien (statut 200).
4. **Rappels fiscaux** : `dispatchTaxReminder` (`api/src/subscription/subscription-cron.service.ts`) ne fait encore que journaliser ; les relances d'abonnement, elles, partent par e-mail.
5. **Servir l'API et le front en HTTPS**, derrière un reverse proxy (ajuster `TRUST_PROXY_HOPS`).

## Reste à construire

- Invitation de collaborateurs (le modèle `Invitation` existe, les écrans et l'API non).
- Envoi des factures par e-mail ou WhatsApp.

## Dépôt à la DGI

Le dépôt est **manuel** : l'utilisateur dépose sur le portail de la DGI, puis saisit la référence de l'accusé dans Numera. Aucune API publique ne permet aujourd'hui le dépôt automatisé par un tiers : cela suppose une homologation éditeur. Le jour où elle est obtenue, seule la méthode `DeclarationService.submit()` est à modifier.
