FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node
VOLUME ["/app/data"]
EXPOSE 3000
ENTRYPOINT ["./start.sh"]
