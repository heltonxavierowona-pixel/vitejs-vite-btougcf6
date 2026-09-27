# Partie 4 — Détection d'intérêt & bascule vers WhatsApp

Règles du brief :
- **WhatsApp uniquement si l'intérêt est clair et explicite.**
- **Réponse négative ou neutre : arrêter et archiver, sans relance.**

---

## 4.1 Architecture

```
Message reçu (FB / IG / WhatsApp)         Réponse LinkedIn / X collée par l'utilisateur
        │ Database Webhook                          │ log_assisted_message
        ▼                                           ▼
n8n 03 : attente 20 s ──► classify-message ◄── plateforme (résultat immédiat)
                               │ IA « rapide » : intention + confiance + citation + numéro
                               ▼
                         apply_intent (SQL, machine à états)
   ┌──────────────┬──────────────┬───────────────┬─────────────┬──────────────┐
interested      curious      neutral/negative   stop        confiance < seuil
   │              │           /not_now          │               │
   ▼              ▼              ▼               ▼               ▼
proposer       répondre     archivé,        archivé +       « À vérifier » :
WhatsApp       (Partie 3)   sans relance    ne plus jamais   l'utilisateur tranche
   │                                         contacter
   ├─ Facebook / Instagram : message envoyé seul (réglable) via workflow 02
   └─ LinkedIn / X : brouillon à copier
```

| Brique | Fichier |
|---|---|
| Machine à états, journal LinkedIn/X, reconnaissance du code | `supabase/migrations/0005_intent_handoff.sql` |
| Prompt d'intention, extraction de numéro, lien WhatsApp | `supabase/functions/_shared/prompts.ts` |
| Classification + bascule | `supabase/functions/classify-message` |
| Automatisation | `n8n/workflows/03-intent-profile.json` (intention puis profil) |
| Plateforme | Prospects → **Réponses** ; Pipeline (archivés) ; Paramètres → **Bascule vers WhatsApp** ; Conversations (LinkedIn/X en mode copier) |

---

## 4.2 Les 7 intentions

| Intention | Exemples | Action |
|---|---|---|
| **interested** (explicite) | « Oui ça m'intéresse », « Comment on commande ? », « Envoyez-moi une démo », « How much? » | Proposer WhatsApp |
| **curious** | « C'est quoi exactement ? », « Ça marche pour les PME ? » | Répondre (✨ Suggérer), pas encore WhatsApp |
| **neutral** | « Merci », « Ok », « Intéressant », 👍 | **Archivé, sans relance** |
| **not_now** | « Revenez vers moi en janvier » | **Archivé, sans relance** (la période est notée) |
| **negative** | « Non merci », « On a déjà un outil » | **Archivé, sans relance** |
| **stop** | « Arrêtez de m'écrire » | Archivé + **ne plus jamais contacter** |
| **other** | Absence automatique, spam | Rien |

Principes du prompt : **la politesse n'est pas de l'intérêt** ; dans le doute entre « intéressé » et « curieux », on choisit « curieux » ; une vraie question n'est jamais « neutre ».

Garde-fous de la machine à états :
- **Seuil de confiance** (70 % par défaut, réglable) : en dessous, rien d'automatique, le prospect passe dans « À vérifier ».
- **Stop respecté dès 50 %** de confiance : mieux vaut perdre un prospect que harceler quelqu'un.
- **L'archivage ne concerne que les premiers échanges** (nouveau, contacté, a répondu). Un « merci » d'un prospect déjà sur WhatsApp n'archive rien.
- **Une seule proposition WhatsApp** par prospect.
- **Seul le dernier message compte** : si le prospect a écrit à nouveau entre-temps, l'ancien message n'entraîne aucune action.
- Chaque décision est tracée dans `message_classifications` (intention, confiance, citation, action, source IA/humain).

---

## 4.3 La bascule : un lien, pas un message à froid

Quand l'intérêt est explicite, le prospect reçoit un lien WhatsApp **avec son code personnel** :

```
Avec plaisir Nadine ! Pour vous envoyer tous les détails et vous répondre plus vite,
écrivez-moi sur WhatsApp quand vous voulez : https://wa.me/2376…?text=Bonjour… (réf. UCT7VR)
```

Pourquoi un lien plutôt qu'un message WhatsApp envoyé par l'entreprise :

| | Lien (choisi) | Message envoyé par l'entreprise |
|---|---|---|
| Consentement | Évident : c'est lui qui écrit | À prouver |
| Règles Meta | Fenêtre de 24 h ouverte, réponses libres | Modèle approuvé obligatoire |
| Coût | Gratuit | Modèle facturé |
| Qualité du numéro | Aucun risque de signalement | Risque si le prospect ne s'y attend pas |

