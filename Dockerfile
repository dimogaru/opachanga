FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --production --prefer-offline --no-audit --no-fund

FROM node:20-bookworm-slim AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

ENTRYPOINT ["./start.sh"]
