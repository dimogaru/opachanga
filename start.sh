#!/bin/sh
set -e

# Crear la carpeta de base de datos por defecto dentro de /app/data
mkdir -p /app/data

# Si DB_PATH está definido, asegurar que su directorio exista
if [ -n "$DB_PATH" ]; then
    DB_DIR=$(dirname "$DB_PATH")
    mkdir -p "$DB_DIR" 2>/dev/null || true
fi

# Ejecutar el servidor Node.js
exec node server.js
