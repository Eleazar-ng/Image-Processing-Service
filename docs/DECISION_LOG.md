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
| D-007 | **Cloudflare R2** for object storage, accessed through the S3-compatible API (`@aws-sdk/client-s3`). *Amended in Stage 1:* MinIO is no longer viable as the local stand-in (its community repository was archived in April 2026 and it stopped publishing Docker images in October 2025); the replacement is SeaweedFS (D-043, D-065). | AWS S3, Google Cloud Storage | Accepted (local stand-in amended) | 2026-11-01 |
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
| D-021 | **Docker and Docker Compose** locally (PostgreSQL, Redis, SeaweedFS for object storage, see D-065). **GitHub Actions** for CI. | Other CI platforms | Accepted | 2026-11-01 |
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

> **To confirm:** the admin capabilities, route style, and logging in D-031 came from Claude's recommendation, which was accepted as a group. The seed-script approach was stated explicitly. The routes, extra fields, and audit approach were then approved in Stage 5 (D-082, D-083).

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
| D-043 | **Local S3-compatible storage emulator: resolved by D-065** (SeaweedFS). MinIO stopped being viable when its community repository was archived. | RustFS, Garage, S3Proxy, a dedicated R2 dev bucket | **Resolved** | 2026-11-12 |

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

## 5e. Stage 4 decisions (storage and upload)

