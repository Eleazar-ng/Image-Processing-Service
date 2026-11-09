# syntax=docker/dockerfile:1
ARG NODE_VERSION=26

# --- base: Node plus pnpm (Node 25+ no longer bundles Corepack) -------------
FROM node:${NODE_VERSION}-slim AS base
# Pin this to the pnpm version you use locally (see README) for reproducible builds.
ARG PNPM_VERSION=latest
ENV HUSKY=0
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /app

# --- deps: all dependencies, used for the build ------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# --- build: generate the Prisma client, then compile TypeScript --------------
FROM deps AS build
COPY . .
# Prisma loads its config (which reads DATABASE_URL) even to generate the
# client; a placeholder is enough because nothing connects.
RUN DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder pnpm db:generate
RUN pnpm build

# --- prod-deps: production dependencies only ---------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# --- runtime: minimal image; run as API or worker ----------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
# API by default. Run the worker with: node dist/worker.js
CMD ["node", "dist/main.js"]
