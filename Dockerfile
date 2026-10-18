FROM node:20-bookworm-slim

# Dependencias del sistema para compilar dependencias nativas (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Usar npm install en lugar de npm ci para evitar cierres abruptos
RUN npm install --omit=dev --no-audit --no-fund

# Copiar el código fuente
COPY . .

# Crear directorio para la base de datos SQLite y asignar permisos
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]