Approved on 2026-11-12 by accepting the recommendations as a group.

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-065 | **SeaweedFS** is the local S3 stand-in for R2 (resolves D-043), used by Docker Compose and by the Testcontainers e2e setup. It runs in single-process mode, serves S3 on port 8333, and its `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET` variables set the credentials and pre-create the bucket. The e2e setup also creates the bucket itself with retries, because the port opens before the bucket exists. The image tag is `latest` until a tested release is pinned. | RustFS, Garage, S3Proxy, a dedicated R2 dev bucket | Accepted | 2026-11-12 |
| D-066 | **Neutral `STORAGE_*` settings:** `STORAGE_ENDPOINT`, `STORAGE_REGION` (default `auto`), `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE` (default `true`). The S3 client sets `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED`, because R2 rejects the extra checksum headers newer SDK versions add by default. | `S3_*` or `R2_*` names | Accepted | 2026-11-12 |
| D-067 | **Key layout:** `users/{userId}/images/{uuid}.{ext}`, built only from the user ID, a random UUID, and an extension from the detected format. The client's filename is never part of a key. | Content-addressed keys, flat keys | Accepted | 2026-11-12 |
| D-068 | **Upload mechanics:** `POST /api/v1/images`, multipart, one file in the form field `file`, parsed by `@fastify/multipart` (registered in `configureApp`, which is now async). The limit (10 MiB, read from D-026's "10 MB" as 10 x 1024 x 1024 bytes, *to confirm*) is enforced while streaming. The file is buffered in memory, then stored. **No queue is involved in upload**: it completes inline (reaffirms D-008); the queue is for transformations (D-009, D-011). | Streaming straight to storage | Accepted | 2026-11-12 |
| D-069 | **Consistency:** the object is written first and deleted again if the database record cannot be saved; a failed compensating delete is logged and never masks the original error. A crash between the two steps can orphan an object, removed later by a cleanup job. A foreign-key violation (account deleted mid-request) is reported as 401. | Database first with a pending status (needs a schema change) | Accepted | 2026-11-12 |
| D-070 | **Validation by content:** Sharp reads the metadata; the format must be on the allowlist (JPEG, PNG, WebP, AVIF, GIF, TIFF; AVIF is HEIF with AV1, and HEVC/HEIC is rejected); the pixel count must be at most 50 million; and the image must decode fully (`failOn: 'error'`) so truncated or corrupt files are rejected before storage. Width and height are stored **as displayed** (EXIF orientations 5 to 8 swap them). The SHA-256 checksum covers the original bytes. Sharp errors are classified into 415 or 422 by their message text, which is a heuristic covered by tests. | Raw dimensions | Accepted | 2026-11-12 |
| D-071 | **Upload details:** the stored `originalFilename` is sanitized (directory parts, control and bidi-override characters removed, 255-character cap that keeps the extension, fallback `upload`); duplicates are allowed and get separate rows and keys; responses never include `storageKey` or `ownerId`. | Deduplicate by checksum | Accepted | 2026-11-12 |
| D-072 | **Error codes:** `400 MISSING_FILE`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_IMAGE_FORMAT`, `422 INVALID_IMAGE`. The Problem Details filter now also maps 4xx errors raised by the framework itself (for example Fastify rejecting an unsupported request content type) instead of turning them into 500s. | | Accepted | 2026-11-12 |
| D-073 | **`/health/ready` also checks storage** (a `HeadBucket` call with a 2 second timeout) | Add it later | Accepted | 2026-11-12 |
| D-074 | **Tests use real services:** one PostgreSQL and one SeaweedFS container per e2e run, real uploads, exact checks of bucket contents. Test images are generated with Sharp, so no binary fixtures are committed. | In-memory fake storage | Accepted | 2026-11-12 |
| D-075 | **Storage diagnostics script** `pnpm storage:check` (`scripts/check-storage.ts`): validates the `STORAGE_*` settings, then TCP, HTTP, signed bucket access, and a write/read/delete round trip, stopping at the first failure with a hint. Flags `--create-bucket` and `--timeout=`. Exit code 1 on failure. Added on request after Stage 4's first delivery. | Manual curl and docker commands only | Accepted | 2026-11-12 |

## 5f. Stage 5 decisions (retrieval, listing, delete, and admin)

Approved on 2026-11-18 by accepting the recommendations as a group, plus a requested download option.

| ID | Decision | Alternatives considered | Status | Date |
|---|---|---|---|---|
| D-076 | **Cursor pagination**, newest first, ordered by (`createdAt`, `id`) descending so ties never skip or repeat a row. `limit` defaults to 20 (1 to 100). The response is `{ items, nextCursor }`, with `nextCursor` null on the last page. The cursor is an opaque base64url token that is validated on use (`400 INVALID_CURSOR`). No total count. | Offset pagination | Accepted | 2026-11-18 |
| D-077 | **Originals are streamed through the API** from `GET /api/v1/images/:id/file`, which keeps access control in one place and the bucket private. The route sends the response itself (`@Res()`). Presigned redirects wait for a CDN. | Redirect to presigned storage URLs | Accepted | 2026-11-18 |
| D-078 | **File headers:** `ETag` is the quoted SHA-256 checksum; `Cache-Control: private, no-cache`, so every request is authorized and a client that already has the bytes gets `304 Not Modified` without a storage read (weak validators and `*` are honored); `X-Content-Type-Options: nosniff`; `Content-Disposition` with an ASCII fallback and an RFC 5987 `filename*`. | Long-lived caching | Accepted | 2026-11-18 |
| D-079 | **Download option:** `?download=true` (or `false`, the default) on both the owner and admin file routes switches `Content-Disposition` between `inline` and `attachment`. Any other value is a 400. The filename is the sanitized original with its extension corrected to the real format (a PNG uploaded as `holiday.jpg` downloads as `holiday.png`; a name without a known image extension gets the real one appended). | | Accepted | 2026-11-18 |
| D-080 | **Unknown, deleted, and other users' images all answer `404 IMAGE_NOT_FOUND`**, so a response never confirms that someone else's image ID exists. A matching `If-None-Match` does not bypass this check. | `403` for other users' images | Accepted | 2026-11-18 |
| D-081 | **Soft delete** is one conditional update (`deletedAt` set where the image is the caller's and not yet deleted): `204` the first time, `404` afterwards. The stored object and any variants remain until the Stage 7 cleanup job (D-028). | Always `204` | Accepted | 2026-11-18 |
| D-082 | **Admin routes** (role `ADMIN`, class-level): `GET /api/v1/admin/images` (filters `ownerId` and `includeDeleted`, default excludes deleted), `GET /admin/images/:id`, `GET /admin/images/:id/file`, `DELETE /admin/images/:id`. Responses add `ownerId` and `deletedAt` but never the storage key. *Claude's detail, to confirm:* admin get and file download ignore deletion state, so a soft-deleted image stays reviewable until the cleanup job removes it. | Admins limited to undeleted images | Accepted (deleted-image access to confirm) | 2026-11-18 |
| D-083 | **Admin audit trail as structured log events** (resolves the open item). Listing, viewing, downloading, and deleting each log an `audit` object with the action, actor ID and role, image ID, owner ID, and details. Only successful actions are recorded; refused attempts and lookups of missing images are not (the first are visible in ordinary request logs). | A dedicated audit table | Accepted | 2026-11-18 |
| D-084 | **New index `Image(createdAt, id)`** for the admin list, which orders across all owners. This needs a migration (`pnpm db:migrate:dev --name add_image_created_at_index`). | No index | Accepted | 2026-11-18 |
| D-085 | **The list takes only `limit` and `cursor`** (admin adds `ownerId` and `includeDeleted`). No filtering or sort options. | Filter by type or filename | Accepted | 2026-11-18 |
| D-086 | **Error codes:** `404 IMAGE_NOT_FOUND`, `400 INVALID_CURSOR`; query and parameter validation errors reuse the Problem Details `errors` array. | | Accepted | 2026-11-18 |

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
- Redis check for `/health/ready` (when Redis is added)
- Nest 12 `@nestjs/observe` SDK versus pino plus OpenTelemetry (D-023 stands for now)
- Cleanup job for soft-deleted images and their R2 objects (D-028)
- Cleanup of expired and revoked refresh tokens (fits the Stage 7 cleanup job)
- Queryable audit history through a dedicated table (D-083 uses log events; add a table if searchable history is needed)
- List filters (by type, filename search) and sort options (D-085)
- Redirect to presigned storage URLs, once a CDN is in place (D-077)
- Range requests for file downloads (not needed at 10 MiB)
- Retrieval in other formats (`GET` with transformation parameters, after Stage 6, D-017)
- Absolute session lifetime cap (refresh tokens currently slide for as long as they are used, D-056)
- `WWW-Authenticate: Bearer` header on 401 responses
- Response serialization schemas (`StandardSchemaSerializerInterceptor`) as an extra guard against leaking fields
- Admin password rotation and account recovery procedure (the seeder never resets an existing password, D-063)

## 7. Open items to decide in the relevant stage

- Pin the SeaweedFS image tag (Compose and tests use `latest` until a tested release is chosen, D-065)
- Cleanup of orphaned storage objects (an object whose record could not be saved after a crash, D-069); fits the Stage 7 cleanup job
- Per-user upload quotas (not requested; revisit if needed)
- Rate limiting on upload (Stage 8)
- How migrations are applied in deployment (the Prisma CLI is a dev dependency, so a deploy step or image variant is needed once hosting is planned)
- Whether the installed Prisma 7 release expects a differently named config file (D-044); verify with `pnpm prisma init`
- Pin the pnpm version (add a `packageManager` field or set it in CI and the Dockerfile)
- Confirm on first run that `StandardSchemaValidationPipe` errors surface as the Problem Details `errors` array (the filter accepts `errors`, `issues`, or an array `message`; see D-064)
- Exact rate-limit values per tier (Stage 8)
- Retention period before soft-deleted images are cleaned up (Stage 7)
- Final inline-versus-queue thresholds (Stages 6 and 7)
- Initial set and ordering of transformations to implement (Stage 6)
