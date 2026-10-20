FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

# La clave está en --ignore-scripts: deshabilita la compilación C++ por completo
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]