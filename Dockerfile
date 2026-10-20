FROM oven/bun:1 AS builder

WORKDIR /app

COPY package*.json ./

# Bun instala todas las dependencias JS en 2 segundos sin agotar la memoria RAM
RUN bun install --production --no-save

FROM node:20-bookworm-slim AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]