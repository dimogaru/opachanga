FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./

# Instala dependencias descargando el binario precompilado sin compilar C++
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:20-bookworm-slim AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]