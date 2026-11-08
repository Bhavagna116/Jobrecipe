# Frontend static SPA. Build once, then serve dist with server.mjs.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the bundle at build time. Railway injects service variables as
# build args when declared with ARG, so the production API origin is preserved.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN echo "Building frontend with VITE_API_URL=$VITE_API_URL"
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Re-declare for the runtime stage: server.mjs uses it to allow the API origin
# in the Content-Security-Policy connect-src.
ARG VITE_API_URL=/api
ENV NODE_ENV=production
ENV VITE_API_URL=$VITE_API_URL

COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs

EXPOSE 4173
CMD ["node", "server.mjs"]