À l'arrivée du message WhatsApp, `ingest_inbound_message` reconnaît le code : la conversation WhatsApp est **rattachée au même prospect** (historique LinkedIn/Instagram et profil relationnel conservés) et il passe à l'étape « Sur WhatsApp ».

L'IA n'écrit jamais l'URL elle-même : elle place un marqueur `{{LIEN_WHATSAPP}}`, remplacé par le vrai lien (ajouté à la fin si le marqueur manque).

**Si le prospect donne directement son numéro**, le numéro est extrait du message (jamais « deviné » par l'IA), enregistré avec son consentement, et l'utilisateur le contactera par modèle WhatsApp (Partie 6).

**Si aucun WhatsApp n'est connecté**, le prospect reste « Intéressé » et la plateforme demande de connecter WhatsApp.

---

## 4.4 LinkedIn et X

Sans API, l'utilisateur colle la réponse reçue (Prospects → Réponses → « Coller sa réponse »). La plateforme :
1. enregistre la réponse dans l'historique (conversation « LinkedIn (assisté) ») ;
2. la classe immédiatement ;
3. affiche l'intention, la citation, l'action et, si l'intérêt est explicite, le message de bascule à copier.

Les premiers messages copiés depuis la file du jour sont aussi gardés dans l'historique : l'IA a le contexte complet. Dans Conversations, ces échanges s'affichent avec un bouton **Copier** au lieu d'**Envoyer**.

---

## 4.5 Réglages (Paramètres → Bascule vers WhatsApp)

| Réglage | Défaut | Effet |
|---|---|---|
| Envoi automatique de la proposition sur Facebook/Instagram | Oui | Sinon, un brouillon est préparé |
| Certitude minimale pour agir seule | 70 % | En dessous : « À vérifier » |

---

## 4.6 Tests réalisés

**Base (Postgres local), 7 scénarios :**
1. Instagram « je veux commander » → proposition WhatsApp, code créé ; second message intéressé → pas de seconde proposition.
2. Message WhatsApp contenant le code → **même prospect**, étape « Sur WhatsApp », 2 identités (Instagram + WhatsApp).
3. « Merci » à 55 % → « À vérifier » ; à 90 % → archivé (neutre).
4. « Arrêtez » à 60 % → stop ; un message « intéressé » ensuite → aucune action.
5. Ancien message alors qu'un plus récent existe → ignoré.
6. Numéro donné sur Instagram → enregistré avec consentement.
7. LinkedIn : premier message + réponse enregistrés, compte « LinkedIn (assisté) » créé, décision humaine appliquée ; **un autre client ne peut pas modifier ce prospect**.

**Fonctions (Node) :** numéros camerounais avec ou sans indicatif, étrangers, dates et montants non pris pour des numéros ; numéro inventé par le modèle rejeté ; lien encodé ; marqueur remplacé ou ajouté.

**Plateforme (démo) :** intérêt → brouillon avec lien et code ; refus → archivé ; « Merci » sous le seuil → « À vérifier » puis tranché ; pipeline avec intentions et archivés ; ordinateur et mobile sans débordement.

**Non testé en conditions réelles :** la qualité de classification de l'IA (clé OpenRouter nécessaire) et l'envoi automatique via Meta.

---

## 4.7 Points de vigilance

| Sujet | Règle |
|---|---|
| **Faux positifs** | Proposer WhatsApp trop tôt agace. Seuil de 70 % et règle « dans le doute : curieux ». Surveille « À vérifier » les premières semaines pour ajuster le seuil. |
| **Stop** | Définitif et prioritaire sur tout le reste (y compris les relances de la Partie 6). |
| **Code dans le message** | Si le prospect efface le texte pré-rempli, le code est perdu : il deviendra un nouveau prospect WhatsApp (rattaché au produit par défaut). La fusion manuelle viendra en Partie 5. |
| **Coût** | Une classification ≈ 0,002 $ (modèle rapide) ; un message de bascule ≈ 0,01 $ (modèle de rédaction), une seule fois par prospect. |

---

## ✅ Pour valider la Partie 4

- [ ] Les 7 intentions et leurs actions
- [ ] Bascule par lien WhatsApp avec code personnel
- [ ] Seuil de confiance + « À vérifier »
- [ ] Réponses LinkedIn/X collées

**→ Ensuite : Partie 5, conversation WhatsApp autonome et validations manuelles (prix, contrat).**
