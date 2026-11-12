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

> **To confirm:** the admin capabilities, route style, and logging in D-031 came from Claude's recommendation, which was accepted as a group. The seed-script approach was stated explicitly. Raise any correction before Stage 5, when the admin routes are built.

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
| D-038 | **URI versioning** with global prefix: routes under `/api/v1/...`. Health probes are unversioned and outside the prefix: `GET /health/live` (liveness) and, from Stage 2, `GET /health/ready` (readiness, PostgreSQL check). Redis and storage checks join readiness as those dependencies arrive. | Header versioning, none | Accepted | 2026-11-01 |
| D-039 | **RFC 9457 Problem Details** (`application/problem+json`) for all errors, produced by one global exception filter. Responses include `requestId`. Unknown errors never leak internals. Request IDs are assigned by Fastify (`genReqId`, reusing a validated incoming `x-request-id`) and echoed by an `onRequest` hook, so they cover every route, including those outside the `/api` prefix where Nest middleware does not run. | Custom JSON shape | Accepted | 2026-11-01 |
| D-040 | **Husky + lint-staged** pre-commit hook. Commitlint (enforcing Conventional Commits) is not yet confirmed. | | Accepted (commitlint added by D-051) | 2026-11-01 |
| D-041 | **Multi-stage production Dockerfile**: one image runs the API (default) or the worker (`node dist/worker.js`). Node 25+ no longer bundles Corepack, so pnpm is installed with npm. | Defer the Dockerfile | Accepted | 2026-11-01 |
| D-042 | **Dependabot** for npm, GitHub Actions, and Docker, grouped for Nest packages and dev dependencies | Renovate, none | Accepted | 2026-11-01 |
| D-043 | **Local S3-compatible storage emulator: pending.** MinIO is no longer viable. Candidates: SeaweedFS (Apache-2.0, active), Garage (AGPL), S3Proxy (test-oriented), or a dedicated R2 dev bucket. Must be decided before Stage 4; it also affects integration tests. | | **Open** | |

## 5c. Stage 2 decisions (database foundation)

