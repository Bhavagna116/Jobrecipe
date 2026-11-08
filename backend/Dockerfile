# Backend API image. Using a Dockerfile instead of Nixpacks keeps builds
# independent of Nixpacks' pinned nixpkgs archive (which can fail to download).
FROM node:22-bookworm-slim

# Prisma needs OpenSSL at generate time and runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Install dependencies first. The package.json postinstall runs `prisma generate`,
# so the schema must be present in this layer.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Application source.
COPY . .

EXPOSE 5000
CMD ["node", "src/index.js"]
