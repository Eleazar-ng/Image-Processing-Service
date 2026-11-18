import { UnauthorizedException } from '@nestjs/common';
import sharp from 'sharp';
import { vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { ImagesService } from './images.service.js';

const owner = { id: 'user_1', role: 'USER' } as const;

async function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 10, channels: 3, background: '#aa5500' },
  })
    .jpeg()
    .toBuffer();
}

function setup() {
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    image: {
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'image_1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
          ...args.data,
        }),
      ),
    },
  };
  const service = new ImagesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { service, storage, prisma };
}

describe('ImagesService.upload', () => {
  it('stores the original, records it, and returns safe fields only', async () => {
    const { service, storage, prisma } = setup();
    const buffer = await jpeg();

    const result = await service.upload(owner, {
      buffer,
      filename: '../holiday.jpg',
    });

    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = storage.put.mock.calls[0] as [
      string,
      Buffer,
      string,
    ];
    expect(key).toMatch(/^users\/user_1\/images\/[0-9a-f-]{36}\.jpg$/);
    expect(body).toBe(buffer);
    expect(contentType).toBe('image/jpeg');

    expect(prisma.image.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'user_1',
        originalFilename: 'holiday.jpg',
        storageKey: key,
        mimeType: 'image/jpeg',
        sizeBytes: buffer.length,
        width: 20,
        height: 10,
      }) as unknown,
    });

    expect(result).toMatchObject({
      id: 'image_1',
      originalFilename: 'holiday.jpg',
      mimeType: 'image/jpeg',
      width: 20,
      height: 10,
    });
    expect(result).not.toHaveProperty('storageKey');
    expect(result).not.toHaveProperty('ownerId');
  });

  it('stores and records nothing for an invalid image', async () => {
    const { service, storage, prisma } = setup();

    await expect(
      service.upload(owner, {
        buffer: Buffer.from('not an image'),
        filename: 'x.png',
      }),
    ).rejects.toThrow();

    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it('does not record anything when storing fails', async () => {
    const { service, storage, prisma } = setup();
    storage.put.mockRejectedValue(new Error('storage down'));

    await expect(
      service.upload(owner, { buffer: await jpeg(), filename: 'a.jpg' }),
    ).rejects.toThrow('storage down');

    expect(prisma.image.create).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes the stored object when the record cannot be saved', async () => {
    const { service, storage, prisma } = setup();
    prisma.image.create.mockRejectedValue(new Error('database down'));

    await expect(
      service.upload(owner, { buffer: await jpeg(), filename: 'a.jpg' }),
    ).rejects.toThrow('database down');

    const [storedKey] = storage.put.mock.calls[0] as [string];
    expect(storage.delete).toHaveBeenCalledWith(storedKey);
  });

  it('surfaces the original error even if the compensating delete fails', async () => {
    const { service, storage, prisma } = setup();
    prisma.image.create.mockRejectedValue(new Error('database down'));
    storage.delete.mockRejectedValue(new Error('delete failed'));

    await expect(
      service.upload(owner, { buffer: await jpeg(), filename: 'a.jpg' }),
    ).rejects.toThrow('database down');
  });

  it('reports a deleted account as 401 and cleans up', async () => {
    const { service, storage, prisma } = setup();
    prisma.image.create.mockRejectedValue(
      Object.assign(new Error('fk'), { code: 'P2003' }),
    );

    await expect(
      service.upload(owner, { buffer: await jpeg(), filename: 'a.jpg' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});
