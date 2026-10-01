# Partie 8 — Abonnements, paiements et espace propriétaire

Deux ajouts :
- chaque client **paie son abonnement** depuis la plateforme (page **Abonnement**) ;
- vous, le propriétaire, avez un **Espace propriétaire** qui montre tous les abonnés et ce qu'ils vous rapportent chaque mois.

## 8.0 Mode actuel : encaissement manuel (liens Neero + e-mails Brevo)

Stripe, PayPal et Flutterwave sont désactivés (`billing_mode = "manual"`, migration 0011). On les réactive en remettant `billing_mode` à `"automatic"` et les `providers` à `true`.

**Parcours client**
1. Sur **Abonnement**, le client clique « S'abonner ». Un formulaire lui demande son nom, son e-mail (pré-rempli), son téléphone WhatsApp, son projet (pré-rempli) et l'offre choisie. Les prix sont en FCFA.
2. Son compte passe **en attente de paiement**. S'il était en essai, il garde l'accès jusqu'à la fin de l'essai.
3. Il est ajouté à la liste Brevo « Demandes d'abonnement », puis :
   - si un lien Neero valide existe pour son offre, il reçoit **aussitôt** l'e-mail « Lien de paiement », même la nuit ;
   - sinon, il reçoit l'e-mail « Demande reçue » : son lien arrive sous quelques heures.
4. Il paie, puis saisit la **référence de transaction** sur la page Abonnement.
5. Quand le propriétaire valide le paiement, l'accès est activé et le client reçoit l'e-mail « Accès activé ».

**Votre travail (Espace propriétaire)**
- **Liens Neero par offre** : collez un lien par offre et par période. Chaque lien est valable 10 jours ; renouvelez-le tous les 9 jours. Un e-mail de rappel part la veille de l'expiration. Un lien expiré n'est jamais envoyé.
- **Paiements à traiter** : vérifiez chaque référence dans Neero, puis cliquez « Valider » ou « Refuser ». En cas de refus, le client reçoit un e-mail et peut renvoyer une référence.
- Vous êtes prévenu **par e-mail** (Brevo → votre Gmail) à chaque nouvelle demande et à chaque référence déclarée. Telegram reste possible, mais il est facultatif.

**Tous les matins à 8 h (Douala)**
- Les accès échus sont coupés.
- Une demande de renouvellement est créée 5 jours avant l'échéance, et le lien de l'offre part automatiquement.
- Les clients qui n'ont pas payé sont relancés tous les 2 jours.
- Vous recevez un récapitulatif.

**Réglages** (`platform_settings.notifications`) : votre e-mail, l'expéditeur, l'identifiant de la liste Brevo, et les identifiants des 6 modèles Brevo :
- `client_link`
- `client_pending`
- `client_activated`
- `client_rejected`
- `client_reminder`
- `owner_notice`

La clé API Brevo se range dans Supabase Vault sous le nom `brevo_api_key`. Ne la collez jamais ailleurs.

## 8.1 Ce que voit le client (paiements automatiques, désactivés pour l'instant)

1. **Inscription → 14 jours d'essai** de la formule Pro, sans moyen de paiement. L'essai démarre automatiquement : un trigger sur `organizations`.
2. Page **Abonnement** :
   - formule en cours et jauges d'utilisation (actions IA du mois, produits, numéros WhatsApp, utilisateurs) ;
   - les trois formules, en mensuel ou en annuel (2 mois offerts), avec un prix en FCFA, EUR ou USD ;
   - l'historique de ses paiements.
3. **Payer** : le client choisit un moyen de paiement. Il est redirigé vers la page sécurisée du prestataire, puis revient sur `/abonnement?paiement=ok`. L'activation arrive par webhook quelques secondes plus tard.
4. **Bandeau** en haut de la plateforme :
   - 3 jours avant la fin de l'essai ;
   - en cas de paiement échoué ;
   - lorsque l'accès est coupé.
5. **Rappel** (alerte Telegram / e-mail de la Partie 7) 3 jours avant l'échéance, pour l'essai et pour le Mobile Money.

### Formules proposées (modifiables)

