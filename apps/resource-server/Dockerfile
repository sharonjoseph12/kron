# KRON Resource Server — production build (testnet merchant)
#
#   docker build -f apps/resource-server/Dockerfile -t kron-resource-server .
#   docker run --env-file apps/resource-server/.env -p 9100:9100 kron-resource-server

FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

# Build workspace deps (shared + x402) before the resource server itself
RUN pnpm --filter @kron/shared --filter @kron/x402 build
RUN pnpm --filter @kron/resource-server build

ENV NODE_ENV=production
EXPOSE 9100

# MERCHANT_MNEMONIC must be a funded testnet account (see docker-compose.prod.yml)
CMD ["sh", "-c", "node apps/resource-server/dist/server.js"]
