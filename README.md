# Image Processing Service

A backend service where authenticated users upload images, apply transformations
(resize, crop, rotate, watermark, filters, format conversion, and more), and
retrieve the results. Built with NestJS 12 (Fastify), PostgreSQL, Prisma 7, Sharp,
Redis, BullMQ, and Cloudflare R2.

Design documents live in [`docs/`](./docs):

- [Decision Log](./docs/DECISION_LOG.md): every decision and why
- [Architecture](./docs/ARCHITECTURE.md): components, flows, data model, API surface
- [Roadmap](./docs/ROADMAP.md): the staged delivery plan

## Prerequisites

- **Node.js 26** (see `.nvmrc`; with nvm run `nvm use`)
- **pnpm** (latest)
- **Docker** with Docker Compose (also required to run the e2e tests)

## First-time setup

The repository intentionally has no lockfile or pinned dependency versions yet.
Install current versions once, then commit the generated `pnpm-lock.yaml`:

```bash
# Runtime dependencies
pnpm add @nestjs/common @nestjs/core @nestjs/platform-fastify @nestjs/config \
  @nestjs/swagger @nestjs/terminus fastify @fastify/static nestjs-pino pino \
  pino-http reflect-metadata rxjs "zod@^4.2" "@prisma/client@7" @prisma/adapter-pg

# Development dependencies
pnpm add -D @nestjs/cli @nestjs/schematics @nestjs/testing "typescript@^6" \
  @types/node vitest @vitest/coverage-v8 unplugin-swc @swc/core eslint @eslint/js \
  typescript-eslint eslint-config-prettier globals prettier husky lint-staged \
  pino-pretty "prisma@7" dotenv tsx @testcontainers/postgresql \
  @commitlint/cli @commitlint/config-conventional
```

Notes:

- Install **`prisma@7`** and **`@prisma/client@7`** explicitly. The `latest` tag of
  the `prisma` package may point to a different major version (a Prisma 8
  pre-release at the time of writing) that lacks the commands used here. Keep the
  two on the same major version.
- pnpm 10+ blocks dependency build scripts by default. If `@swc/core`, `prisma`, or
  `@prisma/engines` are reported as ignored, run `pnpm approve-builds` and allow them.
- Zod must be 4.2 or newer so Swagger can convert schemas natively.

Then set up the environment and database:

```bash
cp .env.example .env
docker compose up -d              # PostgreSQL and Redis
pnpm db:generate                  # generate the Prisma client (src/generated, git-ignored)
pnpm db:migrate:dev --name init   # FIRST TIME ONLY: creates prisma/migrations/, commit it
pnpm start:dev                    # API on http://localhost:3000
pnpm start:worker:dev             # worker (optional until Stage 7)
```

Check it is alive and ready:

```bash
curl http://localhost:3000/health/live    # process is up
curl http://localhost:3000/health/ready   # database reachable
```

Swagger UI is at <http://localhost:3000/docs> and the OpenAPI document at
<http://localhost:3000/docs-json>.

## Database workflow

The Prisma client is generated code and is not committed. Run `pnpm db:generate`
after installing dependencies and after every change to `prisma/schema.prisma`
(CI and the Dockerfile do this automatically). After changing the schema:

```bash
pnpm db:migrate:dev --name describe_the_change   # creates and applies a migration
pnpm db:generate
```

Commit the generated files in `prisma/migrations/`. Prisma's configuration is in
`prisma.config.ts`; if your installed Prisma release scaffolds it differently
(`pnpm prisma init` shows the current shape), follow that.

## Scripts

| Script                                       | Purpose                                      |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm start:dev`                             | API with watch mode                          |
| `pnpm start:worker:dev`                      | Worker with watch mode                       |
| `pnpm build`                                 | Compile to `dist/` (run `db:generate` first) |
| `pnpm start:prod` / `pnpm start:worker:prod` | Run compiled API / worker                    |
| `pnpm lint` / `pnpm format:check`            | Lint and formatting checks                   |
| `pnpm typecheck`                             | TypeScript type check                        |
| `pnpm test` / `pnpm test:cov`                | Unit tests (with coverage)                   |
| `pnpm test:e2e`                              | End-to-end and database tests (needs Docker) |
| `pnpm db:generate`                           | Generate the Prisma client                   |
| `pnpm db:migrate:dev`                        | Create and apply a migration (development)   |
| `pnpm db:migrate:deploy`                     | Apply committed migrations                   |
| `pnpm db:migrate:status`                     | Show migration status                        |
| `pnpm db:seed`                               | Run the seed runner                          |

## Project structure

```
prisma/
  schema.prisma        Database schema
  migrations/          Committed SQL migrations
  seed.ts              Seed runner (admin seeder arrives in Stage 3)
prisma.config.ts       Prisma configuration (connection URL, migrations, seed)
src/
  main.ts              API entry point
  worker.ts            Worker entry point
  app.module.ts        API root module
  worker.module.ts     Worker root module
  app.setup.ts         Shared app configuration (prefix, versioning, pipes, Swagger)
  config/              Zod-validated environment configuration
  common/              Logging, error handling, Swagger setup
  health/              Liveness and readiness endpoints
  prisma/              PrismaService and PrismaModule
  generated/prisma/    Generated Prisma client (git-ignored)
test/
  support/             Testcontainers global setup and database helpers
  *.e2e-spec.ts        End-to-end and database tests
docs/                  Decision log, architecture, roadmap
```

## Endpoints (Stage 2)

| Method | Path            | Description                                  |
| ------ | --------------- | -------------------------------------------- |
| GET    | `/health/live`  | Liveness probe (unversioned)                 |
| GET    | `/health/ready` | Readiness probe: checks the database (unversioned) |

Application routes will live under `/api/v1/...`. Errors use RFC 9457
`application/problem+json`.

## Notes

- Object storage for local development is not yet decided (see the Decision Log);
  it is needed from Stage 4.
- Commits must follow Conventional Commits (enforced by commitlint through a Husky hook).
- Set `SWAGGER_ENABLED=false` in production environments.
- Docker: `docker build -t image-service .` builds one image that runs the API
  (default) or the worker (`node dist/worker.js`).
