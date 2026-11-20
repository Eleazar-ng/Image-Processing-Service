import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { ImagesService } from './images.service.js';

const owner = { id: 'user_1', role: 'USER' } as const;

const row = (n: number) => ({
  id: `img_${String(n)}`,
  ownerId: 'user_1',
  originalFilename: `photo${String(n)}.jpg`,
  storageKey: `users/user_1/images/${String(n)}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 100,
  width: 10,
  height: 5,
  checksum: 'a'.repeat(64),
  createdAt: new Date(Date.UTC(2026, 0, n)),
  deletedAt: null,
});

function setup() {
  const prisma = {
    image: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const service = new ImagesService(
    prisma as unknown as PrismaService,
    {} as unknown as StorageService,
  );
  return { service, prisma };
}

describe('ImagesService.list', () => {
  it('asks for the caller’s undeleted images, newest first, plus one extra row', async () => {
    const { service, prisma } = setup();
    prisma.image.findMany.mockResolvedValue([]);

    await service.list(owner, { limit: 10 });

    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'user_1', deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 11,
    });
  });

  it('returns a cursor when there is another page, and strips internal fields', async () => {
    const { service, prisma } = setup();
    prisma.image.findMany.mockResolvedValue([row(3), row(2), row(1)]);

    const page = await service.list(owner, { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(['img_3', 'img_2']);
    expect(page.items[0]).not.toHaveProperty('storageKey');
    expect(page.items[0]).not.toHaveProperty('ownerId');
    expect(decodeCursor(page.nextCursor as string).id).toBe('img_2');
  });

  it('returns no cursor on the last page', async () => {
    const { service, prisma } = setup();
    prisma.image.findMany.mockResolvedValue([row(2), row(1)]);

    expect((await service.list(owner, { limit: 5 })).nextCursor).toBeNull();
  });

  it('continues after a cursor', async () => {
    const { service, prisma } = setup();
    prisma.image.findMany.mockResolvedValue([]);
    const cursor = encodeCursor({ createdAt: row(2).createdAt, id: 'img_2' });

    await service.list(owner, { limit: 2, cursor });

    expect(prisma.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: 'user_1',
          deletedAt: null,
          OR: [
            { createdAt: { lt: row(2).createdAt } },
            { createdAt: row(2).createdAt, id: { lt: 'img_2' } },
          ],
        },
      }),
    );
  });

  it('rejects a bad cursor before touching the database', async () => {
    const { service, prisma } = setup();

    await expect(
      service.list(owner, { limit: 2, cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.image.findMany).not.toHaveBeenCalled();
  });
});

describe('ImagesService.get and findOwned', () => {
  it('scopes the lookup to the caller and to undeleted images', async () => {
    const { service, prisma } = setup();
    prisma.image.findFirst.mockResolvedValue(row(1));

    const result = await service.get(owner, 'img_1');

    expect(prisma.image.findFirst).toHaveBeenCalledWith({
      where: { id: 'img_1', ownerId: 'user_1', deletedAt: null },
    });
    expect(result.id).toBe('img_1');
    expect(result).not.toHaveProperty('storageKey');
  });

  it('reports a missing image as IMAGE_NOT_FOUND', async () => {
    const { service, prisma } = setup();
    prisma.image.findFirst.mockResolvedValue(null);

    const error = await service.get(owner, 'nope').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      errorCode: 'IMAGE_NOT_FOUND',
    });
  });
});

describe('ImagesService.softDelete', () => {
  it('marks the caller’s undeleted image as deleted in one conditional update', async () => {
    const { service, prisma } = setup();
    prisma.image.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.softDelete(owner, 'img_1')).resolves.toBeUndefined();

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { id: 'img_1', ownerId: 'user_1', deletedAt: null },
      data: { deletedAt: expect.any(Date) as unknown },
    });
  });

  it('answers not found when nothing matched (unknown, foreign, or already deleted)', async () => {
    const { service, prisma } = setup();
    prisma.image.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.softDelete(owner, 'img_1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
