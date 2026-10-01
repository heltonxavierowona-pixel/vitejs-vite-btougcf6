# Partie 1 — Fondations SaaS

Objectif : **n'importe quel utilisateur** peut s'inscrire, décrire son produit et obtenir les réseaux adaptés, connecter son WhatsApp/Facebook/Instagram, puis répondre à ses clients depuis la plateforme.

---

## 1.1 Parcours utilisateur livré

| Étape | Écran | Ce qui se passe |
|---|---|---|
| Inscription | Connexion (lien magique par e-mail) | La base crée automatiquement **son organisation** (trigger `handle_new_user`) |
| 1. Produit | **Produits** | Il décrit son offre → **analyse** : réseaux classés par score avec les raisons, cibles, ton, langues, accroches |
| 2. Comptes | **Canaux** | « Garder mon numéro WhatsApp Business » (coexistence) ou « Nouveau numéro » ; « Connecter Facebook et Instagram » |
| 3. Conversations | **Conversations** | Messages des clients en temps réel ; il répond ; la réponse part sur WhatsApp/Messenger/Instagram |

Sans configuration (`.env` vide), la plateforme tourne en **mode démo** avec des données d'exemple : tout est cliquable.

---

## 1.2 Le conseiller de canaux (produit → réseaux)

Deux niveaux :

1. **Analyse IA** (`supabase/functions/analyze-product`) : l'IA reçoit la fiche produit et renvoie un JSON (cibles, 5 canaux notés 0–100 avec raisons et approche, ton, langues, accroches, risques).
2. **Garde-fou par règles** : quel que soit l'avis de l'IA, le **rôle** (aller chercher / attirer / conclure) et le **mode** (auto / assisté) de chaque canal sont imposés par les règles des plateformes. L'IA ne pourra jamais proposer « écrire en premier sur Instagram ».

Si l'IA est indisponible (ou en mode démo), une **analyse par règles** (`src/lib/channelAdvisor.ts`) prend le relais : elle tient compte du type de clients (entreprises/particuliers), de la cible (fonctions, âge), du caractère visuel du produit, du prix et des pays.

Exemples obtenus en démo :

| Produit | Classement |
|---|---|
| Logiciel RH pour PME (Cameroun, CI, Sénégal) | LinkedIn 70 · Facebook 65 · X 30 · Instagram 10 |
| Formation Excel pour étudiants (Cameroun, Gabon) | Facebook 65 · Instagram 50 · X 5 · LinkedIn 0 |

### Prompt « Analyse produit »

Le prompt système complet est dans `supabase/functions/analyze-product/index.ts`. Ses points clés :
- il rappelle les règles non négociables de chaque canal ;
- il impose une méthode (acheteur réel → usage des réseaux dans les pays visés → score justifié → segments → ton et accroches → risques) ;
- il exige un JSON strict, et le code valide et borne chaque champ avant de l'enregistrer.

Modèle par défaut : `anthropic/claude-haiku-4.5` via OpenRouter (rapide, peu coûteux), modifiable avec `OPENROUTER_MODEL`.

---

## 1.3 Ce que TU dois configurer (propriétaire de la plateforme)

Ces étapes se font une seule fois, pour toute la plateforme. Les utilisateurs, eux, n'ont qu'à cliquer sur « Connecter ».

### A. Meta (une app pour tous les utilisateurs)
1. **Portefeuille Meta Business** de ta société + **vérification d'entreprise**.
2. **App Meta** de type *Business*, produits : **WhatsApp**, **Messenger**, **Instagram**, **Facebook Login for Business**.
3. **Devenir Tech Provider** (App → WhatsApp → démarrage rapide → « Devenir fournisseur technologique »).
4. **Configurations Facebook Login for Business** (App → Facebook Login for Business → Configurations) :
   - une pour **WhatsApp Embedded Signup** (variation « WhatsApp Embedded Signup », token utilisateur système) → `VITE_META_WA_CONFIG_ID` ;
   - une pour **Pages + Instagram** (permissions `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`) → `VITE_META_LOGIN_CONFIG_ID`.
5. **Domaines autorisés** : ajoute le domaine de la plateforme dans les réglages de l'app (obligatoire pour le SDK JavaScript).
6. **Webhooks** : URL `https://<projet>.supabase.co/functions/v1/meta-webhook` (Edge Function `meta-webhook`, qui remplace le workflow n8n 01 ; déployée avec `--no-verify-jwt`), jeton de vérification = `platform_settings.meta_verify_token`, signature vérifiée avec le secret `META_APP_SECRET`. Abonnements : WhatsApp `messages` (+ `smb_message_echoes` pour la coexistence) ; Page `messages`, `messaging_postbacks`, `feed` ; Instagram `messages`, `comments`.
7. Lancer dès maintenant la **vérification d'entreprise** et l'**App Review** (voir `00-architecture-saas.md` §6).

