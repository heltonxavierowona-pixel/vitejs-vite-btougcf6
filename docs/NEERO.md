# Passerelle de paiement Neero

Encaissement automatique des abonnements par l'API Neero (MTN Mobile Money, Orange Money), sur la page de paiement hébergée par Neero. Projet : **SaaS de facturation et TVA Cameroun** (premier des trois projets NUMERA).

## Parcours

1. Le client choisit une formule et clique sur « Payer (Mobile Money) ».
2. Le serveur enregistre un paiement `PENDING`, puis appelle Neero :
   - **Create Cash In Payment Intent** (`confirm: false`), avec le montant calculé côté serveur à partir de la formule, `XAF`, le moyen de paiement marchand du projet, le client, les metadata et le nom et le logo de Numera ;
   - **Create Session**.
3. Le client est redirigé vers la page Neero et paie.
4. **Webhook** `POST /api/webhooks/neero` :
   - signature HMAC-SHA512 vérifiée sur le corps brut, avec une comparaison à temps constant ;
   - horodatage de moins de 5 minutes ;
   - idempotence sur l'identifiant d'événement ;
   - contrôle de l'opérateur ;
   - puis relecture de la transaction chez Neero (**Find Transaction Intent By Id**) et contrôle du montant et de la devise.
5. **Paiement réussi :**
   - le paiement passe à `SUCCEEDED` ;
   - l'abonnement est activé ou prolongé d'un mois ;
   - le client reçoit un e-mail de confirmation et l'administratrice est notifiée.
6. **Page de retour** (`successUrl`) : elle affiche « Paiement en cours de vérification », puis interroge l'API, qui relit la transaction chez Neero. L'adresse de retour n'active jamais rien à elle seule.
7. **Filet de sécurité** : les paiements `PENDING` de plus de 10 minutes sont relus chez Neero. Au-delà de `NEERO_PENDING_EXPIRY_HOURS` (24 h par défaut), la transaction est annulée chez Neero et le paiement passe à `EXPIRED`.
8. **Renouvellement** (pas de prélèvement automatique en Mobile Money) :
   - un lien de paiement est créé et envoyé par e-mail à J-5 et à J-1 ;
   - à l'échéance, l'abonnement passe à `PAST_DUE` avec une période de grâce ;
   - après la grâce, il passe à `SUSPENDED` : les données restent consultables, la saisie est bloquée ;
   - un paiement remet immédiatement l'abonnement à `ACTIVE`.

Le paiement manuel par lien Neero (`PAYMENT_MODE=manual`, écran `/admin/paiements`) reste disponible. L'encaissement automatique s'active avec `PAYMENT_MODE=online`, une fois Neero configuré.

## Mise en service

1. **Créer l'opérateur et la balance du projet.** Dans le tableau de bord marchand Neero, crée un opérateur et une balance propres à ce projet. Relève :
   - la clé secrète API et le secret webhook ;
   - `operatorId`, `merchantKey`, `storeId`, `balanceId`.
2. **Déclarer l'URL du webhook** sur cet opérateur : `https://numera-api.vercel.app/api/webhooks/neero`.
3. **Renseigner les variables Neero** dans Vercel, projet **numera-api** (liste plus bas), d'abord avec `NEERO_ENV=sandbox`.
4. **Créer le moyen de paiement marchand**, une fois par environnement :
   ```bash
   cd api && node --env-file=.env scripts/neero-init.js
   ```
   Copie l'identifiant affiché dans `NEERO_DESTINATION_PAYMENT_METHOD_ID`.
5. **Vérifier les points ci-dessous avec la sonde Sandbox** :
   ```bash
   node --env-file=.env scripts/neero-sandbox-probe.js
   ```
   Si l'une des valeurs par défaut ne convient pas, ajuste la variable correspondante.
6. **Activer l'encaissement** : passe `PAYMENT_MODE=online`, puis redéploie l'API.
7. **Passer en production** : après un paiement Sandbox réussi de bout en bout, reprends les étapes 1 à 4 avec `NEERO_ENV=production` et les clés de production.

