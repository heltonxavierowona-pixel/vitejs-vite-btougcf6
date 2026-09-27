# Partie 1 — Fondations & comptes

Objectif : à la fin de cette partie, **les 5 canaux sont créés et reliés**, l'infrastructure tourne, la base SaaS existe, et un message envoyé à votre Page Facebook, à votre Instagram ou à votre numéro WhatsApp **arrive dans la base Supabase**.

Durée réaliste : 2 à 4 jours (les délais de validation Meta sont le facteur limitant).

---

## 1.1 Architecture de la Partie 1

```
Prospect ──► Page FB / IG Pro / numéro WhatsApp
                     │ webhook (HTTPS obligatoire)
                     ▼
        n8n : workflow « 01 · Meta inbound »
          ├─ GET  → vérification du webhook (hub.challenge)
          └─ POST → vérification signature → normalisation
                      → Supabase: raw_events + messages
                     ▼
        Plateforme web : page « Canaux » (statut) + « Prospects »
```

Fichiers livrés dans ce dépôt :

| Fichier | Rôle |
|---|---|
| `supabase/migrations/0001_init.sql` | Schéma multi-tenant complet (organisations, canaux, prospects, conversations, messages, profil relationnel, validations, événements) + RLS |
| `infra/docker-compose.yml` + `infra/Caddyfile` | n8n + Caddy (HTTPS automatique) sur un VPS |
| `infra/.env.example` | Variables à renseigner |
| `n8n/workflows/01-meta-inbound.json` | Webhook unique pour Messenger + Instagram + WhatsApp |
| `n8n/workflows/00-healthcheck.json` | Ping quotidien Supabase + alerte Telegram si panne |
| `src/` | Plateforme React : page **Canaux** avec la checklist de cette partie |

---

## 1.2 Comptes à créer — dans cet ordre

### A. Identité « business » (prérequis à tout le reste)

1. **Adresse e-mail dédiée** (ex. `closer@votredomaine.com`) — utilisée pour tous les comptes ci-dessous.
2. **Nom de domaine** — nécessaire pour l'HTTPS de n8n, la vérification Meta et la crédibilité.
3. **Numéro de téléphone dédié pour WhatsApp API** — voir §D, choix important.

### B. LinkedIn (mode assisté)

1. Créer le compte dédié avec **une vraie identité** (vous, ou votre marque personnelle pro). Les faux profils sont interdits par LinkedIn et vite restreints.
2. **Chauffe du compte — 3 à 4 semaines** avant toute prospection :
   - Semaine 1 : profil complet (photo, bannière, titre orienté bénéfice client, section « Infos »), 5–10 invitations/jour vers des personnes que vous connaissez.
   - Semaines 2–3 : 10–15 invitations/jour, 2 publications/semaine, commentaires quotidiens.
   - Semaine 4+ : jusqu'à 20 invitations/jour, **~100/semaine maximum**.
3. Créer une **Page LinkedIn** pour Core HR (crédibilité).
4. **Aucune extension d'automatisation** sur ce compte.

### C. X (mode assisté)

1. Compte dédié, bio claire, lien vers votre site.
2. Chauffe identique : publier/répondre pendant 2–3 semaines.
3. Ne pas demander d'accès API maintenant (payant, inutile en mode assisté).

### D. Meta : Facebook, Instagram, WhatsApp (mode automatique)

Tout se passe dans **un seul portefeuille Meta Business**.

1. **Meta Business Suite / Business Manager** : `business.facebook.com` → créer le portefeuille « Le Closer » (ou le nom de votre société).
2. **Page Facebook** : créer la Page (catégorie Logiciel / Service B2B). La rattacher au portefeuille.
3. **Instagram** : créer le compte, le passer en **Compte professionnel** (Paramètres → Type de compte → Professionnel → Entreprise), puis le **lier à la Page Facebook**.
4. **Vérification d'entreprise** (Business Settings → Centre de sécurité) : documents officiels (RCCM, NIU…). Non bloquante pour démarrer en interne, **obligatoire avant de vendre le SaaS** et pour lever les limites WhatsApp.
5. **App Meta développeur** : `developers.facebook.com` → Créer une app → type **Business** → rattacher au portefeuille. Ajouter les produits :
   - **Messenger** (webhooks de la Page)
   - **Instagram** → « API Instagram avec connexion Facebook » (webhooks `messages`, `comments`)
   - **WhatsApp** → Cloud API
