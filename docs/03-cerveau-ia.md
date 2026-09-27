# Partie 3 — Cerveau IA

Objectif : l'IA écrit **au nom de chaque utilisateur**, dans **la langue du prospect**, avec **le ton qui lui correspond**, en s'appuyant uniquement sur ce que l'utilisateur a déclaré sur son produit, et elle **se souvient** de chaque prospect.

---

## 3.1 Architecture

```
               ┌────────────── CONTEXTE (prospect_ai_context) ───────────────┐
               │ Voix de marque   Produit + connaissances   Prospect          │
               │ Profil relationnel                  20 derniers messages     │
               └──────────────────────────────┬──────────────────────────────┘
                                              ▼
  Bouton « ✨ Note d'invitation / Premier message » (Prospects)  ─┐
  Bouton « ✨ Suggérer » (Conversations)                          ├─► draft-message ─► 2-3 variantes
                                                                  ┘    (modèle « rédaction »)   │
                                                                                               ▼
                                              l'utilisateur choisit, modifie, envoie ◄── ai_drafts

  Message reçu ─► Database Webhook ─► n8n 03 (attente 20 s) ─► update-profile ─► prospect_profiles
                                                              (modèle « rapide »)
  Chaque appel IA ─► ai_usage (tokens + coût, par organisation)
```

