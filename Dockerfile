FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Activar pnpm nativo de Node.js
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package*.json ./

# pnpm instala en segundos sin bloquear memoria ni fallar en la red DNS
RUN pnpm install --prod --ignore-scripts

FROM node:20-bookworm-slim AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]