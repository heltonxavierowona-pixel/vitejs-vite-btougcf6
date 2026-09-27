# Partie 2 — Ciblage & sourcing par produit

Objectif : pour **chaque produit** d'un utilisateur, alimenter la plateforme en prospects **sans scraping, sans robot et sans outil payant**, en respectant les règles de chaque réseau.

---

## 2.1 Architecture

Le ciblage vient de l'analyse du produit (Partie 1) : segments, réseaux recommandés, rôle de chaque réseau. La Partie 2 branche **une source par rôle** :

| Rôle du réseau | Réseaux | Source de prospects | Automatisation |
|---|---|---|---|
| **Aller chercher** (sortant) | LinkedIn, X | L'utilisateur colle les profils qu'il consulte → l'IA extrait et **qualifie** → **file du jour** | Semi-manuelle (assistée) |
| **Attirer** (entrant) | Facebook, Instagram | **Mots-clés en commentaire** (« INFO », « PRIX ») → réponse privée automatique | Automatique |
| **Conclure** (entrant) | WhatsApp | **Liens wa.me par produit et par source**, avec code de référence | Automatique |
| Tous | Messages privés spontanés | Rattachés au **produit par défaut** du compte | Automatique |

```
LinkedIn / X ──(copier-coller)──► Importer ──► IA : extraction + score ──► File du jour (quota) ──► Contacté
Commentaire « INFO » ──► webhook Meta ──► handle_comment ──► réponse privée ──► conversation + prospect
wa.me/…?text=…(réf. WX4Q1) ──► message WhatsApp ──► ingest : code WX4Q1 ──► produit + source attribués
```

---

## 2.2 Sortant : import, qualification, file du jour

### Import
Onglet **Prospects → Importer**. L'utilisateur copie depuis LinkedIn (ou Sales Navigator) ou X le haut des profils qui l'intéressent : nom, titre, entreprise, lieu, « À propos », URL. Un profil par bloc, 20 par import.

- **Doublons** : un même profil (même URL) n'est jamais importé deux fois pour une organisation.
- **Pas d'extension ni de robot** : c'est l'humain qui consulte et copie. C'est ce qui garde le compte LinkedIn en bonne santé et la plateforme dans les règles.

### Qualification IA (`supabase/functions/qualify-prospects`)
Pour chaque profil, l'IA renvoie : nom, poste, entreprise, pays, langue, **segment** (parmi ceux de l'analyse produit), **score d'adéquation 0–100** et 2–3 raisons factuelles.

Prompt (extrait, complet dans le fichier) :
```text
Barème : 80+ = décideur dans le cœur de cible ; 50-79 = cible plausible ou influenceur ;
20-49 = lien faible ; <20 = hors cible (étudiant sans lien, concurrent, secteur sans rapport).
Règles : n'invente rien ; aucune donnée sensible (santé, religion, origine, opinions) ;
un concurrent direct reçoit moins de 20.
```

Repli par règles (`src/lib/prospectQualifier.ts`) si l'IA est indisponible ou en mode démo : mots de la cible retrouvés dans le profil (avec synonymes : DG/CEO/gérant → dirigeant, DRH/HR → RH), pénalité pour les profils en formation quand l'offre vise les entreprises.

### File du jour et rythme
L'onglet **À contacter aujourd'hui** montre les meilleurs prospects **dans la limite d'un quota quotidien**, selon l'ancienneté du compte déclarée par l'utilisateur :

| Compte | LinkedIn / jour | X / jour |
|---|---|---|
| Neuf (< 1 mois) | 10 | 10 |
| En chauffe (1–3 mois) | 15 | 20 |
| Établi | 20 | 30 |

Quand le quota est atteint, la file se vide jusqu'au lendemain. Le message personnalisé sera rédigé par l'IA à la **Partie 3** ; pour l'instant l'utilisateur ouvre le profil et marque le prospect « contacté ».

Si l'analyse produit a noté LinkedIn ou X en dessous de 30, la plateforme le signale et recommande les sources entrantes.

---

## 2.3 Entrant Facebook / Instagram : mots-clés en commentaire

Onglet **Prospects → Sources entrantes**. L'utilisateur crée un déclencheur : compte (Page ou Instagram), mots-clés, réponse privée, éventuellement limité à une publication.

