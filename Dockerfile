# 1. Instalação de dependências
FROM node:lts-alpine AS deps
WORKDIR /app

# Copia package.json e package-lock.json (se existir)
COPY package.json package-lock.json* ./

# Instala dependências usando npm
# Usamos 'npm install' em vez de 'ci' para funcionar mesmo sem lockfile
RUN npm install

# 2. Build da aplicação
FROM node:lts-alpine AS build
WORKDIR /app

# Instala dependências nativas necessárias para compilação no Alpine
# RUN apk add --no-cache python3 make g++

# Copia as dependências baixadas na etapa anterior
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Se estiver usando Prisma, descomente a linha abaixo:
# RUN npx prisma generate

# Roda o build da aplicação
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

# Remove dependências de desenvolvimento para limpar a imagem
RUN npm prune --production

# 3. Imagem final (Runner)
FROM node:lts-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Cria usuário não-root (Padrão Alpine: addgroup/adduser)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copia os arquivos gerados no build com as permissões corretas
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/.output ./.output
COPY --from=build --chown=appuser:appgroup /app/package.json ./package.json

# Se tiver pasta prisma, descomente:
# COPY --from=build --chown=appuser:appgroup /app/prisma ./prisma

USER appuser

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
