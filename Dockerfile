FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY shared shared
COPY api api
COPY web web
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    QLOO_CACHE_DIR=/data/qloo
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts --workspace @whitespace/shared --workspace @whitespace/api \
    && npm cache clean --force \
    && mkdir -p /data/qloo \
    && chown -R node:node /data
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/web/dist web/dist
COPY api/fixtures api/fixtures
USER node
EXPOSE 8080
CMD ["node", "api/dist/index.js"]