| Formule | FCFA / mois | EUR / mois | USD / mois | Produits | Numéros WhatsApp | Actions IA / mois | Utilisateurs |
|---|---|---|---|---|---|---|---|
| Découverte | 15 000 | 25 | 27 | 1 | 1 | 300 | 1 |
| **Pro** | 35 000 | 55 | 59 | 5 | 3 | 2 000 | 2 |
| Équipe | 75 000 | 119 | 129 | 20 | 10 | 8 000 | 5 |

- L'annuel coûte 10 × le prix mensuel.
- Pour changer un prix ou une limite, modifiez la table `plans` dans Supabase → *Table Editor*. C'est pris en compte immédiatement, sans redéploiement.
- Une « action IA » est un appel à l'IA : rédaction, classement d'un message, réponse du pilote automatique…
- Avec 2 000 actions, le coût IA d'un client Pro tourne autour de 3 à 6 € par mois (voir `ai_usage`). Votre marge reste confortable.

### Ce qui est bloqué quand il n'a pas payé

| Situation | Accès |
|---|---|
| Essai en cours, abonnement actif | Complet, dans les limites de la formule |
| Paiement échoué (`past_due`) | Encore **3 jours** de grâce |
| Résilié | Jusqu'à la fin de la période payée |
| Essai ou période terminés (`expired`) | L'IA s'arrête : plus de rédaction ni de pilote automatique. La plateforme reste consultable, pour pouvoir payer. |

Les limites sont appliquées **dans la base**, pas seulement à l'écran :
- ajouter un produit ou un numéro WhatsApp au-delà de la formule est refusé (trigger `enforce_plan_limits`) ;
- chaque appel IA vérifie d'abord `ai_quota_ok` (`_shared/llm.ts`).

## 8.2 Les trois moyens de paiement

| | **Flutterwave** | **Stripe** | **PayPal** |
|---|---|---|---|
| Pour qui | Afrique : **MTN / Orange Money**, carte | Cartes internationales | Clients qui ont un compte PayPal |
| Devises | FCFA, EUR, USD | FCFA, EUR, USD | EUR, USD (**pas de FCFA**) |
| Renouvellement | **Manuel** : chaque paiement prolonge d'un mois (ou d'un an) ; rappel 3 jours avant | Automatique (carte débitée) | Automatique |
| Résilier | Il suffit de ne pas repayer, ou via le bouton « Résilier » | Portail client Stripe (carte, factures, résiliation) | Bouton « Résilier » (API PayPal) |

> ⚠️ **À vérifier avant de lancer (important pour une entreprise au Cameroun)**
> - **Stripe** n'ouvre pas de compte marchand pour une entreprise camerounaise. Il vous faut une société dans un pays pris en charge (France, États-Unis via Stripe Atlas, etc.).
> - **PayPal** : un compte camerounais peut en général payer, mais **pas recevoir**. Même contrainte.
> - **Flutterwave** accepte les entreprises camerounaises et le Mobile Money en FCFA. **C'est le moyen à activer en premier.**
>
> Tant qu'un moyen n'est pas prêt, désactivez-le. Il disparaîtra de la page de paiement :
> ```sql
> update platform_settings set value = '{"stripe": false, "paypal": false, "flutterwave": true}' where key = 'providers';
> ```

### Sécurité
- **Le prix vient toujours de la table `plans`, jamais du navigateur.**
- Chaque notification est **authentifiée** :
  - Stripe : signature HMAC vérifiée, tolérance de 5 min ;
  - PayPal : l'API *verify-webhook-signature* ;
  - Flutterwave : l'en-tête `verif-hash`, **puis** la transaction est relue via l'API, et son montant doit être au moins égal au prix de la formule.
- Chaque événement n'est traité **qu'une fois** (table `billing_events`). Une notification envoyée deux fois ne crée pas deux paiements.
- Numera ne voit jamais les numéros de carte ni les codes Mobile Money.

## 8.3 Mise en service

1. **Migration** `0009_billing_admin.sql`. Elle crée :
   - les formules, les abonnements et les paiements ;
   - un essai de 14 jours pour les organisations existantes.