| Brique | Fichier |
|---|---|
| Prompts (fonctions pures, testées) | `supabase/functions/_shared/prompts.ts` |
| Appel LLM + traçage des coûts | `supabase/functions/_shared/llm.ts` |
| Rédaction | `supabase/functions/draft-message` |
| Profil relationnel | `supabase/functions/update-profile` + `n8n/workflows/03-intent-profile.json` (depuis la Partie 4, ce workflow classe aussi l'intention) |
| Base | `supabase/migrations/0004_ai_brain.sql` |
| Plateforme | Prospects (file du jour), Conversations (suggestion + profil), Produits (connaissances), Paramètres (voix de marque) |

**Choix de conception :** en Partie 3, l'IA **propose** et l'utilisateur **envoie**. La conversation autonome sur WhatsApp arrive en Partie 5, sur cette même base, avec la validation des sujets sensibles.

---

## 3.2 Les trois sources de vérité

| Source | Réglée par | Rôle |
|---|---|---|
| **Voix de marque** (Paramètres) | L'utilisateur, une fois | Prénom, signature, tu/vous par défaut, émojis, phrases interdites |
| **Connaissances produit** (Produits) | L'utilisateur, par produit | Seules affirmations autorisées : arguments, FAQ, délais, livraison, conditions, prix |
| **Profil relationnel** (automatique) | L'IA, à chaque message reçu | Comment parler à CE prospect |

Sans connaissances produit, l'IA ne peut rien affirmer de précis : elle pose des questions. C'est le principal garde-fou contre les inventions.

---

## 3.3 Ton adapté au prospect

Le prompt de rédaction applique ces règles, dans l'ordre :
1. **Point de départ** : la voix de marque (ex. vouvoiement, émojis autorisés).
2. **Premier contact avec un dirigeant ou un profil senior** : vouvoiement.
3. **Miroir** : si le prospect tutoie ou écrit familièrement, on peut le tutoyer, puis on ne change plus. On imite sa longueur de message et son usage des émojis.
4. **Ton du produit** : celui déduit par l'analyse produit (Partie 1).

Le profil relationnel stocke ce qui a été constaté : `formality` (tu/vous), `style` (longueur, émojis, registre), `tone` (3 mots).

## 3.4 Multilingue

- L'IA répond dans la langue **des derniers messages** du prospect, sinon celle de son profil.
- **Mélanges fréquents au Cameroun** (français/anglais/pidgin/camfranglais) : réponse dans la langue dominante, en langage simple, **sans imiter l'argot** (risque de maladresse).
- Les noms de produits ne sont jamais traduits.
- La langue constatée en conversation met à jour `prospects.language`.

## 3.5 Formats par canal

| Canal | Type | Limite | Règles clés |
|---|---|---|---|
| LinkedIn | Note d'invitation | 200 car. | Aucune vente, aucun lien, un fait du profil |
| LinkedIn | Premier message (après acceptation) | 600 car. | Pas de lien ni de demande d'appel, une question ouverte |
| X | Message privé | 280 car. | Direct, pas de lien |
| WhatsApp | Réponse | 500 car. | 1 à 3 phrases, comme un humain sur son téléphone |
| Messenger / Instagram | Réponse | 500 / 400 car. | Conversationnel |

Une variante trop longue est **coupée en fin de phrase** plutôt que rejetée.

## 3.6 Prompts

### Rédaction (`buildDraftSystem`)
Structure : identité (au nom de qui) → format du canal → langue → ton → contenu (un fait réel, connaissances uniquement, une idée, phrases interdites) → sujets sensibles → 2 ou 3 variantes d'angles différents → JSON.

Sortie :
```json
{"language": "fr", "formality": "vous",
 "variants": [{"text": "…", "angle": "question"}],
 "sensitive": {"is": true, "topics": ["prix"]},
 "rationale": "Vouvoiement : DRH, premier contact."}
```

### Profil relationnel (`PROFILE_SYSTEM`)
Mise à jour **cumulative** : garde le passé sauf contradiction, n'ajoute que ce qui a été dit, **aucune donnée sensible** (santé, religion, origine, opinions, vie privée, finances personnelles). Champs : langue, tu/vous, style, ton, intérêts, problèmes, objections, préférences, signaux d'achat, résumé (400 caractères).

### Sujets sensibles
Prix, remise, devis, contrat, paiement, remboursement, engagement juridique. En Partie 3, ils sont **signalés** dans la suggestion. En Partie 5, ils bloqueront l'envoi automatique jusqu'à ta validation.

---

## 3.7 Coûts IA (SaaS)

| Usage | Modèle par défaut | Coût indicatif |
|---|---|---|
| Profil relationnel (chaque rafale de messages) | rapide (`OPENROUTER_MODEL`) | ~0,003 $ |
| Rédaction (2-3 variantes) | rédaction (`OPENROUTER_WRITE_MODEL`) | ~0,01 à 0,015 $ |
| Analyse produit | rapide | ~0,01 $ |
| Qualification d'un import de 20 profils | rapide | ~0,04 $ |

Ordres de grandeur calculés sur les tarifs publics par million de tokens des modèles par défaut ; ils changent avec les modèles choisis.

Les deux modèles sont configurables. **Chaque appel est enregistré dans `ai_usage`** (tokens + coût réel renvoyé par OpenRouter) par organisation : c'est la base pour fixer les quotas des formules d'abonnement et l'afficher dans les Rapports (Partie 7).

Le workflow 03 **attend 20 s** avant de mettre à jour le profil : un prospect qui envoie 4 messages d'affilée ne déclenche qu'une mise à jour utile (les suivantes sont ignorées car déjà prises en compte).

---

## 3.8 Tests réalisés

- **Base** (Postgres local) : contexte complet d'un prospect (produit, connaissances, profil, messages) ; mise à jour du profil avec versions ; consommation IA enregistrée ; **un autre client ne voit ni le contexte ni la consommation**.
- **Prompts** (Node) : règles de canal et phrases interdites présentes ; découpe propre en fin de phrase ; valeurs invalides du modèle corrigées (tu/vous, longueur, résumé tronqué).
- **Workflow 03** : filtre des messages reçus uniquement.
- **Plateforme (mode démo)** : suggestion de réponse avec alerte « prix », variante insérée dans le champ, profil relationnel affiché ; note d'invitation depuis la file du jour ; voix de marque et connaissances enregistrées ; affichage mobile correct.

**Non testé en conditions réelles :** les appels à OpenRouter (qualité réelle des textes). Le mode démo utilise des modèles de phrases, pas l'IA.

---

## 3.9 Points de vigilance

| Sujet | Règle |
|---|---|
| **Inventions** | L'IA n'affirme que les connaissances produit. Encourage chaque utilisateur à les remplir (l'écran Produits le rappelle). |
| **Notes d'invitation LinkedIn** | Les comptes gratuits ont un nombre limité de notes personnalisées par mois : les réserver aux meilleurs prospects (score élevé). |
| **Transparence** | Les messages partent au nom de l'utilisateur. Il reste responsable de ce qu'il envoie : en Partie 3, rien ne part sans son clic. |
| **Données personnelles** | Profil relationnel = données professionnelles uniquement, supprimées avec le prospect. |
| **Coûts** | Suivre `ai_usage` dès la bêta pour calibrer les prix. |

---

## ✅ Pour valider la Partie 3

- [ ] Rédaction assistée (invitation, premier message, suggestion de réponse)
- [ ] Règles de ton et de langue
- [ ] Profil relationnel automatique
- [ ] Voix de marque + connaissances produit comme garde-fous

**→ Ensuite : Partie 4, détection d'intérêt et bascule vers WhatsApp.**
