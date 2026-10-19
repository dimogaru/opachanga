FROM node:20-bookworm-slim

# Instalar dependencias del sistema requeridas para la compilación de módulos nativos (sqlite3, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar TODAS las dependencias sin omitir nada
RUN npm install --no-audit --no-fund

# Copiar el código fuente
COPY . .

# Preparar directorio de datos y dar permisos
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x start.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]
