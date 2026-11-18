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
  pino-http reflect-metadata rxjs "zod@^4.2" "@prisma/client@7" @prisma/adapter-pg \
  @nestjs/jwt @node-rs/argon2 \
  @aws-sdk/client-s3 @fastify/multipart sharp

# Development dependencies
pnpm add -D @nestjs/cli @nestjs/schematics @nestjs/testing "typescript@^6" \
  @types/node vitest @vitest/coverage-v8 unplugin-swc @swc/core eslint @eslint/js \
  typescript-eslint eslint-config-prettier globals prettier husky lint-staged \
  pino-pretty "prisma@7" dotenv tsx @testcontainers/postgresql \
  @commitlint/cli @commitlint/config-conventional testcontainers
```

Notes:

- Install **`prisma@7`** and **`@prisma/client@7`** explicitly. The `latest` tag of
  the `prisma` package may point to a different major version (a Prisma 8
  pre-release at the time of writing) that lacks the commands used here. Keep the
  two on the same major version.
- pnpm 10+ blocks dependency build scripts by default. If `@swc/core`, `prisma`,
  `@prisma/engines`, or `sharp` are reported as ignored, run `pnpm approve-builds` and allow them.
- Zod must be 4.2 or newer so Swagger can convert schemas natively.

Then set up the environment and database:

```bash
cp .env.example .env              # then set JWT_ACCESS_SECRET (see Authentication)
docker compose up -d              # PostgreSQL, Redis, and S3-compatible storage
pnpm db:generate                  # generate the Prisma client (src/generated, git-ignored)
pnpm db:migrate:dev --name init   # FIRST TIME ONLY: creates prisma/migrations/, commit it
pnpm start:dev                    # API on http://localhost:3000
pnpm start:worker:dev             # worker (optional until Stage 7)
```

Check it is alive and ready:

```bash
curl http://localhost:3000/health/live    # process is up
curl http://localhost:3000/health/ready   # database and storage reachable
```

Swagger UI is at <http://localhost:3000/docs> and the OpenAPI document at
<http://localhost:3000/docs-json>.

## Authentication

- Set `JWT_ACCESS_SECRET` in `.env` to a random value of at least 32 characters
  (`openssl rand -base64 48`). The app refuses to start without it.
- Access tokens last 15 minutes and refresh tokens 7 days
  (`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`).
- Every route requires `Authorization: Bearer <access token>` unless it is marked
  `@Public()`. Health probes and the auth routes (except `GET /auth/me`) are public.
- Admins cannot be created through the API. Create the first one with the seed
  script, passing credentials through the environment:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-strong-password-12+' pnpm db:seed
```

  Re-running it is safe: an existing admin is left alone and its password is never reset.

Try it:

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-password-123"}'
```

## Object storage

Originals are stored in an S3-compatible bucket: Cloudflare R2 in production and a
local SeaweedFS container (from `docker-compose.yml`) in development and tests. The
`STORAGE_*` settings in `.env.example` already point at the local container, which
creates the `images` bucket on first start.

To use Cloudflare R2, create a bucket and an API token, then set
`STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`,
your bucket name, and the token's access key and secret.

Upload an image (replace `$TOKEN` with an access token from login):

```bash
curl -X POST http://localhost:3000/api/v1/images \
  -H "authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"
```

Accepted: JPEG, PNG, WebP, AVIF, GIF, and TIFF, up to 10 MiB and 50 megapixels. The
file is validated by its real content, not its name or declared type.

### Checking that storage is reachable

```bash
pnpm storage:check                  # settings, network, HTTP, credentials, write/read/delete
pnpm storage:check --create-bucket  # also create the bucket if it is missing
pnpm storage:check --timeout=15000  # allow slower responses (milliseconds per step)
```

The script uses the same `STORAGE_*` settings as the app, stops at the first failing
step, and prints what to try next. It exits with code 1 on failure, so it can also gate
a CI step or a deploy. Without the project installed, a quick manual check is:

```bash
docker compose ps storage                 # is the container up?
docker compose logs --tail 50 storage     # why not?
nc -zv localhost 8333                     # is the port open?
curl -i http://localhost:8333             # any HTTP answer (even 403) means it is reachable
```

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
| `pnpm storage:check`                         | Check that object storage is reachable       |

## Project structure

```
prisma/
  schema.prisma        Database schema
  migrations/          Committed SQL migrations
  seed.ts              Seed runner
  seeders/             Individual seeders (admin user)
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
  storage/             S3-compatible storage service (R2 and emulators)
  images/              Upload: validation, filename and key handling, endpoint
  auth/                Registration, login, tokens, guards, decorators
  users/               User lookup and creation
  prisma/              PrismaService and PrismaModule
  generated/prisma/    Generated Prisma client (git-ignored)
scripts/
  check-storage.ts     Storage reachability check (pnpm storage:check)
test/
  support/             Testcontainers global setup, database, storage, and multipart helpers
  *.e2e-spec.ts        End-to-end and database tests
docs/                  Decision log, architecture, roadmap
```

## Endpoints (Stage 4)

| Method | Path                    | Auth   | Description                                      |
| ------ | ----------------------- | ------ | ------------------------------------------------ |
| GET    | `/health/live`          | Public | Liveness probe (unversioned)                     |
| GET    | `/health/ready`         | Public | Readiness probe: database and storage            |
| POST   | `/api/v1/auth/register` | Public | Create an account and sign in                    |
| POST   | `/api/v1/auth/login`    | Public | Sign in                                          |
| POST   | `/api/v1/auth/refresh`  | Public | Rotate the refresh token, get a new access token |
| POST   | `/api/v1/auth/logout`   | Public | End the session that owns a refresh token        |
| GET    | `/api/v1/auth/me`       | Bearer | The signed-in user                               |
| POST   | `/api/v1/images`        | Bearer | Upload an image (multipart, field `file`)        |

Errors use RFC 9457 `application/problem+json` with a stable `errorCode`.

## Notes

- Compose and the e2e tests use the `chrislusf/seaweedfs:latest` image; pin a tested
  version once you have one.
- Commits must follow Conventional Commits (enforced by commitlint through a Husky hook).
- Set `SWAGGER_ENABLED=false` in production environments.
- Docker: `docker build -t image-service .` builds one image that runs the API
  (default) or the worker (`node dist/worker.js`).
