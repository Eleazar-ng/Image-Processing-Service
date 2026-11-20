import { NotFoundException } from '@nestjs/common';

/**
 * Used for unknown, deleted, and other people's images alike, so a response
 * never confirms that someone else's image ID exists.
 */
export function imageNotFound(): NotFoundException {
  return new NotFoundException('Image not found', {
    errorCode: 'IMAGE_NOT_FOUND',
  });
}