### B. Supabase
1. Créer le projet, exécuter les migrations dans l'ordre (`0001`, `0002`, `0003`…).
2. Auth → activer l'e-mail (lien magique) et définir l'URL du site.
3. Déployer les fonctions :
   ```bash
   supabase functions deploy analyze-product qualify-prospects draft-message whatsapp-connect meta-connect whatsapp-templates
   supabase functions deploy update-profile classify-message autopilot-reply --no-verify-jwt   # appelées par n8n, protégées par NUMERA_WEBHOOK_SECRET
   supabase functions deploy billing-checkout billing-manage
   supabase functions deploy billing-webhook --no-verify-jwt   # appelée par Stripe / PayPal / Flutterwave, signature vérifiée (docs/08)
   supabase secrets set --env-file supabase/functions/.env
   ```
4. **Database Webhooks** (Database → Webhooks), table `messages`, en-tête `x-numera-secret: <NUMERA_WEBHOOK_SECRET>` :
   - `https://n8n.tondomaine.com/webhook/numera/outbound` (workflow 02, envoi), événements **INSERT et UPDATE** (envoi après validation) ;
   - `https://n8n.tondomaine.com/webhook/numera/profile` (workflow 03, intention + profil + pilote automatique), événement **INSERT** ;
   - table `alerts`, **INSERT** → `https://n8n.tondomaine.com/webhook/numera/alerts` (workflow 05, alertes).

### C. n8n (VPS ≈ 5 €/mois)
1. `infra/docker-compose.yml` + `infra/.env` (voir `infra/.env.example`).
2. Importer `n8n/workflows/*.json`, sélectionner les credentials (Supabase service_role, OpenRouter, Telegram).
3. Créer le bot Telegram de la plateforme (`@BotFather`) et un credential SMTP (ex. Brevo) — voir `07-tableau-de-bord-alertes.md` §7.5.
4. Activer les workflows (00 à 06).

### D. Plateforme web
Déployer ce dépôt (Vercel / Cloudflare Pages) avec les variables de `.env.example` (clés **publiques** uniquement).

---

## 1.4 Workflows n8n

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `00 · Health-check` | Tous les jours à 8 h | Vérifie Supabase et OpenRouter, alerte Telegram si panne |
| `01 · Meta inbound` | Webhook Meta | Vérifie la signature, stocke l'événement brut, retrouve **à quel utilisateur** appartient le compte (par identifiant de numéro/Page/Instagram), crée le contact et la conversation, enregistre le message |
| `02 · Envoi sortant` | Database Webhook Supabase | Quand l'utilisateur répond depuis la plateforme : récupère le token **de son compte**, vérifie la fenêtre de 24 h, envoie via l'API Meta, met à jour le statut (envoyé / échec) |

---

## 1.5 Base de données (ajouts de la Partie 1)

| Élément | Rôle |
|---|---|
| `handle_new_user` | Crée l'organisation de chaque nouvel inscrit |
| `products` | Fiches produits + analyse (`analysis`) |
| `channel_accounts` (+ colonnes) | Comptes connectés par chaque utilisateur (numéro affiché, WABA, coexistence) |
| `channel_credentials` | Tokens Meta de chaque client — **inaccessible depuis le navigateur** |
| `send_from_inbox()` | Réponse de l'utilisateur ; refusée si la fenêtre de 24 h est fermée |
| `outbound_payload()` / `mark_message_result()` | Utilisées par n8n pour l'envoi |

Testé sur un Postgres local : inscription → organisation créée ; message entrant → conversation + compteur non lus ; réponse → mise en file ; **un autre utilisateur ne voit rien** ; tokens invisibles ; envoi refusé après 24 h ; doublons de webhook ignorés.

---

## 1.6 Points de vigilance

| Sujet | Règle |
|---|---|
| **Bêta avant App Review** | Tant que Meta n'a pas validé l'app, seuls les comptes ajoutés comme testeurs peuvent connecter WhatsApp/Facebook. Idéal pour une bêta avec 5–10 entreprises. |
| **Coexistence** | Vérifier la disponibilité au Cameroun. Le bouton « Nouveau numéro » sert de solution de repli. |
| **Fenêtre de 24 h** | Au-delà, seules les relances par **modèle approuvé** sont possibles (Partie 6). La plateforme bloque déjà la réponse libre. |
| **Tokens** | Stockés côté serveur uniquement. En production, les chiffrer avec Supabase Vault. |
| **Coûts IA** | Chaque analyse et chaque réponse IA coûtent. À intégrer dans le prix des abonnements. |

---

## ✅ Pour valider la Partie 1

- [ ] Le parcours utilisateur (inscription → produit → canaux → conversations) te convient
- [ ] Le conseiller de canaux (analyse IA + règles) correspond à ton idée d'« agent qui s'adapte au produit »
- [ ] Tu lances les démarches Meta (vérification d'entreprise, Tech Provider)

**→ Ensuite : Partie 2, Ciblage & sourcing par produit.**
