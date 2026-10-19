# --- Etapa 1: Builder ---
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Usamos --omit=dev para producción en versiones modernas de npm
RUN npm ci --omit=dev --no-audit --no-fund

# --- Etapa 2: Runner ---
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Copiamos las dependencias compiladas y el código fuente
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Permisos para directorio de datos y script de inicio
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x start.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]
