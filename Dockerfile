FROM node:20-bookworm-slim

# Instalar dependencias para módulos nativos (bcrypt, better-sqlite3) y activar pnpm
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package*.json ./

# pnpm config set policy-config-version 1 bypasses build script restrictions for C++ packages
RUN pnpm config set config-field-name-is-deprecated false \
    && pnpm install --unsafe-perm || pnpm install --config.confirmModulesPurge=false

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app && chmod +x start.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]
