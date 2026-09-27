# Partie 5 — Conversation WhatsApp autonome & validations

Règles du brief :
- **L'IA converse en autonomie**, SAUF sujets sensibles (prix, contrat) qui exigent une **validation manuelle**.
- **Texte uniquement** (pas de mémos vocaux pour l'instant).

---

## 5.1 Architecture

```
Message WhatsApp du client
   │ webhook Meta → n8n 01 → ingest_inbound_message
   │ Database Webhook (INSERT) → n8n 03, attente 20 s
   ▼
classify-message (Partie 4) → update-profile (Partie 3) → autopilot-reply
                                                              │
      ┌────────────────────────┬──────────────────────────┬──┴────────────────────┐
  pilote en pause /       vocal, image, demande        sujet sensible            réponse normale
  déjà répondu /          d'un humain, mécontentement, (IA OU filet de mots-clés)     │
  fenêtre fermée          info inconnue, > 20 rép./24 h      │                        ▼
      │                        │                             ▼                   message « queued »
      ▼                        ▼                   message « pending_approval »        │
   rien                   IA en pause +            + ligne dans approvals              │
                          bandeau rouge                      │                         │
                                                    Validations : approuver /          │
                                                    modifier / rejeter                 │
                                                             │ UPDATE → « queued »     │
                                                             ▼                         ▼
                                                      n8n 02 → API WhatsApp → client
```

| Brique | Fichier |
|---|---|
| Garde-fous, validations, reprise en main, échos, fusion | `supabase/migrations/0006_autopilot_approvals.sql` |
| Prompt autonome, détection des sujets sensibles, messages non textuels | `supabase/functions/_shared/prompts.ts` |
| Pilote automatique | `supabase/functions/autopilot-reply` |
| Automatisations | n8n 01 (échos du téléphone), 02 (envoi après validation), 03 (pilote après profil) |
| Plateforme | **Validations** (badge dans le menu), Conversations (interrupteur, bandeaux, fusion, simulateur démo), Paramètres → Automatisation |

---

## 5.2 Quand l'IA répond seule

Toutes ces conditions sont revérifiées en base **au moment d'écrire** (`queue_autopilot_reply`), pas seulement au moment de rédiger :

| Garde-fou | Pourquoi |
|---|---|
| Pilote actif pour l'organisation (WhatsApp : oui par défaut ; Messenger/Instagram : non) | Choix de l'utilisateur |
| Conversation non mise en pause | Reprise en main respectée |
| Prospect sans demande d'arrêt | Partie 4 |
| **Le dernier message est celui du client** | Jamais deux messages d'affilée |
| Fenêtre de 24 h ouverte | Règle Meta |
| Moins de 20 réponses IA sur 24 h dans la conversation | Anti-boucle (ex. échange avec un autre robot) |

## 5.3 Validations (prix, remise, devis, contrat, paiement, remboursement)

Double détection :
1. **L'IA** signale le sujet sensible (instruction du prompt).
2. **Filet de mots-clés et montants**, sur le message du client ET sur la réponse proposée : « combien », « tarif », « 25 000 FCFA », « 10 % », « devis », « MoMo », « rembours… ». Il suffit d'un des deux pour bloquer l'envoi.

La réponse est alors enregistrée « en attente de validation » :
- elle apparaît dans la conversation (bordure pointillée, lien « En attente de votre validation ») ;
- elle est listée dans **Validations** avec les messages du client, les sujets détectés et **le temps restant dans la fenêtre de 24 h** ;
- **Approuver et envoyer**, **Envoyer ma version** (texte modifié) ou **Rejeter** ;
- après 24 h sans message du client, l'envoi est refusé : il faudra un modèle WhatsApp (Partie 6).

Chaque décision est tracée (`approvals` : texte proposé, texte envoyé, auteur, date). C'est utile pour vérifier plus tard ce que l'IA propose et ce que tu corriges.

## 5.4 Passage de relais à l'humain

L'IA se met en pause et un bandeau rouge « L'IA vous passe la main : … » s'affiche quand :
- le client envoie un **vocal, une image ou un document** (texte uniquement pour l'instant) ;
- il **demande un humain**, se plaint ou est mécontent ;
- la réponse exige une information **absente des connaissances produit** ;
- c'est un cas particulier (réclamation, commande spéciale, urgence) ;
- la limite de 20 réponses en 24 h est atteinte.

Dans les cas signalés par l'IA, une courte réponse d'attente est envoyée (« je vérifie avec Awa et je reviens vers vous »), et elle passe elle-même par la validation si elle touche un sujet sensible.

## 5.5 Reprise en main

- **Interrupteur « Pilote auto »** dans chaque conversation.
- **Si l'utilisateur répond lui-même** depuis la plateforme, le pilote se met en pause.
- **Si l'utilisateur répond depuis son téléphone** (WhatsApp en coexistence), le message arrive par le webhook `smb_message_echoes`, est ajouté à l'historique, et le pilote se met en pause.

## 5.6 Honnêteté

Le prompt impose : « Tu es l'assistant de {prénom}. Si on te demande si tu es un robot ou une IA, ne mens jamais. » C'est vrai pour tous les messages rédigés par l'IA, pas seulement le pilote.

## 5.7 Fusion de doublons

Dans Conversations, « Même personne qu'une autre fiche ? Fusionner » rattache une fiche à la fiche courante : identités, conversations (fusionnées si même canal), messages, validations, historique, profil relationnel. Cela règle les cas signalés en Parties 2 et 4 : commentaire Facebook suivi d'un message Messenger, code WhatsApp effacé.

---

## 5.8 Tests réalisés

**Base (Postgres local) :** réponse normale mise en file ; seconde réponse d'affilée refusée ; question de prix → validation avec échéance ; décision refusée pour un autre client ; version modifiée envoyée ; double décision refusée ; passage de relais → pause, puis plus aucune réponse ; approbation refusée après 24 h, rejet accepté ; écho du téléphone enregistré une seule fois, puis pause ; fusion de deux fiches (2 conversations, 2 identités) ; fusion refusée pour un autre client.

**Fonctions (Node) :** détection des sujets sensibles (montants FCFA, pourcentages, MoMo, devis) sans faux positif sur « taille 42 » ou une date ; prompt autonome à une seule réponse, avec règle d'honnêteté ; réponse vide → passage de relais ; vocal reconnu.

**Workflows :** échos du téléphone extraits ; envoi après validation déclenché uniquement par le passage « en attente » → « en file ».

**Plateforme (démo, avec simulateur client) :** question de livraison → réponse seule ; question de prix → validation + badge ; vocal → passage de relais ; pilote en pause → pas de réponse ; réactivation ; réponse manuelle → pause ; version modifiée envoyée ; rejet affiché barré ; fusion ; ordinateur et mobile sans débordement.

**Non testé en conditions réelles :** qualité des réponses de l'IA et format exact du webhook `smb_message_echoes` (à vérifier sur un vrai numéro en coexistence).

---

## 5.9 Points de vigilance

| Sujet | Règle |
|---|---|
| **Déploiement** | `autopilot-reply` se déploie avec `--no-verify-jwt` (appelée par n8n, protégée par le secret). Le Database Webhook du workflow 02 doit écouter **INSERT et UPDATE** sur `messages`. |
| **Réactivité** | Délai typique entre le message du client et la réponse : ~30 s (20 s de regroupement + IA). Assez humain, sans faire attendre. |
| **Validations oubliées** | Le temps restant est affiché ; l'alerte Telegram immédiate arrive en Partie 7. |
| **Coût** | ~0,01 à 0,015 $ par réponse autonome (modèle de rédaction), plus classification et profil. Une conversation de 15 échanges ≈ 0,25 $. À intégrer aux quotas des formules. |
| **Responsabilité** | L'utilisateur reste responsable de ce que dit son assistant : les connaissances produit doivent être exactes. |

---

## ✅ Pour valider la Partie 5

- [ ] Pilote automatique WhatsApp et ses garde-fous
- [ ] Validations des sujets sensibles (approuver / modifier / rejeter)
- [ ] Passage de relais et reprise en main
- [ ] Fusion des doublons

**→ Ensuite : Partie 6, closing (présentation/lien puis demande d'appel) et relances (2 maximum, puis abandon).**
