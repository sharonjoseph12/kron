# KRON API — production build
# Workspace monorepo: installs all packages, builds required TS deps,
# generates the Prisma client, compiles the API, then runs it.
#
#   docker build -f apps/api/Dockerfile -t kron-api .
#   docker run --env-file apps/api/.env -p 8787:8787 kron-api

FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable

# Copy the whole workspace (node_modules/dist/.env are excluded via .dockerignore)
COPY . .

# Install with the frozen lockfile (all workspace packages present)
RUN pnpm install --frozen-lockfile

# Build workspace deps first (their dist outputs are imported by the API at runtime)
RUN pnpm --filter @kron/shared --filter @kron/x402 --filter @kron/policy-engine build

# Generate the Prisma client and compile the API
RUN pnpm --filter @kron/api prisma:generate
RUN pnpm --filter @kron/api build

ENV NODE_ENV=production
EXPOSE 8787

# On boot: push the schema to the DB, seed idempotently, then start.
# DATABASE_URL must point to a writable location (see docker-compose.prod.yml).
CMD ["sh", "-c", "pnpm --filter @kron/api prisma:deploy && pnpm --filter @kron/api prisma:seed && node apps/api/dist/server.js"]
