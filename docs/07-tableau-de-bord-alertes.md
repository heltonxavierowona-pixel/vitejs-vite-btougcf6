# Partie 7 — Tableau de bord & alertes

Règles du brief :
- **Dashboard visuel** (pas un simple tableau).
- **Alerte immédiate (Telegram ou mail)** dès qu'un prospect devient « chaud ».

---

## 7.1 Alertes immédiates

### Ce qui déclenche une alerte
Les alertes naissent **en base, par triggers**, quel que soit l'auteur du changement (pilote automatique, n8n, bouton dans la plateforme) :

| Événement | Déclencheur | Exemple de message |
|---|---|---|
| 🔥 **Prospect chaud** (le cœur du brief) | `prospects.stage` passe à `hot` (présentation envoyée, appel proposé…) | « 🔥 Prospect chaud : Mireille · Robe wax · WhatsApp · Présentation envoyée · Signaux : date précise, demande le prix · Résumé… » + lien direct |
| ⏸ Réponse à valider | nouvelle ligne dans `approvals` | sujet (prix…), début de la réponse proposée |
| 🙋 L'IA passe la main | pause de l'IA pour escalade | la raison (vocal, demande d'un humain…) |
| 🏆 Vente gagnée | `stage` passe à `won` | produit, entreprise |

« Chaud » et « Gagné » ne sont envoyés **qu'une fois par prospect** (index unique). Chaque utilisateur choisit les événements qu'il veut recevoir.

### Le trajet (quelques secondes)
```
trigger → table alerts (INSERT) → Database Webhook → n8n 05
   → alert_delivery (texte + destinations, ou rien si l'événement est désactivé)
   → Telegram et/ou e-mail (SMTP)  → mark_alert_sent
```
Chaque alerte contient un **lien direct** vers la conversation (`/conversations?c=…`) ou vers Validations.

### Telegram : un bot pour toute la plateforme, un chat par client
1. Paramètres → Alertes → **Connecter Telegram** : la plateforme génère un code à usage unique et ouvre `t.me/<bot>?start=<code>`.
2. L'utilisateur appuie sur **Démarrer** : le bot (n8n 06) reçoit `/start <code>`, relie ce chat à son organisation et confirme « ✅ Alertes Numera Agentic activées ».
3. **Sécurité** : l'identifiant du chat n'est écrit que par le serveur. Un utilisateur peut se déconnecter, mais ne peut pas rediriger les alertes vers un autre chat (trigger `protect_org_columns`, testé).

### E-mail
Adresse libre dans Paramètres → Alertes. Envoi par le credential SMTP de n8n (ex. Brevo : 300 e-mails/jour gratuits).

Bouton **« Envoyer une alerte de test »** pour vérifier la chaîne complète.

---

## 7.2 Tableau de bord (Rapports)

Un seul rang de filtres en haut (**période 7 / 30 / 90 jours**, **produit**), qui s'applique à tout. Les chiffres sont calculés en base (`dashboard_stats`, soumis à RLS : chaque client ne voit que ses données).

| Bloc | Forme | Ce qu'il dit |
|---|---|---|
| **Prospects chauds** | Chiffre principal (grand format) | Qui est prêt à acheter maintenant |
| Taux de réponse, appels planifiés, ventes, réponses de l'IA (dont en attente), coût IA (+ relances WhatsApp facturées) | Tuiles | L'état en un coup d'œil |
| **Entonnoir de conversion** | Barres horizontales, une série | Prospects → contactés → ont répondu → intéressés → sur WhatsApp → chauds → appel → gagnés ; au survol, le taux par rapport à l'étape précédente |
| **Par réseau d'origine** | Barres groupées, 2 séries | Combien chaque réseau apporte, et combien deviennent chauds : **c'est ce qui dit où investir son temps** |
| **Activité** | Courbes quotidiennes, 2 séries (reçus / envoyés), réticule | Le rythme des conversations |
| **Prospects chauds** + dernières alertes | Liste avec bouton « Ouvrir » | Passer à l'action |
| **Coût IA par usage** | Barres | Pilote, rédaction, profils… : pour calibrer les formules d'abonnement |

Choix de visualisation (méthode appliquée, palette **validée par script** en clair et en sombre sur les fonds réels de la plateforme) :
- une seule échelle par graphique, jamais deux axes ;
- barres fines arrondies en bout, courbes de 2 px, grille en filets discrets ;
- légende dès 2 séries, valeurs en bout de barre et en fin de courbe ;
- infobulles au survol **et au clavier** (flèches sur le graphique d'activité) ;
- **« Voir les données »** sous chaque graphique : la valeur n'est jamais accessible seulement par l'infobulle ;
- mode sombre avec ses propres teintes ;
- rechargement sans clignotement (l'ancien rendu reste affiché, estompé).

---

## 7.3 Correctif important (Parties 3 à 6)

En préparant les alertes, j'ai trouvé un **bug introduit dans les parties précédentes** : la table `organizations` n'avait qu'une règle de lecture. En production, l'enregistrement de la **voix de marque**, des **réglages d'automatisation** et du **rythme LinkedIn** aurait été refusé.
- Mes tests SQL passaient avec un compte administrateur, qui ignore les règles de sécurité.
- Le mode démo n'utilise pas la base.

Corrigé dans `0008` avec une règle de modification réservée aux membres, et **testé avec un vrai rôle utilisateur** :
- un membre modifie ses réglages ;
- un autre client ne le peut pas ;
- la formule et le chat Telegram restent protégés.

---

## 7.4 Fichiers

| Brique | Fichier |
|---|---|
| Correctif, alertes, triggers, liaison Telegram, statistiques | `supabase/migrations/0008_dashboard_alerts.sql` |
| Envoi des alertes | `n8n/workflows/05-alerts.json` |
| Bot Telegram | `n8n/workflows/06-telegram-bot.json` |
| Graphiques | `src/components/Charts.tsx` |
| Écrans | `src/pages/ReportsPage.tsx`, Paramètres → Alertes, Conversations (`?c=`) |

## 7.5 Mise en service

1. **Bot Telegram** : `@BotFather` → `/newbot` → nom d'utilisateur (ex. `LeNumeraAlertesBot`) → token dans le credential Telegram de n8n ; `VITE_TELEGRAM_BOT` = nom du bot (sans @).
2. **SMTP** dans n8n (ex. Brevo) + `ALERT_FROM_EMAIL` et `APP_URL` dans `infra/.env`.
3. **Database Webhook** Supabase : table `alerts`, INSERT → `https://n8n.tondomaine.com/webhook/numera/alerts` (en-tête `x-numera-secret`).
4. Activer les workflows 05 et 06.

---

## 7.6 Tests réalisés

**Base (Postgres local, avec rôle utilisateur réel) :**
- correctif : un membre modifie ses réglages, un autre client ne le peut pas, la formule reste protégée ;
- Telegram : code généré, liaison réussie, code inconnu refusé, code à usage unique, redirection vers un autre chat bloquée ;
- alertes « chaud » (une seule malgré des allers-retours d'étape), « à valider », « passe la main », « gagné », avec texte et lien corrects ;
- événement désactivé → rien n'est envoyé ;
- alerte déjà envoyée → pas de doublon ;
- alerte de test ;
- un autre client ne voit rien ;
- statistiques cohérentes (entonnoir, réseaux, 31 points pour 30 jours), et vides pour un autre client.

**Workflows :** mise en forme du message avec lien, rien à envoyer → aucune sortie, lecture de `/start <code>` (codes invalides ignorés).

**Plateforme (démo) :**
- tuiles, entonnoir, réseaux, activité, coûts ;
- infobulles barres et courbes ;
- filtres période et produit ;
- tableaux de données ;
- lien direct vers une conversation ;
- connexion Telegram (simulée), réglages enregistrés ;
- clair et sombre, ordinateur et mobile (un chevauchement des dates de l'axe sur mobile a été corrigé).

**Non testé en conditions réelles :** l'envoi Telegram et SMTP par n8n, et le bot Telegram. Il faut les credentials.

---

## ✅ Pour valider la Partie 7

- [ ] Alertes : événements, contenu, Telegram et e-mail
- [ ] Tableau de bord : blocs et indicateurs
