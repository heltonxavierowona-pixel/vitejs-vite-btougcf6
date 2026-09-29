#!/bin/sh
# Applique les migrations en attente avant le déploiement.
# Neon (via Vercel) fournit DATABASE_URL (pool de connexions) et
# DATABASE_URL_UNPOOLED (connexion directe) : les migrations exigent
# la connexion directe quand elle existe.
set -e
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx prisma migrate deploy
