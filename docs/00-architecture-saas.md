# Le Closer — Architecture SaaS (vue d'ensemble)

> Agent de prospection IA omnicanal : LinkedIn, X, Facebook, Instagram → WhatsApp.
> Document de référence. Chaque partie (01 → 07) est détaillée dans son propre fichier.

---

## 1. Ce qui change par rapport au brief initial

| Brief initial | Proposition révisée | Pourquoi |
|---|---|---|
| Outil interne mono-utilisateur, SaaS « plus tard, séparément » | **Une seule base de code multi-tenant dès le jour 1**, utilisée d'abord par vous seule (tenant n°1) | Ajouter `organization_id` + la sécurité par ligne (RLS) coûte ~1 h maintenant et évite une réécriture complète plus tard. Vous êtes votre premier client. |
| LinkedIn + X | LinkedIn + X + **Facebook + Instagram** + WhatsApp | Demande de votre part. FB/IG ont une vraie API officielle de messagerie, contrairement à LinkedIn. |
| n8n = tout le produit | **n8n = moteur d'automatisation**, **Supabase = données + auth**, **React (ce dépôt) = plateforme** | Un SaaS a besoin d'une interface, de comptes utilisateurs et d'une base propre. n8n reste le cerveau des workflows (Phase 1), remplaçable par Node.js en Phase 2 sans toucher au front ni à la base. |
| « Mémoire émotionnelle » | **« Profil relationnel »** (préférences pro, ton, historique) | Déduire des émotions ou des traits personnels peut devenir une donnée sensible au sens des lois sur les données personnelles. On garde ce qui sert la vente, rien de plus. |
| Envoi automatique partout | **Deux modes par canal : `auto` (API officielle) ou `assisté` (l'IA rédige, vous envoyez en 1 clic)** | C'est LA restriction majeure, expliquée ci-dessous. |

---

## 2. La réalité des canaux (restrictions importantes)

C'est le point le plus important du projet. **Chaque réseau n'autorise pas la même chose**, et un SaaS qui contourne les règles risque des bannissements de comptes, de l'app Meta et des problèmes juridiques.

| Canal | Premier message à froid (outbound) | Réponses / conversation | API officielle | Mode recommandé |
|---|---|---|---|---|
| **LinkedIn** | ❌ Pas d'API de messagerie pour les non-partenaires. L'automatisation (extensions, robots, cookies) enfreint les CGU de LinkedIn. | ❌ Pas d'API | Non (réservée aux partenaires Sales Navigator / Talent) | **Assisté** : l'IA rédige, vous copiez/envoyez. Réponse collée dans la plateforme → l'IA l'analyse. |
| **X (Twitter)** | ⚠️ Possible via API, mais l'accès aux messages privés est payant (tarifs X variables, historiquement ≥ 200 $/mois pour l'offre Basic, **hors budget**) | ⚠️ Idem | Oui, payante | **Assisté** en Phase 1. Passage `auto` si le budget le permet un jour. |
| **Facebook (Messenger)** | ❌ **Interdit** d'écrire en premier à une personne. Une Page ne peut répondre qu'à quelqu'un qui l'a contactée. | ✅ Fenêtre de **24 h** après chaque message du prospect (+ tag « Human Agent » : 7 jours pour une réponse humaine) | Oui, gratuite (Graph API) | **Auto, en entrant (inbound)** : commentaires → message privé, pubs « Click-to-Messenger », bouton sur la Page. |
| **Instagram (DM)** | ❌ **Interdit** d'écrire en premier. Compte **Professionnel** obligatoire. | ✅ Fenêtre de 24 h (+ Human Agent 7 j). Réponse privée à un commentaire autorisée. | Oui, gratuite | **Auto, en entrant** : « commente INFO et je t'envoie le lien », réponses aux stories, pubs. |
| **WhatsApp (Cloud API)** | ⚠️ Uniquement avec **modèle (template) approuvé par Meta** + **consentement** (opt-in) du prospect | ✅ Libre pendant 24 h après chaque message du prospect | Oui, payante au message (modèles marketing/utilitaires) | **Auto** : canal de closing. Le prospect donne son numéro = consentement. |

### Conséquence stratégique

On ne construit pas « un robot qui spamme 5 réseaux ». On construit un **entonnoir** :

```
          ┌──────────── OUTBOUND (vous allez vers eux) ────────────┐
          │  LinkedIn  ─┐                                           │
          │             ├─► IA rédige ─► VOUS envoyez (1 clic)      │
          │  X         ─┘                                           │
          └─────────────────────────────┬───────────────────────────┘
                                        │ réponse collée / importée
          ┌──────────── INBOUND (ils viennent vers vous) ──────────┐
          │  Facebook  ─┐  commentaire, DM, pub Click-to-Message   │
          │             ├─► webhook Meta ─► IA répond seule (24 h) │
          │  Instagram ─┘                                           │
          └─────────────────────────────┬───────────────────────────┘
                                        ▼
                        Intérêt CLAIR et explicite ?
                          │ non → archiver, pas de relance
                          ▼ oui
                 IA demande le numéro WhatsApp (= opt-in)
                          ▼
          ┌──────────── WHATSAPP (closing) ─────────────────────────┐
          │  IA converse en autonomie                               │
          │  Prix / contrat → VALIDATION MANUELLE (vous)            │
          │  Prêt → présentation / lien → demande d'appel           │
          │  Silence → 2 relances max → abandon                     │
          └─────────────────────────────────────────────────────────┘
                          ▼
             Prospect « chaud » → alerte Telegram immédiate
```

