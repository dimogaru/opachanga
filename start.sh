#!/bin/sh
set -e

# 1. Verificar e instalar dependencias de Node.js si express no existe
if [ ! -d "node_modules/express" ]; then
    echo "Instalando dependencias de Node.js en tiempo de ejecucion..."
    npm install --no-audit --no-fund
fi

# 2. Crear la carpeta de base de datos por defecto dentro de /app/data
mkdir -p /app/data

# 3. Si DB_PATH está definido, asegurar que su directorio exista
if [ -n "$DB_PATH" ]; then
    DB_DIR=$(dirname "$DB_PATH")
    mkdir -p "$DB_DIR" 2>/dev/null || true
fi

# 4. Ejecutar el servidor Node.js
exec node server.js
