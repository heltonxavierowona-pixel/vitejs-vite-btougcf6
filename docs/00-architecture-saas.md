# Le Closer — Architecture SaaS

> Plateforme de prospection IA **ouverte à tous** : chaque utilisateur décrit son produit,
> connecte ses propres comptes (WhatsApp, Facebook, Instagram), et discute avec ses clients
> depuis la plateforme pendant que les clients restent sur leurs applications habituelles.

---

## 1. Les 3 principes du produit

1. **L'agent part du produit, pas d'une cible figée.**
   L'utilisateur décrit ce qu'il vend. L'IA en déduit les cibles, **les réseaux adaptés** (avec un score et les raisons), le ton, les langues et les accroches. Une boutique de wax n'est pas prospectée comme un logiciel RH.
2. **Chaque utilisateur connecte SES comptes.**
   Son numéro WhatsApp Business (en le gardant dans son application grâce à la *coexistence*), sa Page Facebook, son Instagram professionnel. Le Closer ne possède aucun numéro de client.
3. **Le client final ne change rien à ses habitudes.**
   Il écrit sur WhatsApp, Messenger ou Instagram. L'utilisateur (et l'IA) lui répondent depuis la boîte de réception de la plateforme.

```
   CLIENT FINAL                         LE CLOSER                        UTILISATEUR
 (reste sur ses apps)              (plateforme SaaS)                (entreprise abonnée)

 WhatsApp  ─┐                                                       ┌─ Produits : décrit son offre
 Messenger ─┼─► webhooks Meta ─► n8n ─► Supabase ─► temps réel ─► ├─ Canaux : connecte ses comptes
 Instagram ─┘                                                       └─ Conversations : répond
     ▲                                                                        │
     └────────── Graph API (token du compte de l'utilisateur) ◄─ n8n ◄────────┘
```

---

## 2. Les règles de chaque réseau

Ces règles viennent des plateformes. Le conseiller de canaux les applique toujours, même si l'IA propose autre chose.

| Canal | Premier message à froid | Réponses | Rôle dans Le Closer |
|---|---|---|---|
| **LinkedIn** | Pas d'API de messagerie ; l'automatisation est interdite par ses conditions | — | **Assisté** : l'IA rédige, l'utilisateur envoie depuis son compte |
| **X** | API payante | — | **Assisté** |
| **Facebook** | **Interdit** : une Page ne peut que répondre | Libre 24 h après chaque message du client | **Auto, entrant** |
| **Instagram** | **Interdit** ; compte Professionnel obligatoire | Libre 24 h ; une réponse privée par commentaire | **Auto, entrant** |
| **WhatsApp** | Uniquement avec un **modèle approuvé** + consentement | Libre 24 h après chaque message du client | **Auto, conclusion** |

**Validé :** LinkedIn et X restent en mode assisté.

---

## 3. Comment un utilisateur connecte ses comptes

Pour que des milliers d'utilisateurs connectent **leurs propres** comptes, Le Closer doit devenir **Tech Provider Meta** (fournisseur technologique). C'est le même statut que les outils du marché (Respond.io, Wati, etc.).

| Compte | Mécanisme officiel | Ce que voit l'utilisateur |
|---|---|---|
| **WhatsApp** | **Embedded Signup** (inscription intégrée) | Bouton « Garder mon numéro WhatsApp Business » → fenêtre Meta → choisit son numéro → c'est connecté |
| **Facebook + Instagram** | **Facebook Login for Business** | Bouton « Connecter Facebook et Instagram » → choisit ses Pages → le compte Instagram lié est connecté aussi |

### WhatsApp : la coexistence

La **coexistence** permet à l'utilisateur de garder son numéro **et** son application WhatsApp Business sur son téléphone, tout en le connectant à Le Closer. Les messages arrivent aux deux endroits. C'est exactement ce que tu décris.