6. **Utilisateur système** (Business Settings → Utilisateurs système) : créer un utilisateur système **Admin**, lui assigner l'app, la Page, le compte IG et le compte WhatsApp, puis générer un **token permanent** avec :
   `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`.
   → Ce token va **uniquement** dans les credentials n8n.

#### Le numéro WhatsApp : 2 options

| Option | Principe | Pour | Contre |
|---|---|---|---|
| **1. Nouveau numéro** (recommandé) | Une nouvelle SIM (MTN/Orange) dédiée à l'API | Aucun risque pour votre WhatsApp Business actuel, séparation perso/outil | Nouveau numéro à faire connaître |
| **2. Coexistence** | Garder votre numéro WhatsApp Business (app) **et** le connecter à la Cloud API | Même numéro, historique conservé, l'app reste utilisable | Fonction récente, disponibilité selon pays/version de l'app à vérifier ; certaines fonctions de l'app sont limitées |

> ⚠️ Sans coexistence, **un numéro enregistré sur la Cloud API ne peut plus être utilisé dans l'application WhatsApp**. Ne migrez pas votre numéro actuel « à l'aveugle ».

Étapes (option 1) : App Meta → WhatsApp → Configuration de l'API → « Ajouter un numéro » → nom d'affichage (doit correspondre à votre marque, validé par Meta) → code SMS → noter `PHONE_NUMBER_ID` et `WABA_ID`.

Limites de départ : **250 conversations initiées par l'entreprise / 24 h** (numéro non vérifié). Largement suffisant ; la limite monte avec la qualité et la vérification d'entreprise.

### E. Infrastructure

1. **VPS** (Hetzner CX22 ≈ 4–5 €/mois, Ubuntu 24.04). Pointer un sous-domaine `n8n.votredomaine.com` vers son IP (enregistrement A).
2. **Supabase** : créer un projet (région Europe — la plus proche du Cameroun en latence), exécuter `supabase/migrations/0001_init.sql` dans l'éditeur SQL. Noter `SUPABASE_URL`, `anon key` (front), `service_role key` (n8n uniquement).
3. **OpenRouter** : créer un compte, créditer 5 €, **définir une limite de dépense** sur la clé, noter la clé API.
4. **Telegram** : parler à `@BotFather` → `/newbot` → noter le token. Envoyer un message à votre bot, puis récupérer votre `chat_id` via `https://api.telegram.org/bot<TOKEN>/getUpdates`.

---

## 1.3 Déploiement de n8n

Sur le VPS :

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Récupérer les fichiers infra/ de ce dépôt
mkdir -p ~/closer && cd ~/closer
# copier docker-compose.yml, Caddyfile, .env.example ici
cp .env.example .env && nano .env      # renseigner les valeurs

# 3. Lancer
docker compose up -d
# → https://n8n.votredomaine.com (HTTPS automatique via Caddy)
```

Sécurité minimale :
- Pare-feu : n'ouvrir que 22, 80, 443 (`ufw allow 22,80,443/tcp && ufw enable`).
- Créer le compte propriétaire n8n **immédiatement** après le premier lancement.
- `N8N_ENCRYPTION_KEY` : générer une fois (`openssl rand -hex 32`) et **la sauvegarder** — sans elle, les credentials sont perdus.
- Sauvegarde : export hebdomadaire des workflows (ils sont aussi versionnés dans `n8n/workflows/` de ce dépôt).

---

## 1.4 Workflows n8n de la Partie 1

### Workflow 00 · Health-check (quotidien)

`Schedule (08:00)` → `HTTP GET Supabase /rest/v1/organizations?limit=1` → `IF erreur` → `Telegram : « ⚠️ Supabase injoignable »`.
Utilité : détecter une panne **et** empêcher la mise en pause du projet Supabase gratuit.

### Workflow 01 · Meta inbound (le plus important)

Un seul webhook reçoit **Messenger, Instagram et WhatsApp** (Meta utilise le même format d'enveloppe, distingué par le champ `object`).

```
Webhook GET /meta ─► IF hub.verify_token == META_VERIFY_TOKEN
                         ├─ oui → Respond: hub.challenge (texte brut, 200)
                         └─ non → Respond: 403

Webhook POST /meta ─► Respond 200 immédiatement (Meta exige < 5 s sinon il renvoie)
                  └─► Code « Normaliser » : object = page | instagram | whatsapp_business_account
                        → [{ channel, external_user_id, external_message_id, text, sent_at, display_name }]
                  └─► Supabase : insert raw_events (payload brut, pour audit/rejeu)
                  └─► Supabase : RPC ingest_inbound_message(...)
                        (crée/retrouve prospect + conversation, insère le message, idempotent)
