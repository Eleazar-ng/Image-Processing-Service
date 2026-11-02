# Image Processing Service

A backend service where authenticated users upload images, apply transformations
(resize, crop, rotate, watermark, filters, format conversion, and more), and
retrieve the results. Built with NestJS 12 (Fastify), PostgreSQL, Prisma, Sharp,
Redis, BullMQ, and Cloudflare R2.

Design documents live in [`docs/`](./docs):

- [Decision Log](./docs/DECISION_LOG.md): every decision and why
- [Architecture](./docs/ARCHITECTURE.md): components, flows, data model, API surface
- [Roadmap](./docs/ROADMAP.md): the staged delivery plan

## Prerequisites

- **Node.js 26** (see `.nvmrc`; with nvm run `nvm use`)
- **pnpm** (latest)
- **Docker** with Docker Compose

## First-time setup

The repository intentionally has no lockfile or pinned dependency versions yet.
Install current versions once, then commit the generated `pnpm-lock.yaml`:

```bash
# Runtime dependencies
pnpm add @nestjs/common @nestjs/core @nestjs/platform-fastify @nestjs/config \
  @nestjs/swagger @nestjs/terminus fastify @fastify/static nestjs-pino pino \
  pino-http reflect-metadata rxjs "zod@^4.2"

# Development dependencies
pnpm add -D @nestjs/cli @nestjs/schematics @nestjs/testing "typescript@^6" \
  @types/node vitest @vitest/coverage-v8 unplugin-swc @swc/core eslint @eslint/js \
  typescript-eslint eslint-config-prettier globals prettier husky lint-staged \
  pino-pretty
```

pnpm 10+ blocks dependency build scripts by default. If `@swc/core` is reported as
ignored, run `pnpm approve-builds` and allow it. Zod must be 4.2 or newer so
Swagger can convert schemas natively.

Then:

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL and Redis
pnpm start:dev              # API on http://localhost:3000
pnpm start:worker:dev       # worker (optional in Stage 1)
```

Check it is alive:

```bash
curl http://localhost:3000/health/live
```

Swagger UI is at <http://localhost:3000/docs> and the OpenAPI document at
<http://localhost:3000/docs-json>.

## Scripts

| Script                                         | Purpose                           |
| ---------------------------------------------- | --------------------------------- |
| `pnpm start:dev`                               | API with watch mode               |
| `pnpm start:worker:dev`                        | Worker with watch mode            |
| `pnpm build`                                   | Compile to `dist/`                |
| `pnpm start:prod` / `pnpm start:worker:prod`   | Run compiled API / worker         |
| `pnpm lint` / `pnpm format:check`              | Lint and formatting checks        |
| `pnpm typecheck`                               | TypeScript type check             |
| `pnpm test` / `pnpm test:cov`                  | Unit tests (with coverage)        |
| `pnpm test:e2e`                                | End-to-end tests                  |

## Project structure

```
src/
  main.ts              API entry point
  worker.ts            Worker entry point
  app.module.ts        API root module
  worker.module.ts     Worker root module
  app.setup.ts         Shared app configuration (prefix, versioning, pipes, Swagger)
  config/              Zod-validated environment configuration
  common/              Logging, error handling, Swagger setup
  health/              Liveness endpoint
test/                  End-to-end tests
docs/                  Decision log, architecture, roadmap
```

## Endpoints (Stage 1)

| Method | Path           | Description                     |
| ------ | -------------- | ------------------------------- |
| GET    | `/health/live` | Liveness probe (unversioned)    |

Application routes will live under `/api/v1/...`. Errors use RFC 9457
`application/problem+json`.

## Notes

- Object storage for local development is not yet decided (see the Decision Log);
  it is needed from Stage 4.
- Set `SWAGGER_ENABLED=false` in production environments.
- Docker: `docker build -t image-service .` builds one image that runs the API
  (default) or the worker (`node dist/worker.js`).
