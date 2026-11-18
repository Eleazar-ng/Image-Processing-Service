import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { isForeignKeyViolation } from '../common/database/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { sanitizeFilename } from './filename.js';
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
