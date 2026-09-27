# Partie 6 — Closing & relances

Règles du brief :
- **Prospect prêt : envoyer une présentation / un lien, PUIS demander un appel.**
- **Prospect intéressé mais silencieux : 2 relances espacées, puis abandon.**

---

## 6.1 Closing

### Les supports (Produits → Closing)
Par produit : nom et lien de la **présentation** (PDF, page, vidéo), **lien de prise de rendez-vous** (Calendly, Cal.com, Google Agenda…) et **durée de l'appel**. Les liens doivent être en `https://`.

### La séquence, imposée par la plateforme
C'est la base de données qui décide de l'étape (`closing_next_action`), pas l'IA :

| Situation | Étape suivante |
|---|---|
| Prospect intéressé **sur WhatsApp** (arrivé par le lien de bascule, ou intérêt explicite), rien envoyé | **send_presentation** (ou propose_call s'il n'y a pas de présentation) |
| Présentation envoyée **et** le prospect a répondu depuis | **propose_call** |
| Sinon | rien : l'IA converse normalement |

Le pilote automatique (Partie 5) reçoit cette étape dans ses instructions :
1. **Présentation** : il répond au message, puis propose la présentation. Il **ne demande pas encore d'appel**.
2. **Appel** : après la réponse du prospect, il traite d'abord une éventuelle objection, puis propose l'appel avec le lien de rendez-vous, ou demande deux créneaux s'il n'y a pas de lien.

**L'IA n'écrit jamais les liens.** Elle place `{{LIEN_PRESENTATION}}` ou `{{LIEN_RDV}}`, que le code remplace par les vrais liens. **L'étape n'est enregistrée que si le lien figure réellement dans le message envoyé.** Dès que la présentation est envoyée, le prospect passe « Chaud » (c'est ce qui déclenchera l'alerte de la Partie 7).

### Dans Conversations
Une barre d'avancement **Présentation → Appel proposé → Appel planifié** avec des actions rapides :
- **📎 Présentation** et **📞 Proposer un appel** insèrent le texte et le lien dans la réponse. L'étape est enregistrée à l'envoi.
- **✅ Appel planifié** arrête les relances.
- **🏆 Gagné** / **Perdu** clôturent le prospect.

---

## 6.2 Relances

### Qui est relancé
Uniquement les prospects **intéressés, sur WhatsApp ou « chauds »**, à qui nous avons écrit en dernier. Jamais un prospect archivé, en « stop », ou dont l'appel est planifié.

### Le cycle (automatique, en base)

```
Notre message ──► relance 1 prévue à J+2 ──► relance 2 à J+2+5 ──► abandon à J+2+5+5 (« sans réponse »)
        ▲                                                                        │
        └──────────── toute réponse du prospect remet le compteur à zéro ◄───────┘
```

- Délais réglables (Paramètres → Automatisation), 2 relances maximum.
- Planification par trigger sur `messages` : notre message programme la relance 1, un message du prospect annule tout.
- Exécution par **n8n 04**, toutes les heures **entre 8 h et 19 h** (heure de Douala) → `run_followups()`.

### Comment la relance part, selon le canal

| Canal | Relance | Pourquoi |
|---|---|---|
| **WhatsApp** | **Automatique, par modèle approuvé** | Hors fenêtre de 24 h, Meta n'autorise que les modèles approuvés |
| WhatsApp sans modèle approuvé, ou conversation en pause | Tâche pour l'utilisateur | Rien ne part sans cadre valide |
| **LinkedIn / X** | Tâche : « ✨ Rédiger la relance », copier, « Marquer comme relancé » | Pas d'API |
| **Messenger / Instagram** | Tâche | Meta interdit les relances automatiques après 24 h |

### Les modèles WhatsApp (Prospects → Relances → Modèles)
« **Créer les modèles** » soumet à Meta, via le compte WhatsApp de l'utilisateur, 4 modèles (relance 1 et 2, en français et en anglais), catégorie **marketing** :

> Bonjour {{1}}, je reviens vers vous au sujet de {{2}}. Avez-vous pu regarder ce que je vous ai envoyé ? Je reste disponible pour vos questions.
>
> Bonjour {{1}}, dernier petit message de ma part au sujet de {{2}}. Si ce n'est plus d'actualité, pas de souci. Sinon, répondez simplement ici et on reprend.

