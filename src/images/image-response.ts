import type { Image } from '../generated/prisma/client.js';

/** The fields of an image that are safe to return from the API. */
export interface ImageResponse {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  createdAt: Date;
}

export function toImageResponse(image: Image): ImageResponse {
  return {
    id: image.id,
    originalFilename: image.originalFilename,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    checksum: image.checksum,
    createdAt: image.createdAt,
  };
}