## Points à vérifier en Sandbox

La documentation publique ne tranche pas encore les points suivants. Aucun n'est codé en dur : chacun a une variable.

| Point | Variable | Valeur par défaut |
|---|---|---|
| URL de base Sandbox | `NEERO_BASE_URL` | aucune en Sandbox ; `https://api.neero.tech/payment-gateway` en production |
| En-tête d'authentification | `NEERO_AUTH_HEADER`, `NEERO_AUTH_SCHEME` | `Authorization: Bearer <clé>` (schéma vide = clé seule) |
| `type` d'un moyen de paiement marchand | `NEERO_MERCHANT_METHOD_TYPE` | aucune : à relever dans la documentation |
| `paymentType` de l'encaissement | `NEERO_CASH_IN_PAYMENT_TYPE` | `TRANSFER_TO_NEERO_PERSON` (valeur de l'exemple) |
| `sourcePaymentMethodId` facultatif avec une session ? | — | non envoyé (le client choisit sur la page Neero) |
| Champ de l'URL dans la réponse de Create Session | `NEERO_SESSION_URL_FIELD`, `NEERO_CHECKOUT_URL_TEMPLATE` | essaie `url`, `paymentUrl`, `checkoutUrl`, `sessionUrl`, `redirectUrl`, `link`, `paymentLink` |
| Chemin de Find Transaction Intent | `NEERO_PATH_TRANSACTION` | `/api/v1/transaction-intents/{id}` |
| Chemin de Cancel Transaction Intent | `NEERO_PATH_CANCEL` | `/api/v1/transaction-intents/{id}/cancel` (POST) |
| Format de `X-TIMESTAMP` | `NEERO_WEBHOOK_TOLERANCE_SECONDS` | secondes, millisecondes ou date ISO acceptées ; 300 s |
| Statuts et événements | — | `PENDING`, `SUCCESSFUL`, `FAILED`, `EXPIRED`, `CANCELED`/`CANCELLED` ; tout statut inconnu est traité comme en attente, donc sans activation |

Chemins confirmés : `POST /api/v1/transaction-intents/cash-in`, `POST /api/v1/sessions`, `POST /api/v1/payment-methods`.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `NEERO_ENV` | `sandbox` ou `production` |
| `NEERO_BASE_URL` | URL de l'API (obligatoire en Sandbox) |
| `NEERO_SECRET_KEY` | clé secrète de l'opérateur du projet |
| `NEERO_WEBHOOK_SECRET` | secret de signature des webhooks |
| `NEERO_OPERATOR_ID` | les webhooks d'un autre opérateur sont ignorés |
| `NEERO_MERCHANT_KEY`, `NEERO_STORE_ID`, `NEERO_BALANCE_ID` | utilisés par le script d'initialisation |
| `NEERO_DESTINATION_PAYMENT_METHOD_ID` | moyen de paiement marchand du projet |
| `APP_PUBLIC_URL` | adresse du site (pages de retour et logo) ; `FRONTEND_URL` à défaut |
| `NEERO_PROJECT` | valeur de `metadata.project` (`numera-facturation`) |
| `NEERO_PENDING_EXPIRY_HOURS` | délai avant expiration d'un paiement non payé (24) |
| `GRACE_PERIOD_DAYS` | période de grâce après l'échéance (15, durée annoncée dans les CGV) |

Toutes ces valeurs restent dans les variables d'environnement : jamais dans le code, les journaux ni le navigateur.

## Tâches planifiées

- **Chaque jour** (Vercel Cron, `/api/cron/dunning`) : rattrapage, liens de renouvellement, période de grâce et suspension.
- **Toutes les 15 minutes** : rattrapage des webhooks perdus.
  - Sur un serveur permanent, il tourne tout seul.
  - Sur Vercel, l'offre gratuite ne permet qu'une tâche par jour. Pour le rythme de 15 minutes, programme un service externe gratuit (par exemple cron-job.org) sur `GET https://numera-api.vercel.app/api/cron/payments-reconcile`, avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## Tests