2. **Secrets** : complétez `supabase/functions/.env` (voir `.env.example`), puis `supabase secrets set --env-file supabase/functions/.env`.

   | Prestataire | Où trouver les clés |
   |---|---|
   | Flutterwave | Dashboard → *Settings → API keys* → `FLW_SECRET_KEY`. *Settings → Webhooks* : choisissez un « Secret hash » → `FLW_SECRET_HASH` |
   | Stripe | *Developers → API keys* → `STRIPE_SECRET_KEY`. *Webhooks* → *Signing secret* → `STRIPE_WEBHOOK_SECRET` |
   | PayPal | developer.paypal.com → *Apps & Credentials* → `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. L'ID du webhook créé → `PAYPAL_WEBHOOK_ID`. `PAYPAL_ENV=live` en production |

3. **Fonctions** :
   ```bash
   supabase functions deploy billing-checkout billing-manage
   supabase functions deploy billing-webhook --no-verify-jwt
   ```
4. **Webhooks** chez chaque prestataire, en remplaçant `<projet>` par votre projet Supabase :

   | Prestataire | URL | Événements |
   |---|---|---|
   | Flutterwave | `https://<projet>.supabase.co/functions/v1/billing-webhook?provider=flutterwave` | *charge.completed* (par défaut) |
   | Stripe | `…/billing-webhook?provider=stripe` | `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted` |
   | PayPal | `…/billing-webhook?provider=paypal` | `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED` |

   Stripe : activez aussi le **portail client** (*Settings → Billing → Customer portal*).
5. **Tâches quotidiennes** : le workflow n8n `00` appelle désormais aussi :
   - `expire_subscriptions` : coupe les essais et les périodes terminés ;
   - `billing_reminders` : rappel 3 jours avant.

   Réimportez-le.
6. **Testez en mode test** : cartes de test Stripe, sandbox PayPal, clés de test Flutterwave. Passez ensuite aux clés de production.

## 8.4 Votre espace propriétaire

**Devenir administrateur** (une seule fois) : SQL Editor → récupérez votre identifiant dans *Authentication → Users*, puis :
```sql
insert into platform_admins (user_id) values ('<votre-uuid>');
```
Le lien **Espace propriétaire** apparaît alors dans le menu (`/admin`). Personne d'autre ne le voit : la fonction `admin_stats` refuse tout compte absent de `platform_admins`.

| Indicateur | Signification |
|---|---|
| **Revenu mensuel récurrent (MRR)** | Ce que vous rapportent **chaque mois** les abonnés actifs. Un abonnement annuel compte pour 1/12. |
| ARR | MRR × 12 |
| Encaissé ce mois-ci | Argent réellement reçu, tous moyens confondus, et la **marge après coût IA** |
| Abonnés payants / impayés | Statuts `active` et `past_due` |
| Essais et conversion | Part des essais terminés qui sont devenus payants |
| Résiliations du mois | — |
| Coût IA du mois | Total OpenRouter (table `ai_usage`) et sa part des encaissements |

Graphiques :
- encaissements et coût IA mois par mois, sur 6, 12 ou 24 mois ;
- MRR par formule ;
- encaissements par moyen de paiement.

Chaque graphique a son tableau de données (« Voir les données »).

**Liste des abonnements** : recherche, filtre par statut, ce que rapporte chaque client et son échéance. Le bouton **Gérer** permet de :
- **offrir des jours** (laissez le montant vide) : geste commercial ou prolongation d'essai ;
- **enregistrer un paiement reçu hors plateforme** (virement, espèces, Mobile Money direct) : le client est activé, et le montant entre dans vos revenus et votre MRR.

**Devise des rapports** : tout est converti en FCFA avec `platform_settings.fx_to_xaf`. L'EUR est à parité fixe (655,957) ; mettez à jour le taux USD de temps en temps.

## 8.5 Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/migrations/0009_billing_admin.sql` | Formules, abonnements, paiements, limites, `billing_apply` (idempotent), `admin_stats`, `admin_grant`, rappels |
| `supabase/functions/_shared/billing.ts` | Vérification de signature Stripe et traduction des notifications des 3 prestataires en un format commun |
| `supabase/functions/_shared/billing-api.ts` | Appels aux API Stripe, PayPal et Flutterwave |
| `supabase/functions/billing-checkout` | Crée la page de paiement |
| `supabase/functions/billing-webhook` | Reçoit les notifications de paiement |
| `supabase/functions/billing-manage` | Portail Stripe, résiliation |
| `src/pages/BillingPage.tsx` | Page **Abonnement** |
| `src/pages/AdminPage.tsx` | **Espace propriétaire** |
