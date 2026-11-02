# Architecture: Image Processing Service

Companion to [DECISION_LOG.md](./DECISION_LOG.md). Decision IDs (D-xxx) refer to that file.

## 1. System overview

A backend service where authenticated users upload images, apply transformations, and retrieve results in different formats. Built as a modular monolith (D-018) with two entry points that share the same modules.

### Components

| Component | Technology | Responsibility |
|---|---|---|
| **API app** | NestJS on Fastify (D-001) | HTTP endpoints, authentication, validation, rate limiting, enqueueing jobs, inline processing for cheap operations |
| **Worker app** | NestJS standalone + BullMQ (D-011) | Runs queued transformation jobs with Sharp; can be scaled independently |
| **PostgreSQL** | Prisma (D-004, D-005) | Users, refresh tokens, images, image variants |
| **Redis** | (D-010) | BullMQ backend, cache lookups and locks, rate-limit counters |
| **Object storage** | Cloudflare R2 via S3 API; local emulator to be decided (D-007, D-043) | Original images and derived variants |

### API app modules

Auth, Users, Images, Transformations, Storage, Jobs, Cache, Health, Config. An Admin module is added for the `/admin/*` routes (D-031).

## 2. Key flows

### Upload (D-008, D-026, D-027)

1. Client sends a multipart request with a JWT.
2. The API checks authentication and rate limits, then enforces the 10 MB limit.
3. The file's real content is inspected with Sharp: format must be in the allowed list, and the pixel count must be under the ceiling.
4. The original is stored untouched in R2.
5. An `Image` record is saved in PostgreSQL.
6. Metadata (dimensions, format, size) is returned. Raw EXIF is not exposed (D-029).

### Transform (D-009, D-016, D-030)

1. Client sends `POST /images/:id/transform` with the operations.
2. The API checks ownership, validates the DTO (class-validator), then validates the operations with the Zod schema (D-019).
3. A deterministic cache key is computed from the source image and the normalized operations.
4. **Cache hit:** an existing completed variant is returned.
5. **Cache miss:** a `PENDING` variant record is created. The routing rule decides:
   - **Inline:** processed immediately and returned.
   - **Queued:** a BullMQ job is created and the client receives the variant ID to poll.
6. The worker (or inline path) reads the original from R2, auto-orients, runs the Sharp pipeline, strips metadata, stores the result in R2, and updates the variant record to `COMPLETED` or `FAILED`.
7. A short-lived Redis lock prevents two identical concurrent requests from doing the same work.

### Authentication (D-012, D-013)

- Register and login issue a short-lived access JWT and a rotating refresh token.
- Refresh tokens are stored hashed with a family ID. Reuse of a rotated token revokes the whole family.
- Passwords are hashed with Argon2id.

## 3. Data model (Prisma, draft)

All IDs are cuid (D-025).

| Model | Key fields |
|---|---|
| **User** | id, email (unique), passwordHash, role (`USER` / `ADMIN`), createdAt, updatedAt |
| **RefreshToken** | id, userId, tokenHash, familyId, expiresAt, revokedAt, createdAt |
| **Image** | id, ownerId, originalFilename, storageKey, mimeType, sizeBytes, width, height, checksum (SHA-256), createdAt, deletedAt |
| **ImageVariant** | id, imageId, cacheKey (unique), operations (JSON), storageKey, mimeType, sizeBytes, width, height, status (`PENDING` / `PROCESSING` / `COMPLETED` / `FAILED`), error, createdAt, completedAt |

Notes:
- `deletedAt` implements soft delete (D-028). Variants of a soft-deleted image are treated as deleted and removed by the cleanup job.
- Whether admin actions get a dedicated audit table is still open (see the Decision Log).

## 4. API surface (draft, versioned prefix `/api/v1`, final naming to be confirmed)

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

### Images (owner-scoped)
- `POST /images`: multipart upload
- `GET /images`: paginated list with metadata
- `GET /images/:id`: metadata
- `GET /images/:id/file`: retrieve the original
- `DELETE /images/:id`: soft delete

### Transformations (owner-scoped)
- `POST /images/:id/transform`
- `GET /images/:id/variants`
- `GET /variants/:variantId`: status and metadata
- `GET /variants/:variantId/file`

### Admin (role `ADMIN`, D-031)
- `/admin/*` routes to list and view all images and soft-delete them. Exact routes to be defined in Stage 5.

### Operations
- `GET /health/live`: liveness, unversioned and outside the `/api` prefix (D-038). `GET /health/ready` is added as dependencies arrive.

## 5. Cross-cutting concerns

| Concern | Approach |
|---|---|
| **Validation** | Zod everywhere through Nest 12 Standard Schema support (D-034) |
| **Rate limiting** | `@nestjs/throttler` on Redis; per-user and per-IP; stricter on transformation routes (D-015) |
| **Caching** | Derived images in R2 by deterministic key; Redis lookup and locks; HTTP cache headers (D-016) |
| **Errors** | RFC 9457 Problem Details through one global exception filter (D-039) |
| **Logging** | `nestjs-pino`, correlation IDs, health checks via Terminus (D-023) |
| **Docs** | Swagger/OpenAPI (D-022) |
| **Testing** | Vitest, unit plus e2e; Testcontainers for integration tests from Stage 2 (D-035) |
| **Local dev and CI** | Docker Compose (PostgreSQL, Redis; storage emulator pending); GitHub Actions (D-021) |
| **Security** | Argon2id, hashed refresh tokens, content-based upload validation, pixel ceiling, owner-scoped queries, admin routes isolated |
