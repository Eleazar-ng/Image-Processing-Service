import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestPrisma, truncateAll } from './support/database.js';

describe('Database schema (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const makeUser = (email = 'alice@example.com') =>
    prisma.user.create({ data: { email, passwordHash: 'hash' } });

  const makeImage = (ownerId: string, storageKey = 'images/one') =>
    prisma.image.create({
      data: {
        ownerId,
        originalFilename: 'photo.jpg',
        storageKey,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 800,
        height: 600,
        checksum: 'a'.repeat(64),
      },
    });

  describe('User', () => {
    it('applies defaults', async () => {
      const user = await makeUser();

      expect(user.id).toMatch(/^c[a-z0-9]{20,}$/);
      expect(user.role).toBe('USER');
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it('rejects a duplicate email', async () => {
      await makeUser('dup@example.com');

      await expect(makeUser('dup@example.com')).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  describe('RefreshToken', () => {
    it('is deleted together with its user', async () => {
      const user = await makeUser();
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: 'token-hash',
          familyId: 'family-1',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      expect(await prisma.refreshToken.count()).toBe(0);
    });

    it('rejects a duplicate token hash', async () => {
      const user = await makeUser();
      const data = {
        userId: user.id,
        tokenHash: 'same-hash',
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 60_000),
      };
      await prisma.refreshToken.create({ data });

      await expect(prisma.refreshToken.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  describe('Image', () => {
    it('blocks deleting a user who still owns images', async () => {
      const user = await makeUser();
      await makeImage(user.id);

      await expect(
        prisma.user.delete({ where: { id: user.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rejects a duplicate storage key', async () => {
      const user = await makeUser();
      await makeImage(user.id, 'images/same');

      await expect(makeImage(user.id, 'images/same')).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('supports soft delete through deletedAt', async () => {
      const user = await makeUser();
      const image = await makeImage(user.id);
      expect(image.deletedAt).toBeNull();

      const deleted = await prisma.image.update({
        where: { id: image.id },
        data: { deletedAt: new Date() },
      });

      expect(deleted.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('ImageVariant', () => {
    it('starts PENDING with empty output fields', async () => {
      const user = await makeUser();
      const image = await makeImage(user.id);

      const variant = await prisma.imageVariant.create({
        data: {
          imageId: image.id,
          cacheKey: 'cache-key-1',
          operations: [{ type: 'resize', width: 100 }],
        },
      });

      expect(variant.status).toBe('PENDING');
      expect(variant.storageKey).toBeNull();
      expect(variant.completedAt).toBeNull();
    });

    it('rejects a duplicate cache key', async () => {
      const user = await makeUser();
      const image = await makeImage(user.id);
      const data = {
        imageId: image.id,
        cacheKey: 'same-key',
        operations: [{ type: 'rotate', degrees: 90 }],
      };
      await prisma.imageVariant.create({ data });

      await expect(prisma.imageVariant.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('is deleted together with its image', async () => {
      const user = await makeUser();
      const image = await makeImage(user.id);
      await prisma.imageVariant.create({
        data: {
          imageId: image.id,
          cacheKey: 'cache-key-2',
          operations: [{ type: 'flip' }],
        },
      });

      await prisma.image.delete({ where: { id: image.id } });

      expect(await prisma.imageVariant.count()).toBe(0);
    });
  });
});