Approved on 2026-11-02 by accepting the recommendations as a group.

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-044 | **Prisma 7 with the PostgreSQL driver adapter** (`@prisma/adapter-pg`). `prisma` and `@prisma/client` are installed as `@7` explicitly because the npm `latest` tag may point to a Prisma 8 pre-release. The connection URL lives in `prisma.config.ts`, read from `DATABASE_URL`. | | Accepted | 2026-11-02 |
| D-045 | **Generated client is git-ignored** (`src/generated/prisma`) and produced by `pnpm db:generate`, which CI and the Dockerfile run before building | Commit the generated client | Accepted | 2026-11-02 |
| D-046 | **Foreign-key behavior:** `RefreshToken` cascades from `User`; `ImageVariant` cascades from `Image`; `Image` to `User` is **Restrict** (no user-deletion feature yet, and silently deleting a user's images would be dangerous) | Cascade everywhere | Accepted | 2026-11-02 |
| D-047 | **Emails are normalized to lowercase in the application** (implemented in Stage 3) with a plain unique index | PostgreSQL `citext` | Accepted | 2026-11-02 |
| D-048 | **`timestamptz(3)` columns** for all timestamps | Prisma's default timestamp type | Accepted | 2026-11-02 |
| D-049 | **`GET /health/ready`** with a database check, built as a custom indicator on Terminus's `HealthIndicatorService` with a 1 second timeout. Unversioned and outside the `/api` prefix. | Built-in `PrismaHealthIndicator` | Accepted | 2026-11-02 |
| D-050 | **Testcontainers PostgreSQL**: one container per e2e run (Vitest global setup), committed migrations applied with `prisma migrate deploy`, tables truncated between tests; e2e files run serially because they share the database | Container per test file | Accepted | 2026-11-02 |
| D-051 | **commitlint** with `@commitlint/config-conventional`, enforced by a Husky `commit-msg` hook | No enforcement | Accepted | 2026-11-02 |
| D-052 | **Modeling detail (Claude's choice, to confirm):** `ImageVariant` output fields (`storageKey`, `mimeType`, `sizeBytes`, `width`, `height`) are nullable until the variant is `COMPLETED`, since a `PENDING` variant has no output yet. `Image.storageKey` and `ImageVariant.storageKey` are unique. Indexes: `Image(ownerId, createdAt)`, `Image(deletedAt)`, `ImageVariant(imageId)`, `ImageVariant(status, createdAt)`, `RefreshToken(userId)`, `(familyId)`, `(expiresAt)`. | Non-null output fields | Accepted (confirm) | 2026-11-02 |

## 5d. Stage 3 decisions (authentication and roles)

Approved on 2026-11-10 by accepting the recommendations as a group.

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-053 | **Password hashing: Argon2id through `@node-rs/argon2`** with the OWASP minimum parameters (19 MiB memory, 2 iterations, 1 lane). Parameters are encoded in each hash, so they can be raised later. A unit test asserts the `$argon2id$` prefix. | `argon2` (native compile), Node's built-in `crypto.argon2` (raw output only, so hash format and verification would be hand-written) | Accepted | 2026-11-10 |
| D-054 | **JWT through `@nestjs/jwt`, HS256, one secret** (`JWT_ACCESS_SECRET`, at least 32 characters). Signing and verification are both pinned to HS256 to rule out algorithm confusion. Claims (`sub`, `role`) are re-validated with Zod after verification. | `jose`, asymmetric keys (EdDSA, RS256) | Accepted | 2026-11-10 |
| D-055 | **Custom global guards, no Passport.** `JwtAuthGuard` protects every route unless marked `@Public()`; `RolesGuard` enforces `@Roles()`; `@CurrentUser()` exposes the caller. Health probes are `@Public()`. | Passport with `passport-jwt` | Accepted | 2026-11-10 |
| D-056 | **Token lifetimes:** access token 15 minutes, refresh token 7 days, both configurable in seconds (`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`). Refresh tokens are rotated on every use, so a session slides for as long as it is used. | | Accepted | 2026-11-10 |
| D-057 | **Refresh tokens are opaque 256-bit random values** (base64url), stored only as a SHA-256 hash, returned in the JSON body. Each login starts a new family; rotations keep the family. Presenting an already-revoked token revokes the whole family. Rotation uses a conditional update, so of two concurrent uses of one token only one wins and the other revokes the family. Logout revokes the family and is idempotent (204, no access token required). | JWT refresh tokens, httpOnly cookie | Accepted | 2026-11-10 |
| D-058 | **The role claim is trusted until the access token expires** (at most 15 minutes of staleness). There is no role-change feature yet. | Look up the user on every request | Accepted | 2026-11-10 |
| D-059 | **Endpoints:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, under `/api/v1`. Bodies are validated with Zod schemas through `@Body({ schema })`. Registration returns the public profile plus tokens (*Claude's choice, to confirm*), and can only ever create a `USER`. | `sign-up` and `log-in` naming | Accepted (register response to confirm) | 2026-11-10 |
| D-060 | **Password policy:** 12 to 128 characters, no composition rules (NIST 800-63B approach). Login accepts 1 to 128 characters so it never hints at the policy. Emails are trimmed and lowercased by the schema (D-047). | | Accepted | 2026-11-10 |
| D-061 | **Duplicate email returns 409** with `EMAIL_TAKEN` (this reveals which emails are registered; hiding it needs email verification, deferred in D-014). Login returns one generic `INVALID_CREDENTIALS` error and verifies against a dummy hash for unknown emails to equalize timing. | Hide duplicates | Accepted | 2026-11-10 |
| D-062 | **Rate limiting on auth routes is left to Stage 8**, when Redis is wired in (D-015 stands) | A temporary in-memory throttle now | Accepted | 2026-11-10 |
| D-063 | **Admin seeding:** `pnpm db:seed` reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment (validated against the password policy; never part of the application's own env schema, never committed). It creates the admin; an existing admin is a no-op and its password is never reset; an existing non-admin account with that email is an error instead of a silent promotion (*Claude's choice, to confirm*). | Hard-coded defaults, silent promotion | Accepted (error-on-existing-user to confirm) | 2026-11-10 |
| D-064 | **Stable error codes** are carried in Problem Details `errorCode`: `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `UNAUTHENTICATED`, `INVALID_ACCESS_TOKEN`, `FORBIDDEN`. Validation failures surface in `errors`; the filter accepts the array under `errors`, `issues`, or as an array `message`, because the exact shape produced by `StandardSchemaValidationPipe` is confirmed by the e2e tests on first run. | | Accepted | 2026-11-10 |

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
- Redis and storage checks for `/health/ready` (as those dependencies are added)
- Nest 12 `@nestjs/observe` SDK versus pino plus OpenTelemetry (D-023 stands for now)
- Cleanup job for soft-deleted images and their R2 objects (D-028)
- Cleanup of expired and revoked refresh tokens (fits the Stage 7 cleanup job)
- Absolute session lifetime cap (refresh tokens currently slide for as long as they are used, D-056)
- `WWW-Authenticate: Bearer` header on 401 responses
- Response serialization schemas (`StandardSchemaSerializerInterceptor`) as an extra guard against leaking fields
- Admin password rotation and account recovery procedure (the seeder never resets an existing password, D-063)

## 7. Open items to decide in the relevant stage

- Local object storage emulator (D-043), before Stage 4
- How migrations are applied in deployment (the Prisma CLI is a dev dependency, so a deploy step or image variant is needed once hosting is planned)
- Whether the installed Prisma 7 release expects a differently named config file (D-044); verify with `pnpm prisma init`
- Pin the pnpm version (add a `packageManager` field or set it in CI and the Dockerfile)
- Confirm on first run that `StandardSchemaValidationPipe` errors surface as the Problem Details `errors` array (the filter accepts `errors`, `issues`, or an array `message`; see D-064)
- Exact rate-limit values per tier (Stage 8)
- Pagination style for listings: cursor or offset (Stage 5)
- Retention period before soft-deleted images are cleaned up (Stage 7)
- How admin actions are recorded: logs only, or a dedicated audit table (Stage 5, when admin routes exist)
- Final inline-versus-queue thresholds (Stages 6 and 7)
- Initial set and ordering of transformations to implement (Stage 6)
