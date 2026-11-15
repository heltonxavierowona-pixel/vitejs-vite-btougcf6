# ============================================================
#  API Numera — build multi-stage, image finale légère
# ============================================================

FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL est requis par le moteur Prisma sur Alpine.
RUN apk add --no-cache openssl

# Dépendances d'abord : le cache Docker évite de tout
# réinstaller à chaque modification du code.
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

# ------------------------------------------------------------

FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl dumb-init

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/
# prisma (CLI) est une dépendance de production : il sert à
# `prisma migrate deploy` au démarrage.
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=builder /app/dist ./dist

# On ne tourne pas en root.
RUN addgroup -g 1001 -S nodejs \
 && adduser -S nestjs -u 1001 \
 && chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# dumb-init gère correctement les signaux (arrêt propre).
# Les migrations en attente sont appliquées avant le démarrage.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
