import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createFastifyAdapter } from '../src/app.setup.js';
import { AuditService } from '../src/audit/audit.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestPrisma, truncateAll } from './support/database.js';
import { buildMultipart } from './support/multipart.js';
import { clearBucket, createTestS3, listKeys } from './support/storage.js';

interface ImageBody {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  createdAt: string;
}

interface AdminImageBody extends ImageBody {
  ownerId: string;
  deletedAt: string | null;
}

interface PageBody<T = ImageBody> {
  items: T[];
  nextCursor: string | null;
}

interface Problem {
  status: number;
  errorCode?: string;
}

interface Account {
  id: string;
  token: string;
}

const PASSWORD = 'correct-horse-battery';
const PROBLEM_JSON = 'application/problem+json';

const png = (color = '#3366cc') =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
    .png()
    .toBuffer();

describe('Image retrieval, deletion, and admin access (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let s3: S3Client;
  let storage: StorageService;
  let audit: AuditService;
  let alice: Account;
  let bob: Account;
  let admin: Account;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = createTestPrisma();
    s3 = createTestS3();
    storage = app.get(StorageService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    s3.destroy();
    await app.close();
  });

  const signUp = async (email: string): Promise<Account> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: PASSWORD },
    });
    const body = res.json<{
      user: { id: string };
      tokens: { accessToken: string };
    }>();
    return { id: body.user.id, token: body.tokens.accessToken };
  };

  const makeAdmin = async (email: string): Promise<Account> => {
    const account = await signUp(email);
    await prisma.user.update({
      where: { id: account.id },
      data: { role: 'ADMIN' },
    });
    // Roles are read from the token, so sign in again to get an ADMIN token.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    return {
      id: account.id,
      token: res.json<{ tokens: { accessToken: string } }>().tokens.accessToken,
    };
  };

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearBucket(s3);
    alice = await signUp('alice@example.com');
    bob = await signUp('bob@example.com');
    admin = await makeAdmin('admin@example.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = (
    method: 'GET' | 'DELETE',
    url: string,
    token?: string,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });

  const get = (url: string, token?: string, headers?: Record<string, string>) =>
    request('GET', url, token, headers);
  const del = (url: string, token?: string) => request('DELETE', url, token);

  const uploadImage = async (
    account: Account,
    file: Buffer,
    filename = 'photo.png',
  ): Promise<ImageBody> => {
    const { payload, headers } = buildMultipart([
      {
        name: 'file',
        value: file,
        filename,
        contentType: 'application/octet-stream',
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      payload,
      headers: { ...headers, authorization: `Bearer ${account.token}` },
    });
    expect(res.statusCode).toBe(201);
    return res.json<ImageBody>();
  };

  // Inserts a row directly, so tests control createdAt exactly.
  const insertImage = (
    ownerId: string,
    createdAt: Date,
    overrides: { deletedAt?: Date } = {},
  ) =>
    prisma.image.create({
      data: {
        ownerId,
        originalFilename: 'seed.jpg',
        storageKey: `users/${ownerId}/images/${randomUUID()}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        width: 4,
        height: 3,
        checksum: 'f'.repeat(64),
        createdAt,
        ...overrides,
      },
    });

  const second = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

  /** Follows nextCursor to the end and returns every ID in order. */
  const walk = async (
    token: string,
    limit: number,
    base = '/api/v1/images',
    extra = '',
  ): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 50; pages += 1) {
      const url: string = `${base}?limit=${String(limit)}${extra}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      }`;
      const res = await get(url, token);
      expect(res.statusCode).toBe(200);
      const body = res.json<PageBody>();
      ids.push(...body.items.map((item) => item.id));
      if (!body.nextCursor) {
        return ids;
      }
      cursor = body.nextCursor;
    }
    throw new Error('pagination did not terminate');
  };

  const orderedIds = async (where: object) =>
    (
      await prisma.image.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    ).map((row) => row.id);

  const readBody = async (stream: AsyncIterable<unknown> | undefined) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream ?? []) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  };

  // ------------------------------------------------------------------ list

  describe('GET /images', () => {
    it('requires authentication', async () => {
      const res = await get('/api/v1/images');

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
    });

    it('returns an empty page for a new account', async () => {
      const res = await get('/api/v1/images', alice.token);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], nextCursor: null });
    });

    it('lists only the caller’s images, newest first', async () => {
      const first = await uploadImage(alice, await png('#ff0000'), 'one.png');
      const secondImage = await uploadImage(
        alice,
        await png('#00ff00'),
        'two.png',
      );
      await uploadImage(bob, await png('#0000ff'), 'bobs.png');

      const body = (await get('/api/v1/images', alice.token)).json<PageBody>();

      expect(body.items.map((item) => item.id)).toEqual([
        secondImage.id,
        first.id,
      ]);
      expect(body.nextCursor).toBeNull();
    });

    it('exposes only safe fields', async () => {
      await uploadImage(alice, await png());

      const body = (await get('/api/v1/images', alice.token)).json<PageBody>();

      expect(Object.keys(body.items[0] as ImageBody).sort()).toEqual([
        'checksum',
        'createdAt',
        'height',
        'id',
        'mimeType',
        'originalFilename',
        'sizeBytes',
        'width',
      ]);
    });

    it('excludes deleted images', async () => {
      await insertImage(alice.id, second(1));
      await insertImage(alice.id, second(2), { deletedAt: second(3) });

      const body = (await get('/api/v1/images', alice.token)).json<PageBody>();

      expect(body.items).toHaveLength(1);
    });

    it('walks every page without gaps or repeats, including rows that share a timestamp', async () => {
      // Three rows share one timestamp: ties must be broken by ID.
      for (const n of [0, 1, 2, 2, 2, 3, 4]) {
        await insertImage(alice.id, second(n));
      }
      const expected = await orderedIds({ ownerId: alice.id });

      for (const limit of [1, 2, 3, 7, 8]) {
        expect(
          await walk(alice.token, limit),
          `limit ${String(limit)}`,
        ).toEqual(expected);
      }
    });

    it('returns no cursor when the last page is exactly full', async () => {
      await insertImage(alice.id, second(1));
      await insertImage(alice.id, second(2));

      const body = (
        await get('/api/v1/images?limit=2', alice.token)
      ).json<PageBody>();

      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
    });

    it('stays consistent when new images arrive between pages', async () => {
      for (const n of [1, 2, 3, 4, 5]) {
        await insertImage(alice.id, second(n));
      }
      const expected = await orderedIds({ ownerId: alice.id });

      const firstPage = (
        await get('/api/v1/images?limit=2', alice.token)
      ).json<PageBody>();
      await insertImage(alice.id, second(99)); // newer than everything
      const cursor = encodeURIComponent(firstPage.nextCursor as string);
      const secondPage = (
        await get(`/api/v1/images?limit=10&cursor=${cursor}`, alice.token)
      ).json<PageBody>();

      expect(firstPage.items.map((item) => item.id)).toEqual(
        expected.slice(0, 2),
      );
      expect(secondPage.items.map((item) => item.id)).toEqual(
        expected.slice(2),
      );
    });

    it('defaults to 20 per page', async () => {
      for (let n = 1; n <= 21; n += 1) {
        await insertImage(alice.id, second(n));
      }

      const body = (await get('/api/v1/images', alice.token)).json<PageBody>();

      expect(body.items).toHaveLength(20);
      expect(body.nextCursor).not.toBeNull();
    });

    it.each(['0', '101', 'abc', '-1', '1.5'])(
      'rejects limit=%s with 400',
      async (limit) => {
        const res = await get(`/api/v1/images?limit=${limit}`, alice.token);

        expect(res.statusCode).toBe(400);
        expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      },
    );

    it('rejects a malformed cursor with 400 INVALID_CURSOR', async () => {
      const res = await get(
        '/api/v1/images?cursor=not-a-real-cursor',
        alice.token,
      );

      expect(res.statusCode).toBe(400);
      expect(res.json<Problem>().errorCode).toBe('INVALID_CURSOR');
    });
  });

  // ------------------------------------------------------------ get by id

  describe('GET /images/:id', () => {
    it('returns the metadata of the caller’s image', async () => {
      const uploaded = await uploadImage(alice, await png(), 'mine.png');

      const res = await get(`/api/v1/images/${uploaded.id}`, alice.token);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(uploaded);
    });

    it('answers 404 IMAGE_NOT_FOUND for an unknown ID', async () => {
      const res = await get('/api/v1/images/does-not-exist', alice.token);

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
    });

    it('answers 404, not 403, for someone else’s image', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(`/api/v1/images/${uploaded.id}`, bob.token);

      expect(res.statusCode).toBe(404);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
    });

    it('answers 404 for a deleted image', async () => {
      const row = await insertImage(alice.id, second(1), {
        deletedAt: second(2),
      });

      expect(
        (await get(`/api/v1/images/${row.id}`, alice.token)).statusCode,
      ).toBe(404);
    });

    it('requires authentication', async () => {
      const uploaded = await uploadImage(alice, await png());

      expect((await get(`/api/v1/images/${uploaded.id}`)).statusCode).toBe(401);
    });
  });

  // ----------------------------------------------------------------- file

  describe('GET /images/:id/file', () => {
    it('streams the original bytes with the right headers', async () => {
      const file = await png();
      const uploaded = await uploadImage(alice, file, 'holiday.png');

      const res = await get(`/api/v1/images/${uploaded.id}/file`, alice.token);

      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(file)).toBe(true);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe(String(file.length));
      expect(res.headers.etag).toBe(`"${uploaded.checksum}"`);
      expect(res.headers['cache-control']).toBe('private, no-cache');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="holiday.png"; filename*=UTF-8''holiday.png`,
      );
    });

    it('answers 304 without reading storage when the ETag matches', async () => {
      const uploaded = await uploadImage(alice, await png());
      const etag = `"${uploaded.checksum}"`;
      const read = vi.spyOn(storage, 'get');

      const res = await get(`/api/v1/images/${uploaded.id}/file`, alice.token, {
        'if-none-match': etag,
      });

      expect(res.statusCode).toBe(304);
      expect(res.body).toBe('');
      expect(res.headers.etag).toBe(etag);
      expect(res.headers['cache-control']).toBe('private, no-cache');
      expect(read).not.toHaveBeenCalled();
    });

    it('treats a weak validator as a match', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(`/api/v1/images/${uploaded.id}/file`, alice.token, {
        'if-none-match': `W/"${uploaded.checksum}"`,
      });

      expect(res.statusCode).toBe(304);
    });

    it('sends the file when the ETag does not match', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(`/api/v1/images/${uploaded.id}/file`, alice.token, {
        'if-none-match': '"something-else"',
      });

      expect(res.statusCode).toBe(200);
    });

    it('does not let a matching ETag bypass access control', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(`/api/v1/images/${uploaded.id}/file`, bob.token, {
        'if-none-match': `"${uploaded.checksum}"`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('sends an attachment with ?download=true', async () => {
      const uploaded = await uploadImage(alice, await png(), 'holiday.png');

      const res = await get(
        `/api/v1/images/${uploaded.id}/file?download=true`,
        alice.token,
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="holiday.png"; filename*=UTF-8''holiday.png`,
      );
    });

    it('stays inline with ?download=false', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(
        `/api/v1/images/${uploaded.id}/file?download=false`,
        alice.token,
      );

      expect(String(res.headers['content-disposition'])).toMatch(/^inline;/);
    });

    it('corrects a misleading extension in the download name', async () => {
      const uploaded = await uploadImage(alice, await png(), 'holiday.jpg');

      const res = await get(
        `/api/v1/images/${uploaded.id}/file?download=true`,
        alice.token,
      );

      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="holiday.png"; filename*=UTF-8''holiday.png`,
      );
    });

    it('keeps a non-ASCII filename intact for the download', async () => {
      const uploaded = await uploadImage(alice, await png(), '写真.png');

      const res = await get(
        `/api/v1/images/${uploaded.id}/file?download=true`,
        alice.token,
      );

      expect(res.headers['content-disposition']).toContain(
        `filename*=UTF-8''%E5%86%99%E7%9C%9F.png`,
      );
    });

    it.each(['yes', '1', 'TRUE', ''])(
      'rejects download=%s with 400',
      async (value) => {
        const uploaded = await uploadImage(alice, await png());

        const res = await get(
          `/api/v1/images/${uploaded.id}/file?download=${value}`,
          alice.token,
        );

        expect(res.statusCode).toBe(400);
      },
    );

    it('answers 404 for someone else’s image', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await get(`/api/v1/images/${uploaded.id}/file`, bob.token);

      expect(res.statusCode).toBe(404);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
    });

    it('requires authentication', async () => {
      const uploaded = await uploadImage(alice, await png());

      expect((await get(`/api/v1/images/${uploaded.id}/file`)).statusCode).toBe(
        401,
      );
    });

    it('answers 404 when the record exists but the object is missing', async () => {
      const uploaded = await uploadImage(alice, await png());
      const row = await prisma.image.findUniqueOrThrow({
        where: { id: uploaded.id },
      });
      await storage.delete(row.storageKey);

      const res = await get(`/api/v1/images/${uploaded.id}/file`, alice.token);

      expect(res.statusCode).toBe(404);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
      expect(res.headers.etag).toBeUndefined();
    });
  });

  // --------------------------------------------------------------- delete

  describe('DELETE /images/:id', () => {
    it('soft-deletes the image: gone for the owner, kept in the database and storage', async () => {
      const uploaded = await uploadImage(alice, await png());
      const row = await prisma.image.findUniqueOrThrow({
        where: { id: uploaded.id },
      });

      const res = await del(`/api/v1/images/${uploaded.id}`, alice.token);

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(
        (await get(`/api/v1/images/${uploaded.id}`, alice.token)).statusCode,
      ).toBe(404);
      expect(
        (await get(`/api/v1/images/${uploaded.id}/file`, alice.token))
          .statusCode,
      ).toBe(404);
      expect(
        (await get('/api/v1/images', alice.token)).json<PageBody>().items,
      ).toEqual([]);

      const after = await prisma.image.findUniqueOrThrow({
        where: { id: uploaded.id },
      });
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(await listKeys(s3)).toContain(row.storageKey);
    });

    it('answers 404 the second time', async () => {
      const uploaded = await uploadImage(alice, await png());
      await del(`/api/v1/images/${uploaded.id}`, alice.token);

      const res = await del(`/api/v1/images/${uploaded.id}`, alice.token);

      expect(res.statusCode).toBe(404);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
    });

    it('cannot delete someone else’s image', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await del(`/api/v1/images/${uploaded.id}`, bob.token);

      expect(res.statusCode).toBe(404);
      expect(
        (await get(`/api/v1/images/${uploaded.id}`, alice.token)).statusCode,
      ).toBe(200);
    });

    it('answers 404 for an unknown ID', async () => {
      expect(
        (await del('/api/v1/images/does-not-exist', alice.token)).statusCode,
      ).toBe(404);
    });

    it('requires authentication', async () => {
      const uploaded = await uploadImage(alice, await png());

      expect((await del(`/api/v1/images/${uploaded.id}`)).statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------- admin

  describe('admin routes', () => {
    const adminRoutes = (id: string) =>
      [
        ['GET', '/api/v1/admin/images'],
        ['GET', `/api/v1/admin/images/${id}`],
        ['GET', `/api/v1/admin/images/${id}/file`],
        ['DELETE', `/api/v1/admin/images/${id}`],
      ] as const;

    it('rejects an unauthenticated caller with 401 on every route', async () => {
      const uploaded = await uploadImage(alice, await png());

      for (const [method, url] of adminRoutes(uploaded.id)) {
        expect(
          (await request(method, url)).statusCode,
          `${method} ${url}`,
        ).toBe(401);
      }
    });

    it('rejects a regular user with 403 on every route', async () => {
      const uploaded = await uploadImage(alice, await png());

      for (const [method, url] of adminRoutes(uploaded.id)) {
        const res = await request(method, url, alice.token);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json<Problem>().errorCode).toBe('FORBIDDEN');
      }
    });

    it('lists every user’s images with ownership and deletion state', async () => {
      const a = await uploadImage(alice, await png('#111111'));
      const b = await uploadImage(bob, await png('#222222'));

      const body = (await get('/api/v1/admin/images', admin.token)).json<
        PageBody<AdminImageBody>
      >();

      expect(body.items.map((item) => item.id).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      const byId = new Map(body.items.map((item) => [item.id, item]));
      expect(byId.get(a.id)).toMatchObject({
        ownerId: alice.id,
        deletedAt: null,
      });
      expect(byId.get(b.id)).toMatchObject({
        ownerId: bob.id,
        deletedAt: null,
      });
      expect(body.items[0]).not.toHaveProperty('storageKey');
    });

    it('filters by owner', async () => {
      await uploadImage(alice, await png('#111111'));
      const b = await uploadImage(bob, await png('#222222'));

      const body = (
        await get(`/api/v1/admin/images?ownerId=${bob.id}`, admin.token)
      ).json<PageBody<AdminImageBody>>();

      expect(body.items.map((item) => item.id)).toEqual([b.id]);
    });

    it('hides deleted images unless asked, and shows them with includeDeleted', async () => {
      await insertImage(alice.id, second(1));
      const gone = await insertImage(alice.id, second(2), {
        deletedAt: second(3),
      });

      const hidden = (await get('/api/v1/admin/images', admin.token)).json<
        PageBody<AdminImageBody>
      >();
      const shown = (
        await get('/api/v1/admin/images?includeDeleted=true', admin.token)
      ).json<PageBody<AdminImageBody>>();

      expect(hidden.items).toHaveLength(1);
      expect(shown.items).toHaveLength(2);
      expect(
        shown.items.find((item) => item.id === gone.id)?.deletedAt,
      ).not.toBeNull();
    });

    it('paginates across owners without gaps or repeats', async () => {
      for (const [owner, n] of [
        [alice, 1],
        [bob, 2],
        [alice, 3],
        [bob, 3],
        [alice, 4],
        [bob, 5],
      ] as const) {
        await insertImage(owner.id, second(n));
      }
      const expected = await orderedIds({ deletedAt: null });

      for (const limit of [1, 2, 4, 10]) {
        expect(
          await walk(admin.token, limit, '/api/v1/admin/images'),
          `limit ${String(limit)}`,
        ).toEqual(expected);
      }
    });

    it('rejects an invalid includeDeleted value with 400', async () => {
      const res = await get(
        '/api/v1/admin/images?includeDeleted=maybe',
        admin.token,
      );

      expect(res.statusCode).toBe(400);
    });

    it('shows any image by ID, including deleted ones', async () => {
      const uploaded = await uploadImage(alice, await png());
      await del(`/api/v1/images/${uploaded.id}`, alice.token);

      const res = await get(`/api/v1/admin/images/${uploaded.id}`, admin.token);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: uploaded.id,
        ownerId: alice.id,
        deletedAt: expect.any(String) as string,
      });
    });

    it('answers 404 for an unknown ID', async () => {
      const res = await get('/api/v1/admin/images/does-not-exist', admin.token);

      expect(res.statusCode).toBe(404);
      expect(res.json<Problem>().errorCode).toBe('IMAGE_NOT_FOUND');
    });

    it('downloads another user’s original, inline or as an attachment', async () => {
      const file = await png();
      const uploaded = await uploadImage(alice, file, 'private.png');

      const inline = await get(
        `/api/v1/admin/images/${uploaded.id}/file`,
        admin.token,
      );
      const attachment = await get(
        `/api/v1/admin/images/${uploaded.id}/file?download=true`,
        admin.token,
      );

      expect(inline.statusCode).toBe(200);
      expect(inline.rawPayload.equals(file)).toBe(true);
      expect(String(inline.headers['content-disposition'])).toMatch(/^inline;/);
      expect(String(attachment.headers['content-disposition'])).toMatch(
        /^attachment;/,
      );
    });

    it('can still download an image its owner has deleted', async () => {
      const file = await png();
      const uploaded = await uploadImage(alice, file);
      await del(`/api/v1/images/${uploaded.id}`, alice.token);

      const res = await get(
        `/api/v1/admin/images/${uploaded.id}/file`,
        admin.token,
      );

      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(file)).toBe(true);
    });

    it('deletes another user’s image; the owner then sees 404, and a repeat is 404', async () => {
      const uploaded = await uploadImage(alice, await png());

      const res = await del(`/api/v1/admin/images/${uploaded.id}`, admin.token);
      const row = await prisma.image.findUniqueOrThrow({
        where: { id: uploaded.id },
      });

      expect(res.statusCode).toBe(204);
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(
        (await get(`/api/v1/images/${uploaded.id}`, alice.token)).statusCode,
      ).toBe(404);
      expect(
        (await del(`/api/v1/admin/images/${uploaded.id}`, admin.token))
          .statusCode,
      ).toBe(404);
    });

    describe('audit trail', () => {
      const adminActor = () =>
        expect.objectContaining({ id: admin.id, role: 'ADMIN' }) as unknown;

      it('records listing, viewing, downloading, and deleting', async () => {
        const uploaded = await uploadImage(alice, await png());
        const record = vi.spyOn(audit, 'record');

        await get('/api/v1/admin/images?limit=5', admin.token);
        await get(`/api/v1/admin/images/${uploaded.id}`, admin.token);
        await get(
          `/api/v1/admin/images/${uploaded.id}/file?download=true`,
          admin.token,
        );
        await del(`/api/v1/admin/images/${uploaded.id}`, admin.token);

        expect(record).toHaveBeenCalledTimes(4);
        expect(record).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            action: 'admin.image.list',
            actor: adminActor(),
            details: { ownerFilter: null, includeDeleted: false, limit: 5 },
          }),
        );
        expect(record).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            action: 'admin.image.view',
            actor: adminActor(),
            imageId: uploaded.id,
            ownerId: alice.id,
          }),
        );
        expect(record).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            action: 'admin.image.download',
            imageId: uploaded.id,
            ownerId: alice.id,
            details: { asAttachment: true },
          }),
        );
        expect(record).toHaveBeenNthCalledWith(
          4,
          expect.objectContaining({
            action: 'admin.image.delete',
            imageId: uploaded.id,
            ownerId: alice.id,
          }),
        );
      });

      it('does not record an owner using their own images', async () => {
        const uploaded = await uploadImage(alice, await png());
        const record = vi.spyOn(audit, 'record');

        await get('/api/v1/images', alice.token);
        await get(`/api/v1/images/${uploaded.id}`, alice.token);
        await get(`/api/v1/images/${uploaded.id}/file`, alice.token);
        await del(`/api/v1/images/${uploaded.id}`, alice.token);

        expect(record).not.toHaveBeenCalled();
      });

      it('does not record a refused attempt by a regular user', async () => {
        const record = vi.spyOn(audit, 'record');

        await get('/api/v1/admin/images', alice.token);

        expect(record).not.toHaveBeenCalled();
      });

      it('does not record a request for an image that does not exist', async () => {
        const record = vi.spyOn(audit, 'record');

        await get('/api/v1/admin/images/does-not-exist', admin.token);

        expect(record).not.toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------- misc

  describe('storage consistency after deletion', () => {
    it('keeps the stored bytes readable through the storage service until cleanup', async () => {
      const file = await png();
      const uploaded = await uploadImage(alice, file);
      const row = await prisma.image.findUniqueOrThrow({
        where: { id: uploaded.id },
      });
      await del(`/api/v1/images/${uploaded.id}`, alice.token);

      const stored = await storage.get(row.storageKey);

      expect((await readBody(stored?.body)).equals(file)).toBe(true);
    });
  });
});