`{{1}}` = prénom, `{{2}}` = produit. Le modèle est choisi dans la langue du prospect, sinon en français. « **Actualiser** » met à jour les statuts (en attente, approuvé, refusé avec la raison).

### Relances rédigées par l'IA (LinkedIn/X)
Nouveau type de brouillon `followup` : rappel du dernier sujet sans reproche, **une** chose utile et nouvelle, question fermée pour la relance 1, **porte de sortie élégante** pour la relance 2.

---

## 6.3 Fichiers

| Brique | Fichier |
|---|---|
| Supports, étapes, planification, exécution des relances, modèles | `supabase/migrations/0007_closing_followups.sql` |
| Instructions de closing, insertion des liens, relances, modèles par défaut | `supabase/functions/_shared/prompts.ts` |
| Pilote + closing | `supabase/functions/autopilot-reply` |
| Relance rédigée | `supabase/functions/draft-message` (`kind: followup`) |
| Soumission et suivi des modèles | `supabase/functions/whatsapp-templates` |
| Envoi des modèles | `n8n/workflows/02-outbound-sender.json` |
| Exécution horaire | `n8n/workflows/04-followups.json` |
| Plateforme | Produits (Closing), Conversations (barre de closing), Prospects (Relances), Paramètres |

---

## 6.4 Tests réalisés

**Base (Postgres local) :**
- prospect arrivé sur WhatsApp → « envoyer la présentation », visible dans le contexte IA ;
- présentation envoyée → « Chaud », puis « proposer un appel » seulement après sa réponse ;
- notre message → relance à J+2 ; sa réponse → remise à zéro ;
- relance 1 sans modèle approuvé → tâche, relance 2 prévue à +5 j ;
- relance 2 avec modèle approuvé → message modèle en file, avec texte personnalisé (« Bonjour Nadine … Core HR ») et paramètres transmis à l'envoi ;
- abandon après la 2e relance → « sans réponse » ;
- appel planifié → plus aucune relance.

**Fonctions (Node) :**
- instructions de closing selon l'étape (présentation sans demande d'appel ; appel avec lien, ou créneaux sans lien) ;
- liens insérés ou ajoutés, étape enregistrée seulement si le lien est présent, marqueurs orphelins nettoyés ;
- relance n°2 avec porte de sortie ;
- modèles sans variable en début ni en fin de texte (règle Meta) ;
- envoi d'un modèle hors fenêtre de 24 h, refus d'un texte libre hors fenêtre.

**Plateforme (démo) :**
- enregistrement des supports de closing, lien non sécurisé refusé ;
- pilote : catalogue envoyé, puis demande de créneaux, puis appel planifié, puis gagné ;
- présentation insérée à la main puis étape enregistrée ;
- tâche de relance rédigée et marquée ;
- temps avancé de 3 jours ;
- modèles synchronisés ;
- mobile sans débordement.

**Non testé en conditions réelles :** la soumission des modèles à Meta et leur délai d'approbation, l'envoi réel d'un modèle, la qualité des messages de l'IA.

---

## 6.5 Points de vigilance

| Sujet | Règle |
|---|---|
| **Coût des relances WhatsApp** | Modèles marketing facturés par Meta au message, **au compte de l'utilisateur** (son moyen de paiement Meta). Au plus 2 par prospect. |
| **Qualité du numéro** | Les modèles marketing trop insistants font baisser la note de qualité. D'où : 2 relances maximum, texte sobre, porte de sortie, heures ouvrables. |
| **Opt-out marketing** | Un client peut refuser les messages marketing d'une entreprise dans WhatsApp. Meta ne les délivre plus : l'envoi échoue (statut « échec ») et le prospect finit abandonné. |
| **Fuseau horaire** | 8 h – 19 h heure de Douala pour tous en Phase 1. À adapter au pays du prospect pour les autres marchés. |
| **Rendez-vous** | « Appel planifié » est manuel. Un webhook Cal.com / Calendly pourra le cocher automatiquement plus tard. |
| **Déploiement** | `supabase functions deploy whatsapp-templates` ; activer le workflow n8n 04. |

---

## ✅ Pour valider la Partie 6

- [ ] Séquence de closing : présentation, puis appel
- [ ] Relances : 2 maximum, délais, heures, abandon
- [ ] Modèles WhatsApp et tâches pour les autres canaux

**→ Ensuite : Partie 7, le tableau de bord visuel et l'alerte immédiate (Telegram ou e-mail) quand un prospect devient chaud.**
