# Le Closer

Plateforme SaaS de prospection IA. Chaque utilisateur décrit son produit : l'agent en déduit les cibles et les réseaux adaptés (LinkedIn, X, Facebook, Instagram), puis la conversation se conclut sur WhatsApp. L'utilisateur connecte ses propres comptes et répond à ses clients depuis la plateforme, pendant que ses clients restent sur WhatsApp, Messenger ou Instagram.

| Dossier | Contenu |
|---|---|
| `docs/` | Architecture (`00`) et une fiche par partie (`01` → `07`) |
| `src/` | Plateforme web : React + Vite + TypeScript |
| `supabase/migrations/` | Schéma Postgres multi-clients + RLS |
| `supabase/functions/` | Edge Functions : analyse produit, qualification, rédaction IA, profil relationnel, détection d'intérêt, pilote automatique, connexion WhatsApp et Facebook/Instagram |
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

Commencez par `docs/00-architecture-saas.md`.
