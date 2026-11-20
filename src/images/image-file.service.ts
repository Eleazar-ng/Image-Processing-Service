import { Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Image } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.service.js';
import {
  buildContentDisposition,
  downloadFilename,
} from './download-filename.js';
import { matchesEtag } from './etag.js';
import { imageNotFound } from './image-errors.js';

/** Streams an original image to the client with caching and download headers. */
@Injectable()
export class ImageFileService {
  private readonly logger = new Logger(ImageFileService.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * Originals never change, so the checksum is a perfect ETag: a client that
   * already has the bytes gets a 304 without us touching storage. The
   * private, no-cache policy still makes every request pass access control.
   */
  async send(
    request: FastifyRequest,
    reply: FastifyReply,
    image: Image,
    download: boolean,
  ): Promise<void> {
    const etag = `"${image.checksum}"`;

    if (matchesEtag(request.headers['if-none-match'], etag)) {
      await reply
        .header('etag', etag)
        .header('cache-control', 'private, no-cache')
        .status(304)
        .send();
      return;
    }

    const object = await this.storage.get(image.storageKey);
    if (!object) {
      this.logger.error(
        { imageId: image.id, storageKey: image.storageKey },
        'Image record exists but its object is missing from storage',
      );
      throw imageNotFound();
    }

    await reply
      .header('content-type', image.mimeType)
      .header('content-length', String(object.contentLength ?? image.sizeBytes))
      .header('etag', etag)
      .header('cache-control', 'private, no-cache')
      .header('x-content-type-options', 'nosniff')
      .header(
        'content-disposition',
        buildContentDisposition(
          download ? 'attachment' : 'inline',
          downloadFilename(image.originalFilename, image.mimeType),
        ),
      )
      .send(object.body);
  }
}
