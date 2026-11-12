# Roadmap: Image Processing Service

Working rules: no decision is assumed, and the scope of every stage is discussed and reviewed before development starts. Testing and documentation happen inside each stage, not only at the end. At the end of each stage we produce a commit/PR file and an affected-files list, and update the Decision Log.

Sub-stages are proposed where a stage is large. The roadmap is a proposal that can be revised as we learn.

| Stage | Name | Status |
|---|---|---|
| 0 | Architecture and foundations | Complete |
| 1 | Project scaffolding and tooling | Complete |
| 2 | Database foundation | Complete |
| 3 | Authentication and roles | In review |
| 4 | Storage and upload | Not started |
| 5 | Retrieval, listing, and admin | Not started |
| 6 | Transformation engine | Not started |
| 7 | Async processing | Not started |
| 8 | Caching and rate limiting | Not started |
| 9 | Hardening | Not started |
| 10 | Final documentation and polish | Not started |

---

## Stage 0: Architecture and foundations (complete)

Stack, infrastructure, and behavior decisions; architecture; data model; API surface; roadmap; Decision Log.

## Stage 1: Project scaffolding and tooling

- NestJS project with Fastify, strict TypeScript, ESLint and Prettier, pnpm
- Structure for the API and worker entry points
- Zod-validated configuration
- Docker Compose (PostgreSQL, Redis; object storage emulator pending, D-043)
- GitHub Actions CI (lint, build, test)
- `nestjs-pino` logging, health check endpoint, Swagger setup
- Test setup (Vitest; Testcontainers moves to Stage 2, when a database exists)

## Stage 2: Database foundation

- Prisma 7 setup with the PostgreSQL driver adapter, Prisma module and service
- Initial schema (User, RefreshToken, Image, ImageVariant) and first migration
- Testcontainers PostgreSQL for e2e and database tests
- `GET /health/ready` with a database check
- Seed runner skeleton (the admin seeder arrives in Stage 3)
- commitlint (carried over from Stage 1)

## Stage 3: Authentication and roles

- Register, login, refresh, logout, and `GET /auth/me`; Argon2id hashing
- Access JWT plus rotating opaque refresh tokens with reuse detection
- Global JWT guard with `@Public()`, role guard with `@Roles()`, `@CurrentUser()`
- Admin seed script (environment-driven, idempotent)
- Zod request schemas, stable error codes, validation errors in Problem Details
- Rate limiting on auth routes moves to Stage 8; the admin audit approach is decided in Stage 5

## Stage 4: Storage and upload

- Storage module (S3-compatible client for R2 and MinIO)
- Multipart upload with 10 MB limit
- Content-based validation, allowed formats, pixel ceiling
- Image record creation and metadata extraction

## Stage 5: Retrieval, listing, and admin

- List (paginated), get metadata, retrieve original, soft delete
- Owner-scoped access rules
- Admin routes: view all images, soft-delete
- Decide: pagination style

## Stage 6: Transformation engine

- Operation schemas (Zod) and Sharp pipeline
- Auto-orient and metadata stripping
- Deterministic cache key and variant records
- Inline execution path with concurrency cap
- `POST /images/:id/transform` and variant endpoints
- Decide: initial transformation set and ordering (resize, crop, rotate, flip, mirror, watermark, compress, format change, filters)

## Stage 7: Async processing

- BullMQ queue and worker app
- Routing rule (inline versus queued) with configurable thresholds
- Retries with backoff, idempotent jobs, failed-job handling
- Status polling
- Cleanup job for soft-deleted images and their R2 objects
- Decide: cleanup retention period

## Stage 8: Caching and rate limiting

- Redis lookup and short-lived locks for duplicate requests
- HTTP caching headers (`Cache-Control`, `ETag`)
- Tiered, Redis-backed rate limits with stricter limits on transformation and authentication routes (login, register, refresh)
- Decide: rate-limit values

## Stage 9: Hardening

- Full e2e coverage of critical flows
- Security review (auth, uploads, ownership, admin isolation)
- Consistent error handling and validation review
- Load and benchmark checks to tune routing thresholds

## Stage 10: Final documentation and polish

- README, setup guide, and complete Swagger documentation
- Final Decision Log review
- Scope the deferred items: GET-style transformations, presigned uploads, CDN, email verification and password reset, OpenTelemetry, HEIC support, animated image support