**Amélioration proposée** : pour vos deux cibles (RH/dirigeants au Cameroun et PME), Facebook et WhatsApp sont souvent plus utilisés que LinkedIn. Du contenu organique + une petite pub « Click-to-WhatsApp » (dès ~1-2 €/jour) peut générer des conversations entrantes 100 % automatisables et conformes, là où LinkedIn restera manuel.

---

## 3. Architecture technique

```
┌──────────────────────────┐        ┌─────────────────────────────┐
│  Plateforme web (React)  │◄──────►│  Supabase (gratuit)         │
│  ce dépôt — Vite + TS    │  RLS   │  Postgres + Auth + Realtime │
│  Dashboard, prospects,   │        │  Multi-tenant (org_id)      │
│  validations, canaux     │        └──────────────▲──────────────┘
└──────────────────────────┘                       │ service_role
                                                   │ (serveur uniquement)
┌──────────────────────────┐        ┌──────────────┴──────────────┐
│  Meta (FB, IG, WhatsApp) │──────► │  n8n auto-hébergé (VPS)     │
│  webhooks entrants       │◄────── │  Workflows = cerveau        │
└──────────────────────────┘ Graph  │  ├─ ingestion webhooks      │
                              API   │  ├─ IA (OpenRouter)         │
┌──────────────────────────┐        │  ├─ relances (cron)         │
│  OpenRouter (LLM)        │◄──────►│  └─ alertes Telegram        │
└──────────────────────────┘        └─────────────────────────────┘
```

### Règles d'architecture

1. **La base de données est la source de vérité.** n8n lit/écrit dans Supabase ; il ne stocke rien d'important dans ses propres variables.
2. **Tout est multi-tenant.** Chaque table métier porte `organization_id`. Le front ne voit que les lignes de l'organisation de l'utilisateur connecté (RLS).
3. **Les secrets restent côté serveur.** Tokens Meta, clé OpenRouter, `service_role` Supabase : uniquement dans n8n (ou Edge Functions). Jamais dans le code React.
4. **Chaque message passe par la table `messages`**, quel que soit le canal. Un seul format → une seule IA, un seul dashboard.
5. **Validation humaine = une ligne dans `approvals`.** L'IA propose, la plateforme affiche, vous approuvez, n8n envoie.

---

## 4. Budget mensuel (Phase 1)

| Poste | Choix | Coût estimé |
|---|---|---|
| VPS pour n8n | Hetzner CX22 / Contabo (2 vCPU, 4 Go) | 4 – 6 € |
| Nom de domaine | .com ou .cm | ~1 € (lissé) |
| Base + Auth | Supabase Free | 0 € |
| Hébergement front | Vercel / Cloudflare Pages / Netlify Free | 0 € |
| LLM | OpenRouter, modèle économique pour le tri + modèle plus fort pour la rédaction | 3 – 10 € |
| WhatsApp Cloud API | Messages de service (réponses dans les 24 h) gratuits ; modèles marketing/utilitaires facturés à l'unité selon le pays | 0 – 8 € |
| Messenger / Instagram API | Gratuit | 0 € |
| Alertes | Bot Telegram | 0 € |
| **Total** | | **≈ 10 – 30 €** ✅ |

> ⚠️ Supabase Free met en pause un projet inactif pendant 7 jours. Le workflow n8n de « health-check » (Partie 1) fait une requête quotidienne pour l'éviter.

---

## 5. Plan des parties

| # | Partie | Statut |
|---|---|---|
| 01 | Fondations & comptes (5 canaux + infra + schéma SaaS) | **Livrée — en attente de validation** |
| 02 | Ciblage & sourcing (2 cibles, import semi-manuel, inbound FB/IG) | À venir |
| 03 | Cerveau IA (ton adaptatif, multilingue, profil relationnel) | À venir |
| 04 | Détection d'intérêt & bascule WhatsApp | À venir |
| 05 | Conversation WhatsApp & validations manuelles | À venir |
| 06 | Closing & relances | À venir |
| 07 | Dashboard & alertes | À venir |

## 6. Points de vigilance transverses

- **Protection des données** : le Cameroun dispose d'une loi sur la protection des données personnelles (loi n° 2024/017 du 23 décembre 2024 — à vérifier avec un juriste pour les décrets d'application). Si vous vendez en Europe : RGPD. Prévoir dès maintenant : mentions d'information, droit de suppression (colonne `deleted_at` + purge), durée de conservation, pas de données sensibles dans le profil relationnel.
- **CGU des plateformes** : un SaaS qui automatise LinkedIn pour ses clients engage sa responsabilité. Le mode « assisté » est volontairement le seul proposé pour LinkedIn.
- **App Review Meta** : en usage interne (vous seule, comptes ayant un rôle sur l'app), les permissions fonctionnent en « Standard Access ». **Pour vendre le SaaS à d'autres entreprises**, il faudra la vérification d'entreprise Meta + App Review (Advanced Access) pour `pages_messaging`, `instagram_manage_messages`, `whatsapp_business_messaging`. Comptez plusieurs semaines : à anticiper avant la commercialisation.
- **Transparence IA** : recommandé (et parfois exigé) d'indiquer qu'un assistant automatisé répond. Cela protège aussi votre réputation si l'IA se trompe.