Workflow n8n `01 · Meta inbound` (branche commentaires) :
1. Webhook `feed` (Facebook) ou `comments` (Instagram) → **Extraire événements** (`kind = comment`).
2. `handle_comment` (SQL) : enregistre le commentaire **une seule fois**, ignore ceux de la Page elle-même, cherche un mot-clé actif ; si trouvé, crée prospect + conversation rattachés au produit et prépare la réponse.
3. **Réponse privée** : `POST /me/messages` avec `recipient.comment_id` et le token de la Page de l'utilisateur.
4. Statut du message mis à jour (envoyé / échec).

Quand la personne répond en privé, sa réponse arrive dans la boîte de réception, dans la même conversation (Instagram utilise le même identifiant pour les commentaires et les messages).

---

## 2.4 Entrant WhatsApp : liens par produit et par source

L'utilisateur crée un lien par endroit de diffusion (bio Instagram, statut WhatsApp, affiche, signature e-mail, publicité) :

```
https://wa.me/2376XXXXXXXX?text=Bonjour, je souhaite en savoir plus sur Core HR (réf. HR7K2)
```

À l'arrivée du premier message, `ingest_inbound_message` repère le code, rattache le prospect au **produit** et à la **source** (`lien:Flyer salon RH`), et incrémente le compteur de conversations du lien. L'utilisateur sait ainsi quelle source rapporte des clients.

C'est le prospect qui écrit en premier : la fenêtre de 24 h est ouverte et le consentement est clair.

---

## 2.5 Base de données (migration `0003_sourcing.sql`)

| Élément | Rôle |
|---|---|
| `prospects` (+ colonnes) | `profile_url`, `profile_text`, `fit_score`, `fit_reasons`, `best_channel`, `qualified_at`, `contacted_at` ; unicité du profil par organisation |
| `organizations.outreach_profile` + `daily_outreach_limit()` | Rythme de prospection sortante |
| `outreach_queue()` | File du jour : meilleurs prospects, dans la limite restante |
| `entry_links` | Liens WhatsApp avec code de référence |
| `keyword_triggers`, `comment_events` | Déclencheurs par mot-clé, journal idempotent des commentaires |
| `channel_accounts.default_product_id` | Produit attribué aux messages spontanés sur ce compte |
| `ingest_inbound_message()` (mise à jour) | Attribution produit + source |
| `handle_comment()` | Traitement d'un commentaire |

**Testé sur un Postgres local** : lien avec code → bon produit et bonne source, compteur incrémenté ; message sans code → produit par défaut du compte ; mot-clé → réponse préparée ; même commentaire reçu deux fois → une seule réponse ; commentaire sans mot-clé ou de la Page elle-même → ignoré ; réponse en DM → même prospect ; file du jour : 10 pour un compte neuf, 7 après 3 contacts, puis 11 restants en compte établi.

---

## 2.6 Points de vigilance

| Sujet | Règle |
|---|---|
| **LinkedIn** | Pas de scraping, pas d'extension d'automatisation, y compris pour « lire » les profils. Le copier-coller manuel est la limite. Les quotas sont volontairement bas. |
| **Réponses privées Meta** | Une seule réponse privée par commentaire, dans les 7 jours. Ensuite, c'est à la personne de répondre pour ouvrir la conversation. |
| **Permissions Meta** | Les commentaires demandent en plus `pages_read_engagement` / `pages_read_user_content` (Facebook) et `instagram_manage_comments` (Instagram), à ajouter à la configuration Facebook Login for Business et à l'App Review. À confirmer lors de la configuration de l'app. |
| **Facebook : identité commentaire ≠ message** | Sur Facebook, l'identifiant d'un commentateur diffère de son identifiant Messenger : s'il répond en privé, un second prospect peut être créé. La fusion de doublons est prévue en Partie 5. |
| **Données personnelles** | Le texte de profil collé est conservé pour la qualification. Il doit être supprimable (droit à l'effacement) et ne jamais contenir de données sensibles. |
| **Coût IA** | ~1 appel par import de 20 profils avec un modèle économique : quelques centimes. |

---

## ✅ Pour valider la Partie 2

- [ ] Import + qualification + file du jour pour LinkedIn/X te conviennent (quotas compris)
- [ ] Mots-clés en commentaire pour Facebook/Instagram
- [ ] Liens WhatsApp par produit et par source

**→ Ensuite : Partie 3, le cerveau IA (messages personnalisés, ton adapté, multilingue, profil relationnel).**
