FROM node:lts-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# build
FROM node:lts-alpine AS build
WORKDIR /app

RUN corepack enable

# Dependências nativas (ex.: better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm run build
RUN pnpm prune --prod

# runner
FROM node:lts-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# usuário não-root
RUN useradd -m appuser
USER appuser

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/prisma ./prisma

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]