- `cd api && npx jest src/payments` : 12 tests unitaires (signature avec un exemple calculé, statuts, réponse de session, configuration).
- `cd api && node scripts/neero-flow-test.js` : 30 vérifications de bout en bout contre `scripts/fake-neero-server.py`, sans compte Neero. Mode d'emploi en tête du script. Cas couverts :
  - paiement réussi, échoué, annulé, expiré ;
  - signature invalide et webhook trop ancien ;
  - doublon ;
  - webhook « menteur » ;
  - autre opérateur ;
  - montant falsifié ;
  - webhook perdu ;
  - retour avant le webhook ;
  - J-5, période de grâce, suspension et réactivation.

## Réutiliser le module dans les autres projets NUMERA

Le module ne dépend de rien d'autre que NestJS :
- `api/src/payments/payment-provider.ts` : l'interface ;
- `api/src/payments/neero/` : la configuration, la signature, `NeeroProvider` et ses tests.

Pour Core HR et l'agent Social Seller :
1. Recopie ces fichiers, en adaptant la syntaxe si le projet n'utilise pas NestJS.
2. Donne à chaque projet son propre opérateur, sa balance et ses variables `NEERO_*`, avec un `NEERO_PROJECT` différent (`core-hr`, `social-seller`).
3. Branche le métier du projet sur l'interface `PaymentProvider` : paiement `pending`, webhook, confirmation, rattrapage.

## Fichiers

**Nouveaux :**
- `api/src/payments/payment-provider.ts`
- `api/src/payments/payments.module.ts`
- `api/src/payments/neero/neero.config.ts`
- `api/src/payments/neero/neero-signature.ts`
- `api/src/payments/neero/neero.provider.ts`
- `api/src/payments/neero/neero.spec.ts`
- `api/src/subscription/neero-billing.service.ts`
- `api/src/subscription/neero-webhook.controller.ts`
- `api/prisma/migrations/20261003090000_neero/`
- `api/scripts/neero-init.js`
- `api/scripts/neero-sandbox-probe.js`
- `api/scripts/fake-neero-server.py`
- `api/scripts/neero-flow-test.js`
- `docs/NEERO.md`

**Modifiés (le strict nécessaire) :**
- `api/prisma/schema.prisma` :
  - fournisseur `NEERO` ;
  - statuts de paiement `EXPIRED` et `CANCELED` ;
  - colonnes de paiement `paymentUrl`, `periodStart` et `periodEnd` ;
  - `signatureValid` sur les webhooks reçus.
- `api/src/subscription/subscription.service.ts` :
  - Neero parmi les moyens de paiement en ligne ;
  - souscription Neero ;
  - vérification Neero dans `confirmPayment` ;
  - notifications.
- `api/src/subscription/subscription.controller.ts` : route `confirm-neero`, Neero accepté comme moyen de paiement.
- `api/src/subscription/subscription-cron.service.ts` :
  - rattrapage, liens J-5 et J-1 ;
  - relances adaptées ;
  - e-mail de suspension ;
  - période de grâce réglable.
- `api/src/subscription/cron.controller.ts` : route `payments-reconcile`.
- `api/src/subscription/subscription.module.ts`, `api/src/app.module.ts` : enregistrement des nouveaux éléments.
- `api/src/subscription/plans.ts`, `stripe-billing.service.ts` : période de grâce réglable (`GRACE_PERIOD_DAYS`).
- `api/src/subscription/flutterwave.service.ts` : champ facultatif `finalStatus` dans le type de vérification.
- `web/src/app/(app)/abonnement/page.tsx` : bouton « Payer (Mobile Money) » pour Neero.
- `web/src/app/(app)/abonnement/retour/page.tsx` : retour Neero (vérification, échec, bouton « Réessayer »).
- `.env.example`, `api/.env.example`, `docker-compose.yml` : variables Neero.
