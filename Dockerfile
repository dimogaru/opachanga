FROM node:20-bookworm-slim

# Instalar dependencias necesarias para compilar better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias e instalarlas
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el resto del código
COPY . .

# Crear directorio de datos para SQLite y ajustar permisos
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

ENTRYPOINT ["./start.sh"]
