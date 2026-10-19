FROM node:20-bookworm-slim

# Instalar herramientas del sistema necesarias para la compilación de C++ (sqlite3, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar todo el proyecto al contenedor
COPY . .

# Crear carpeta de persistencia de datos y asignar permisos al usuario node
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x start.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./start.sh"]