```

Configuration côté Meta (App → Webhooks) :
- URL de rappel : `https://n8n.votredomaine.com/webhook/meta`
- Jeton de vérification : la valeur de `META_VERIFY_TOKEN`
- Abonnements : Page → `messages`, `messaging_postbacks`, `feed` ; Instagram → `messages`, `comments` ; WhatsApp → `messages`.
- Abonner la Page à l'app : `POST /{page-id}/subscribed_apps?subscribed_fields=messages,feed`.

**Signature** : Meta signe chaque POST (`X-Hub-Signature-256` = HMAC-SHA256 du corps brut avec l'App Secret). Le nœud Code du workflow la vérifie ; activez l'option « Raw Body » du Webhook. Sans cette vérification, n'importe qui peut injecter de faux messages dans votre CRM.

**Idempotence** : Meta peut renvoyer plusieurs fois le même événement. La contrainte unique `(channel_account_id, external_message_id)` sur `messages` empêche les doublons.

### Test de bout en bout

1. Envoyer « Bonjour » à votre Page depuis un autre compte Facebook.
2. Envoyer un DM à votre compte Instagram pro.
3. Envoyer « Bonjour » à votre numéro WhatsApp API.
4. Vérifier dans Supabase : 3 lignes dans `messages`, 3 prospects créés, `direction = 'inbound'`.

---

## 1.5 Prompt LLM de la Partie 1

Pas encore de « cerveau » (c'est la Partie 3). Un seul prompt de **test de connexion OpenRouter**, utilisé dans le health-check pour vérifier que la clé et le modèle répondent :

```text
SYSTEM: Tu es un service de vérification. Réponds uniquement en JSON valide.
USER: Renvoie {"ok": true, "langues": ["fr","en"]} sans aucun autre texte.
```

Choix de modèles recommandé (à affiner en Partie 3) :
- **Tri / classification** (intérêt, sujet sensible, langue) : modèle petit et bon marché.
- **Rédaction** (messages, réponses WhatsApp) : modèle plus fort, appelé moins souvent.
→ Cette séparation divise la facture LLM par 5 à 10.

---

## 1.6 Points de vigilance

| Sujet | Règle |
|---|---|
| **LinkedIn** | Compte neuf = fragile. Pas d'automatisation, ~100 invitations/semaine max après chauffe, taux d'acceptation à surveiller (< 30 % = message ou ciblage à revoir). |
| **Meta — fenêtre 24 h** | Messenger/IG : vous ne pouvez répondre librement que 24 h après le dernier message du prospect. WhatsApp : hors fenêtre, seuls les **modèles approuvés** sont autorisés. La table `conversations` stocke `last_inbound_at` pour calculer cette fenêtre. |
| **Meta — pas de message à froid** | Aucun outil conforme ne permet d'écrire en premier sur Messenger/Instagram. Tout le sourcing FB/IG sera **inbound** (Partie 2). |
| **Meta — qualité du numéro** | Trop de blocages/signalements WhatsApp → qualité « faible » → limites réduites, voire suspension. D'où la règle : WhatsApp **uniquement après intérêt explicite et numéro donné volontairement**. |
| **Coûts WhatsApp** | Réponses dans la fenêtre de service : gratuites. Modèles marketing (ex. relances hors 24 h) : facturés au message, tarif selon le pays du destinataire — vérifier la grille Meta pour le Cameroun et l'Afrique. |
| **Secrets** | Token système Meta, App Secret, `service_role` Supabase, clé OpenRouter : **jamais** dans le front ni dans Git. Seulement `.env` du VPS / credentials n8n. |
| **SaaS futur** | Les clients connecteront **leurs propres** Page/IG/WhatsApp via « Facebook Login for Business » / « Embedded Signup » WhatsApp. Le schéma `channel_accounts` est déjà prévu pour plusieurs comptes par organisation. |

---

## ✅ Critères de validation de la Partie 1

- [ ] Comptes LinkedIn et X créés, chauffe démarrée
- [ ] Portefeuille Meta, Page FB, IG pro lié, app Meta créée
- [ ] Numéro WhatsApp API actif (option 1 ou 2 choisie)
- [ ] n8n accessible en HTTPS
- [ ] Schéma Supabase exécuté
- [ ] Webhook Meta vérifié (coche verte dans l'app Meta)
- [ ] Test de bout en bout : 3 messages entrants visibles dans `messages`
- [ ] Bot Telegram reçoit l'alerte de test

**→ Validez (ou demandez des ajustements) pour passer à la Partie 2 : Ciblage & sourcing.**