À savoir :
- **Disponibilité par pays à vérifier pour le Cameroun** avant le lancement (Meta l'ouvre progressivement). Sinon, repli sur « nouveau numéro » (bouton déjà prévu).
- Certaines fonctions de l'application sont désactivées sur un numéro en coexistence (ex. messages éphémères, vue unique).
- Les messages que l'utilisateur envoie **depuis son téléphone** remontent par un webhook spécifique : à afficher dans la boîte de réception (Partie 5).

### Qui paie les messages WhatsApp ?

En Tech Provider, **chaque utilisateur ajoute son propre moyen de paiement chez Meta** pendant l'inscription. Les messages facturés (modèles marketing, relances hors 24 h) sont payés par lui, pas par toi. Les réponses dans la fenêtre de 24 h sont gratuites. Ton budget de 10–30 € ne dépend donc pas du volume de tes clients sur WhatsApp.

### ⚠️ Restriction : pas de WhatsApp « par QR code »

Beaucoup d'outils utilisent des bibliothèques non officielles (connexion par QR code comme WhatsApp Web). C'est plus rapide à lancer, mais **interdit par WhatsApp** : les numéros de tes clients se font bannir, souvent sans retour possible, et c'est ta plateforme qui en porte la responsabilité. Le Closer n'utilise que l'API officielle.

---

## 4. Architecture technique

| Brique | Rôle | Coût |
|---|---|---|
| **Plateforme React** (ce dépôt, `src/`) | Inscription, produits, canaux, boîte de réception | Hébergement gratuit (Vercel / Cloudflare Pages) |
| **Supabase** (`supabase/migrations/`) | Base Postgres multi-clients + authentification + temps réel | Gratuit au départ, 25 $/mois quand ça grossit |
| **Edge Functions** (`supabase/functions/`) | Actions déclenchées par l'utilisateur : analyse produit, connexion WhatsApp, connexion Facebook/Instagram | Inclus |
| **n8n** (`n8n/workflows/`) | Automatisations : réception des webhooks Meta, envoi des réponses, relances, alertes | VPS ≈ 5 €/mois |
| **OpenRouter** | IA : analyse produit, rédaction, conversation | À l'usage |

Règles :
1. **Isolation des clients** : chaque table porte `organization_id` et la sécurité par ligne (RLS) garantit qu'un utilisateur ne voit que ses données. Testé.
2. **Tokens invisibles pour le navigateur** : les tokens Meta de chaque client sont dans `channel_credentials`, table accessible uniquement côté serveur.
3. **Un seul format de message** pour tous les canaux (`messages`) : une seule boîte de réception, une seule IA.
4. **L'IA propose, les règles décident** : le rôle et le mode d'un canal ne viennent jamais du modèle.

---

## 5. Coûts et modèle économique

- **Coûts fixes au lancement** : ≈ 10 – 15 €/mois (VPS + domaine + un peu d'IA). ✅ Dans le budget.
- **Coût variable** : l'IA consomme à chaque analyse et chaque réponse. **Il faut l'inclure dans le prix des abonnements** (ex. quota de conversations IA par formule), sinon chaque nouveau client te coûte de l'argent.
- **Proposition de formules** (à valider plus tard) : *Découverte* (1 produit, 1 WhatsApp, IA limitée), *Pro* (plusieurs produits et canaux), *Équipe* (plusieurs utilisateurs sur la même boîte de réception).

---

## 6. Ce qu'il faut obtenir de Meta avant d'ouvrir au public

Sans ces validations, seuls les comptes ajoutés comme **testeurs** de ton app peuvent se connecter. C'est parfait pour une bêta privée, mais bloquant pour un lancement public. **Commence ces démarches dès maintenant, elles prennent plusieurs semaines.**

1. **Vérification d'entreprise** de ta société dans Meta Business (documents officiels).
2. **Inscription comme Tech Provider** WhatsApp.
3. **App Review** (accès avancé) pour : `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`, `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` (commentaires, Partie 2). Meta demande une vidéo de démonstration de chaque permission dans la plateforme.
4. **Politique de confidentialité et conditions d'utilisation** publiées en ligne (obligatoires pour l'App Review).

---

## 7. Points de vigilance

- **Données personnelles** : tu traites les conversations des clients de tes clients. Au Cameroun, loi n° 2024/017 sur la protection des données personnelles (à confirmer avec un juriste) ; RGPD si tu as des utilisateurs en Europe. Prévoir : contrat de traitement des données, suppression sur demande, durée de conservation.
- **Profil relationnel** plutôt que « mémoire émotionnelle » : on garde les préférences utiles à la vente (ton, intérêts, objections), jamais de données sensibles.
- **Qualité des numéros** : si un utilisateur spamme, c'est son numéro qui est dégradé par Meta, mais c'est ton app qui est surveillée. Les garde-fous (pas de message à froid, fenêtre de 24 h, validation humaine des prix) protègent tout le monde.
- **Transparence IA** : afficher qu'un assistant répond est recommandé.

---

## 8. Plan des parties

| # | Partie | Statut |
|---|---|---|
| 01 | Fondations SaaS : inscription, produits + conseiller de canaux, connexion des comptes, boîte de réception | ✅ Validée |
| 02 | Ciblage & sourcing par produit : import qualifié + file du jour, mots-clés en commentaire, liens WhatsApp | ✅ Validée |
| 03 | Cerveau IA : rédaction personnalisée, ton adapté, multilingue, profil relationnel, suivi des coûts IA | ✅ Validée |
| 04 | Détection d'intérêt (7 intentions, seuil de confiance) & bascule WhatsApp par lien avec code personnel | ✅ Validée |
| 05 | Pilote automatique WhatsApp, validations (prix, contrat…), passage de relais, reprise en main, fusion des doublons | **Livrée — en attente de validation** |
| 06 | Closing & relances (modèles WhatsApp) | À venir |
| 07 | Tableau de bord & alertes | À venir |
