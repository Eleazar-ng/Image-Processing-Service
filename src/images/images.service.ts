import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { isForeignKeyViolation } from '../common/database/prisma-errors.js';
import {
  type Page,
  afterCursor,
  decodeCursor,
  toPage,
} from '../common/pagination/cursor.js';
import type { PaginationQuery } from '../common/pagination/pagination.schemas.js';
import type { Image } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { sanitizeFilename } from './filename.js';
import { imageNotFound } from './image-errors.js';
import { type ImageResponse, toImageResponse } from './image-response.js';
import { inspectImage } from './inspect-image.js';
import { buildImageKey } from './storage-key.js';

export interface UploadedFile {
  buffer: Buffer;
  filename: string | undefined;
}

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Validates the file, stores the original untouched, then records it. The
   * object is written first; if the record cannot be saved the object is
   * deleted again, so a failed upload leaves nothing behind. A crash between
   * the two steps can still orphan an object, which a later cleanup job removes.
   */
  async upload(owner: AuthUser, file: UploadedFile): Promise<ImageResponse> {
    const info = await inspectImage(file.buffer);
    const storageKey = buildImageKey(owner.id, info.extension);

    await this.storage.put(storageKey, file.buffer, info.mimeType);

    try {
      const image = await this.prisma.image.create({
        data: {
          ownerId: owner.id,
          originalFilename: sanitizeFilename(file.filename),
          storageKey,
          mimeType: info.mimeType,
          sizeBytes: info.sizeBytes,
          width: info.width,
          height: info.height,
          checksum: info.checksum,
        },
      });
      return toImageResponse(image);
    } catch (error) {
      await this.discard(storageKey);

      if (isForeignKeyViolation(error)) {
        throw new UnauthorizedException('Account no longer exists', {
          errorCode: 'INVALID_ACCESS_TOKEN',
        });
      }
      throw error;
    }
  }

  /** The caller's own images, newest first. Deleted images are excluded. */
  async list(
    owner: AuthUser,
    { limit, cursor }: PaginationQuery,
  ): Promise<Page<ImageResponse>> {
    // Decode first so a bad cursor fails before any database work.
    const after = cursor ? afterCursor(decodeCursor(cursor)) : {};

    const rows = await this.prisma.image.findMany({
      where: { ownerId: owner.id, deletedAt: null, ...after },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    return toPage(rows, limit, toImageResponse);
  }

  async get(owner: AuthUser, id: string): Promise<ImageResponse> {
    return toImageResponse(await this.findOwned(owner, id));
  }

  /**
   * The image row, if it belongs to the caller and is not deleted. Everything
   * else is "not found", so another user's IDs are never confirmed.
   */
  async findOwned(owner: AuthUser, id: string): Promise<Image> {
    const image = await this.prisma.image.findFirst({
      where: { id, ownerId: owner.id, deletedAt: null },
    });
    if (!image) {
      throw imageNotFound();
    }
    return image;
  }

  /**
   * Soft delete (D-028). One conditional update, so a double delete is
   * answered "not found" the second time and nothing races. The stored object
   * and any variants stay until the cleanup job removes them.
   */
  async softDelete(owner: AuthUser, id: string): Promise<void> {
    const { count } = await this.prisma.image.updateMany({
      where: { id, ownerId: owner.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) {
      throw imageNotFound();
    }
  }

  /** Best-effort compensation: never masks the error that caused it. */
  private async discard(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.error(
        { err: error, storageKey },
        'Failed to delete an orphaned object; the cleanup job will remove it',
      );
    }
  }
}
