FROM node:22-bookworm-slim AS node-base
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM node-base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build \
    && cp -r dict dist/dict \
    && npm prune --omit=dev

FROM node-base AS tools
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma/
RUN npm run db:generate
COPY . .
RUN npm run build && cp -r dict dist/dict

FROM node-base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/plugin-packages ./plugin-packages
RUN mkdir -p /app/cache_data /app/backups /app/logs /app/public /app/exports/static-site /app/static-publish-requests /app/plugin-staging \
    && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["npm", "start"]
