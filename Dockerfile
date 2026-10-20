FROM node:20-bookworm-slim

# Instalar herramientas para compilar dependencias nativas de SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Instalar dependencias compilando SQLite para el entorno Linux
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Crear la carpeta de datos para SQLite y asignar permisos al usuario node
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
