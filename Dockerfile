FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 incluye un módulo nativo; estos paquetes solo se necesitan al compilar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node start.sh ./start.sh
RUN mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000
ENTRYPOINT ["./start.sh"]
