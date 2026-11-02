# Decision Log: Image Processing Service

This is the running reference for every feature and implementation decision made on the project. Update it whenever a decision is made or changed. Never delete an entry; mark it **Superseded** and link the replacement.

- **Status values:** Accepted, Superseded, Deferred
- **Date format:** YYYY-MM-DD

---

## 1. Stack

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-001 | **NestJS 12** on the **Fastify** adapter (v12 chosen over v11 on 2026-11-01 after its release) | Express adapter, NestJS 11 | Accepted | 2026-11-01 |
| D-002 | **TypeScript (strict mode)** with **ESLint + Prettier** (kept after reviewing Nest 12's oxlint default; type-aware rules such as `no-floating-promises` matter for async and queue code). See D-036 for the TypeScript version. | oxlint | Accepted | 2026-11-01 |
| D-003 | **pnpm** as the package manager | npm, yarn | Accepted | 2026-11-01 |
| D-004 | **PostgreSQL** as the primary database | MongoDB | Accepted | 2026-11-01 |
| D-005 | **Prisma** as the ORM | Drizzle (to be tried on a later project), TypeORM | Accepted | 2026-11-01 |
| D-006 | **Sharp** (libvips) for image processing | Jimp, external services (imgproxy, Thumbor) | Accepted | 2026-11-01 |

## 2. Storage and processing

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-007 | **Cloudflare R2** for object storage, accessed through the S3-compatible API (`@aws-sdk/client-s3`). *Amended in Stage 1:* MinIO is no longer viable as the local stand-in (its community repository was archived in April 2026 and it stopped publishing Docker images in October 2025); the replacement is pending, see D-043. | AWS S3, Google Cloud Storage | Accepted (local stand-in amended) | 2026-11-01 |
| D-008 | **Uploads go through the API** first (server validates, then stores). Presigned direct-to-storage uploads are added later. | Presigned uploads from the start | Accepted | 2026-11-01 |
| D-009 | **Hybrid transformation processing**: cheap operations run inline, heavy ones are queued. Must be efficient and reliable. | Fully synchronous, fully asynchronous | Accepted | 2026-11-01 |
| D-010 | **Redis** is shared infrastructure for the queue backend, cache lookups and locks, and rate-limit counters | In-memory only (breaks with multiple instances) | Accepted | 2026-11-01 |
| D-011 | **BullMQ** as the job queue | RabbitMQ, Kafka | Accepted | 2026-11-01 |

## 3. Authentication, limits, caching, API style

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-012 | **Short-lived access JWT plus rotating refresh token.** Refresh tokens are stored hashed and are revocable (with reuse detection through a token family). | Single long-lived JWT | Accepted | 2026-11-01 |
| D-013 | **Argon2id** for password hashing | bcrypt | Accepted | 2026-11-01 |
| D-014 | **Email verification and password reset are deferred** to a later stage | | Deferred | 2026-11-01 |
| D-015 | **Rate limiting** with `@nestjs/throttler` on Redis storage. Per-user limits on authenticated routes, per-IP on unauthenticated routes, stricter tiers on transformation endpoints. | In-memory limiting | Accepted | 2026-11-01 |
| D-016 | **Layered caching**: derived images persisted in R2 under a deterministic key (hash of source image plus normalized operation parameters); Redis for lookup and short-lived locks that prevent duplicate concurrent work; `Cache-Control` and `ETag` headers. A CDN is deferred. | | Accepted | 2026-11-01 |
| D-017 | **Transformation API offers both styles**, in phases: `POST /images/:id/transform` first, then `GET` with a small set of safe query parameters later | Only one of the two | Accepted | 2026-11-01 |

## 4. Structure and engineering practice

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-018 | **Single repository, modular monolith** with two entry points: an API app and a worker app sharing the same modules | Separate services or repositories | Accepted | 2026-11-01 |
| D-019 | **Validation uses both class-validator and Zod, with a clear split.** class-validator for HTTP DTOs (request bodies, query, params). Zod for environment/config validation and for transformation operation and queue job payload schemas. | One library only | **Superseded by D-034** | 2026-11-01 |
| D-020 | **Jest** with unit tests plus e2e/integration tests against real services through **Testcontainers** | Vitest, mock-only testing | **Superseded by D-035** (runner changed; Testcontainers approach retained) | 2026-11-01 |
| D-021 | **Docker and Docker Compose** locally (PostgreSQL, Redis; object storage pending, see D-043). **GitHub Actions** for CI. | Other CI platforms | Accepted | 2026-11-01 |
| D-022 | **OpenAPI/Swagger** documentation through `@nestjs/swagger` | | Accepted | 2026-11-01 |
| D-023 | **`nestjs-pino`** structured logging, correlation IDs, and `@nestjs/terminus` health checks. OpenTelemetry (metrics and tracing) is deferred. | | Accepted | 2026-11-01 |
| D-024 | **No hosting planned yet.** Design for portability and keep services stateless where possible so they can scale horizontally later. | | Accepted | 2026-11-01 |

## 5. Data and behavior rules

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-025 | **cuid** identifiers for all models | UUID, auto-increment integers | Accepted | 2026-11-01 |
| D-026 | **Maximum upload size is 10 MB.** Accepted input formats: JPEG, PNG, WebP, AVIF, GIF, TIFF. SVG and HEIC/HEIF are excluded in v1. | | Accepted | 2026-11-01 |
| D-027 | **Upload validation inspects real file content** (through Sharp metadata), not the extension or `Content-Type` header. A pixel-count ceiling of about 50 megapixels guards against decompression bombs. Animated GIF/WebP inputs use the first frame only in v1. | | Accepted | 2026-11-01 |
| D-028 | **Soft delete** (`deletedAt`) with later cleanup, including removal of files from R2 | Hard delete | Accepted | 2026-11-01 |
| D-029 | **Always auto-orient** using EXIF rotation. **Originals stay untouched** in R2. **Metadata (including GPS) is stripped from derived images** by default. Raw EXIF is not exposed in API metadata responses. | | Accepted | 2026-11-01 |
| D-030 | **Hybrid routing rule (starting point).** Run inline when the source is small (about 2 MB or less), the operation chain is short (about 3 operations or fewer), and the output is not a slow encoder such as AVIF. Otherwise queue. Cap concurrent inline Sharp operations; overflow goes to the queue. All thresholds are configurable through environment variables and tuned by benchmarking in Stages 6 and 7. | | Accepted | 2026-11-01 |
| D-031 | **Visibility and roles.** Images are private to their owner. Admins can view all images. A `role` field on User (`USER` or `ADMIN`). Admin accounts are created **only through a seed script**, never through public registration. Admin capabilities are view and soft-delete (no transform, no impersonation), on separate `/admin/*` routes, with admin actions logged. | Loosening the normal endpoints for admin access | Accepted | 2026-11-01 |

> **To confirm:** the admin capabilities, route style, and logging in D-031 came from Claude's recommendation, which was accepted as a group. The seed-script approach was stated explicitly. Raise any correction before Stage 3.

---

## 5b. Stage 1 decisions (scaffolding and tooling)

Made on 2026-11-01 after NestJS 12 (released 2026-08-27) and Node 26 LTS changed the landscape.

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-032 | **Node.js 26** (Active LTS since 2026-10-28), pinned through `.nvmrc` and `engines`. Fall back to Node 24 if a native dependency (Sharp, Argon2) causes trouble. | Node 24 (Maintenance LTS) | Accepted | 2026-11-01 |
| D-033 | **ESM** for our own code (`"type": "module"`, `nodenext`); relative imports carry `.js` extensions | CommonJS | Accepted | 2026-11-01 |
| D-034 | **Zod everywhere** through Nest 12's Standard Schema support (`StandardSchemaValidationPipe`, `schema` option on route decorators), dropping class-validator. Swagger converts Zod 4.2+ natively; the spike question was settled from the official docs and is exercised by an e2e test of `/docs-json`. Supersedes D-019. | Keep the class-validator/Zod split | Accepted | 2026-11-01 |
| D-035 | **Vitest** as the test runner (with `unplugin-swc` for decorator metadata). Testcontainers for integration tests is introduced in Stage 2, when there is a database to test against. Supersedes D-020's runner. | Jest | Accepted | 2026-11-01 |
| D-036 | **TypeScript 6** (required as a peer by the Nest 12 schematics). TypeScript 7 is not usable with the Nest CLI yet. | TypeScript 5.x | Accepted | 2026-11-01 |
| D-037 | **Single `src`, two entry points** (`main.ts`, `worker.ts`); `tsconfig.build.json` sets `rootDir` to `src` so output is `dist/main.js` and `dist/worker.js` | Nest monorepo mode | Accepted | 2026-11-01 |
| D-038 | **URI versioning** with global prefix: routes under `/api/v1/...`. Liveness is unversioned at `GET /health/live` for probes. Readiness (`/health/ready`) is added as dependencies arrive. | Header versioning, none | Accepted | 2026-11-01 |
| D-039 | **RFC 9457 Problem Details** (`application/problem+json`) for all errors, produced by one global exception filter. Responses include `requestId`. Unknown errors never leak internals. | Custom JSON shape | Accepted | 2026-11-01 |
| D-040 | **Husky + lint-staged** pre-commit hook. Commitlint (enforcing Conventional Commits) is not yet confirmed. | | Accepted (commitlint pending) | 2026-11-01 |
| D-041 | **Multi-stage production Dockerfile**: one image runs the API (default) or the worker (`node dist/worker.js`). Node 25+ no longer bundles Corepack, so pnpm is installed with npm. | Defer the Dockerfile | Accepted | 2026-11-01 |
| D-042 | **Dependabot** for npm, GitHub Actions, and Docker, grouped for Nest packages and dev dependencies | Renovate, none | Accepted | 2026-11-01 |
| D-043 | **Local S3-compatible storage emulator: pending.** MinIO is no longer viable. Candidates: SeaweedFS (Apache-2.0, active), Garage (AGPL), S3Proxy (test-oriented), or a dedicated R2 dev bucket. Must be decided before Stage 4; it also affects integration tests. | | **Open** | |

## 6. Deferred and backlog items

- GET-style on-the-fly transformations (D-017, later phase)
- Presigned direct-to-storage uploads (D-008)
- CDN in front of R2 (D-016)
- Email verification and password reset (D-014)
- OpenTelemetry metrics and tracing (D-023)
- HEIC/HEIF input support (D-026)
- Animated GIF/WebP support (D-027)
- Optional "keep metadata" flag for derived images (D-029)
- Optional GIF and TIFF as output formats
- Deployment target and infrastructure (D-024)
- Security headers (Helmet) and CORS policy
- Trusted-proxy setting for client IP detection (needed with rate limiting, Stage 8)
- Readiness endpoint `/health/ready` (as dependencies are added)
- Nest 12 `@nestjs/observe` SDK versus pino plus OpenTelemetry (D-023 stands for now)
- Cleanup job for soft-deleted images and their R2 objects (D-028)

## 7. Open items to decide in the relevant stage

- Local object storage emulator (D-043), before Stage 4
- Whether to enforce Conventional Commits with commitlint (D-040)
- Pin the pnpm version (add a `packageManager` field or set it in CI and the Dockerfile)
- Exact shape of validation errors returned by `StandardSchemaValidationPipe`, to be mapped into Problem Details when the first endpoints with bodies exist (Stage 3)
- Exact access and refresh token lifetimes (Stage 3)
- Exact rate-limit values per tier (Stage 8)
- Pagination style for listings: cursor or offset (Stage 5)
- Retention period before soft-deleted images are cleaned up (Stage 7)
- How admin actions are recorded: logs only, or a dedicated audit table (Stage 3 or 5)
- Auth endpoint naming (`register` or `sign-up`) and API versioning prefix (Stage 3)
- Final inline-versus-queue thresholds (Stages 6 and 7)
- Initial set and ordering of transformations to implement (Stage 6)
