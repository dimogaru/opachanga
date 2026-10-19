FROM node:20-bookworm-slim

# Instalar herramientas de compilación y pnpm de forma global
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package*.json ./

# Usar pnpm para instalar dependencias (evita el fallo 'Exit handler never called')
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app && chmod +x start.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]
