# Le Closer

Agent IA de prospection omnicanal (LinkedIn, X, Facebook, Instagram, WhatsApp), conçu comme un SaaS multi-tenant. Vous en êtes le premier tenant.

| Dossier | Contenu |
|---|---|
| `docs/` | Architecture (`00`) et une fiche par partie (`01` → `07`) |
| `src/` | Plateforme web : React + Vite + TypeScript |
| `supabase/migrations/` | Schéma Postgres multi-tenant + RLS |
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
