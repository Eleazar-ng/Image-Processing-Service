import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { AppModule } from '../src/app.module.js';
import { configureApp, createFastifyAdapter } from '../src/app.setup.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { MAX_UPLOAD_BYTES } from '../src/images/upload.constants.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestPrisma, truncateAll } from './support/database.js';
import { buildMultipart } from './support/multipart.js';
import { clearBucket, createTestS3, listKeys } from './support/storage.js';

interface Problem {
  status: number;
  errorCode?: string;
}

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

const PASSWORD = 'correct-horse-battery';
const PROBLEM_JSON = 'application/problem+json';

const blank = (width = 40, height = 30) =>
  sharp({
    create: { width, height, channels: 3, background: '#cc3300' },
  });

describe('Image upload (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let s3: S3Client;
  let storage: StorageService;
  let token: string;
  let userId: string;

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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    s3.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearBucket(s3);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'alice@example.com', password: PASSWORD },
    });
    const body = res.json<{
      user: { id: string };
      tokens: { accessToken: string };
    }>();
    token = body.tokens.accessToken;
    userId = body.user.id;
  });

  const upload = (
    file: Buffer,
    options: { filename?: string; contentType?: string; field?: string } = {},
    accessToken: string | undefined = token,
  ) => {
    const { payload, headers } = buildMultipart([
      {
        name: options.field ?? 'file',
        value: file,
        filename: options.filename ?? 'photo.jpg',
        contentType: options.contentType ?? 'application/octet-stream',
      },
    ]);
    return app.inject({
      method: 'POST',
      url: '/api/v1/images',
      payload,
      headers: {
        ...headers,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  };

  describe('POST /images', () => {
    it('requires authentication', async () => {
      const res = await upload(await blank().jpeg().toBuffer(), {}, '');

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
    });

    it('stores a JPEG and returns its metadata', async () => {
      const file = await blank().jpeg().toBuffer();

      const res = await upload(file, { filename: 'holiday.jpg' });
      const body = res.json<ImageBody>();

      expect(res.statusCode).toBe(201);
      expect(body).toMatchObject({
        originalFilename: 'holiday.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: file.length,
        width: 40,
        height: 30,
        checksum: createHash('sha256').update(file).digest('hex'),
      });
      expect(body.id).toBeTruthy();
      expect(body).not.toHaveProperty('storageKey');
      expect(body).not.toHaveProperty('ownerId');
    });

    it('writes the original, byte for byte, under the owner prefix', async () => {
      const file = await blank().jpeg().toBuffer();

      const res = await upload(file);
      const row = await prisma.image.findUniqueOrThrow({
        where: { id: res.json<ImageBody>().id },
      });

      expect(row.ownerId).toBe(userId);
      expect(row.storageKey).toMatch(
        new RegExp(`^users/${userId}/images/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(await listKeys(s3)).toEqual([row.storageKey]);

      const stored = await storage.get(row.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stored?.body ?? []) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).equals(file)).toBe(true);
      expect(stored?.contentType).toBe('image/jpeg');
    });

    it.each([
      ['png', 'image/png'],
      ['webp', 'image/webp'],
      ['avif', 'image/avif'],
      ['gif', 'image/gif'],
      ['tiff', 'image/tiff'],
    ] as const)('accepts %s', async (format, mimeType) => {
      const file = await blank()[format]().toBuffer();

      const res = await upload(file, { filename: `photo.${format}` });

      expect(res.statusCode).toBe(201);
      expect(res.json<ImageBody>().mimeType).toBe(mimeType);
    });

    it('trusts the content, not the filename or declared type', async () => {
      const file = await blank().png().toBuffer();

      const res = await upload(file, {
        filename: 'actually-a-png.jpg',
        contentType: 'image/jpeg',
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<ImageBody>().mimeType).toBe('image/png');
    });

    it('sanitizes the filename and keeps it out of the storage key', async () => {
      const res = await upload(await blank().png().toBuffer(), {
        filename: '../../etc/passwd.png',
      });

      const row = await prisma.image.findUniqueOrThrow({
        where: { id: res.json<ImageBody>().id },
      });

      expect(res.statusCode).toBe(201);
      expect(row.originalFilename).toBe('passwd.png');
      expect(row.storageKey).not.toContain('passwd');
    });

    it('reports dimensions as displayed when EXIF rotates the image', async () => {
      const file = await blank()
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const body = (await upload(file)).json<ImageBody>();

      expect(body.width).toBe(30);
      expect(body.height).toBe(40);
    });

    it('allows the same file to be uploaded twice as separate images', async () => {
      const file = await blank().jpeg().toBuffer();

      const first = (await upload(file)).json<ImageBody>();
      const second = (await upload(file)).json<ImageBody>();

      expect(second.id).not.toBe(first.id);
      expect(second.checksum).toBe(first.checksum);
      expect(await listKeys(s3)).toHaveLength(2);
    });

    it('rejects a request that is not multipart with 400 MISSING_FILE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/images',
        payload: { hello: 'world' },
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<Problem>().errorCode).toBe('MISSING_FILE');
    });

    it('rejects a multipart request without a file with 400 MISSING_FILE', async () => {
      const { payload, headers } = buildMultipart([
        { name: 'note', value: 'no file here' },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/images',
        payload,
        headers: { ...headers, authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<Problem>().errorCode).toBe('MISSING_FILE');
    });

    it('rejects a file in the wrong form field with 400 MISSING_FILE', async () => {
      const res = await upload(await blank().png().toBuffer(), {
        field: 'picture',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<Problem>().errorCode).toBe('MISSING_FILE');
    });

    it('rejects a file over the size limit with 413 FILE_TOO_LARGE', async () => {
      const res = await upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61));

      expect(res.statusCode).toBe(413);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(res.json<Problem>().errorCode).toBe('FILE_TOO_LARGE');
    });

    it('accepts a file exactly at the size limit if it is a valid image', async () => {
      // A valid JPEG with trailing padding up to exactly the limit.
      const jpeg = await blank().jpeg().toBuffer();
      const padded = Buffer.concat([
        jpeg,
        Buffer.alloc(MAX_UPLOAD_BYTES - jpeg.length),
      ]);

      const res = await upload(padded);

      expect(res.statusCode).toBe(201);
    });

    it('rejects SVG with 415 UNSUPPORTED_IMAGE_FORMAT', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      );

      const res = await upload(svg, {
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
      });

      expect(res.statusCode).toBe(415);
      expect(res.json<Problem>().errorCode).toBe('UNSUPPORTED_IMAGE_FORMAT');
    });

    it('rejects a non-image with 415 UNSUPPORTED_IMAGE_FORMAT', async () => {
      const res = await upload(Buffer.from('plain text'), {
        filename: 'notes.png',
        contentType: 'image/png',
      });

      expect(res.statusCode).toBe(415);
      expect(res.json<Problem>().errorCode).toBe('UNSUPPORTED_IMAGE_FORMAT');
    });

    it('rejects a truncated image with 422 INVALID_IMAGE', async () => {
      const noisy = await sharp({
        create: {
          width: 300,
          height: 300,
          channels: 3,
          background: '#000000',
          noise: { type: 'gaussian', mean: 128, sigma: 60 },
        },
      })
        .png()
        .toBuffer();

      const res = await upload(
        noisy.subarray(0, Math.floor(noisy.length * 0.6)),
      );

      expect(res.statusCode).toBe(422);
      expect(res.json<Problem>().errorCode).toBe('INVALID_IMAGE');
    });

    it('leaves nothing behind when a file is rejected', async () => {
      await upload(Buffer.from('plain text'));
      await upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61));

      expect(await prisma.image.count()).toBe(0);
      expect(await listKeys(s3)).toEqual([]);
    });

    it('rejects an unsupported request content type with a 4xx problem', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/images',
        payload: await blank().png().toBuffer(),
        headers: {
          'content-type': 'image/png',
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(415);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
    });
  });

  describe('StorageService', () => {
    it('round-trips an object and reports a missing one as null', async () => {
      await storage.put('probe/hello.txt', Buffer.from('hello'), 'text/plain');

      const found = await storage.get('probe/hello.txt');
      const chunks: Buffer[] = [];
      for await (const chunk of found?.body ?? []) {
        chunks.push(chunk as Buffer);
      }

      expect(Buffer.concat(chunks).toString()).toBe('hello');
      expect(found?.contentType).toBe('text/plain');
      expect(await storage.get('probe/missing.txt')).toBeNull();
    });

    it('deletes objects and tolerates deleting a missing one', async () => {
      await storage.put('probe/gone.txt', Buffer.from('x'), 'text/plain');

      await storage.delete('probe/gone.txt');
      await storage.delete('probe/gone.txt');

      expect(await storage.get('probe/gone.txt')).toBeNull();
    });
  });

  describe('readiness', () => {
    it('reports storage as up', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        info: { database: { status: 'up' }, storage: { status: 'up' } },
      });
    });
  });
});
