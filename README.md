# NUMERA AGENTIC

> Premier produit de la gamme **NUMERA**. Logo : reproduction vectorielle du logo NUMERA — géométrie unique dans `src/lib/numeraMark.ts`, utilisée par `src/components/Logo.tsx` (symbole + nom du produit) et par `node scripts/build-favicon.mjs` qui régénère `public/numera-mark.svg`. Couleurs du logo : bleu marine `#134b70` / `#155c88` et vert `#32bf7a` ; police du nom : Montserrat.

Plateforme SaaS de prospection IA. Chaque utilisateur décrit son produit : l'agent en déduit les cibles et les réseaux adaptés (LinkedIn, X, Facebook, Instagram), puis la conversation se conclut sur WhatsApp. L'utilisateur connecte ses propres comptes et répond à ses clients depuis la plateforme, pendant que ses clients restent sur WhatsApp, Messenger ou Instagram.

| Dossier | Contenu |
|---|---|
| `docs/` | Architecture (`00`) et une fiche par partie (`01` → `07`) |
| `src/` | Plateforme web : React + Vite + TypeScript |
| `supabase/migrations/` | Schéma Postgres multi-clients + RLS |
| `supabase/functions/` | Edge Functions : analyse produit, qualification, rédaction IA, profil relationnel, détection d'intérêt, pilote automatique, modèles WhatsApp de relance, connexion WhatsApp et Facebook/Instagram |
| `n8n/workflows/` | Workflows à importer dans n8n |
| `infra/` | n8n + Caddy (HTTPS) pour un VPS |

## Démarrer la plateforme

```bash
npm install
cp .env.example .env   # facultatif : sans .env, l'appli tourne en mode démo
npm run dev
```

## Importer les workflows n8n

n8n → *Workflows* → *Import from file* → `n8n/workflows/*.json`, puis sélectionner dans chaque nœud HTTP le credential **Supabase** (clé service_role) ou **Header Auth** (OpenRouter : `Authorization: Bearer <clé>`), et dans les nœuds Telegram le credential du bot.

## Parcours de l'utilisateur

1. **Produits** : il décrit son offre ; l'agent en déduit cibles, réseaux, ton, langues (Partie 1).
2. **Canaux** : il connecte son WhatsApp Business (coexistence), sa Page Facebook et son Instagram (Partie 1).
3. **Prospects** : file du jour LinkedIn/X qualifiée, liens WhatsApp traçables, mots-clés en commentaire (Partie 2).
4. **Conversations** : l'IA rédige, puis converse seule sur WhatsApp ; prix et contrats passent par **Validations** (Parties 3 à 5).
5. **Closing & relances** : présentation, puis appel ; 2 relances maximum, puis abandon (Partie 6).
6. **Rapports & alertes** : tableau de bord visuel ; Telegram / e-mail dès qu'un prospect devient chaud (Partie 7).

Commencez par `docs/00-architecture-saas.md`, puis `docs/01-fondations-comptes.md` §1.3 pour la mise en service.
