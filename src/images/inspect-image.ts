import { createHash } from 'node:crypto';
import {
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { MAX_INPUT_PIXELS } from './upload.constants.js';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff';

const FORMATS: Record<ImageFormat, { mimeType: string; extension: string }> = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  avif: { mimeType: 'image/avif', extension: 'avif' },
  gif: { mimeType: 'image/gif', extension: 'gif' },
  tiff: { mimeType: 'image/tiff', extension: 'tiff' },
};

export interface ImageInfo {
  format: ImageFormat;
  mimeType: string;
  extension: string;
  /** As displayed: EXIF rotation is already applied (D-029). */
  width: number;
  height: number;
  sizeBytes: number;
  /** SHA-256 of the original bytes, hex-encoded. */
  checksum: string;
}

const UNSUPPORTED_MESSAGE =
  'Unsupported image format. Accepted formats: JPEG, PNG, WebP, AVIF, GIF, TIFF.';

function unsupported(): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException(UNSUPPORTED_MESSAGE, {
    errorCode: 'UNSUPPORTED_IMAGE_FORMAT',
  });
}

function invalid(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException(message, {
    errorCode: 'INVALID_IMAGE',
  });
}

function tooManyPixels(maxPixels: number): UnprocessableEntityException {
  return invalid(
    `The image exceeds the ${String(maxPixels / 1_000_000)} megapixel limit.`,
  );
}

/** Maps a Sharp error to the right HTTP error. */
function classify(error: unknown, maxPixels: number): Error {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('unsupported image format')) {
    return unsupported();
  }
  if (message.includes('pixel limit')) {
    return tooManyPixels(maxPixels);
  }
  return invalid('The file could not be read as an image.');
}

function detectFormat(metadata: Metadata): ImageFormat | null {
  switch (metadata.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
    case 'tiff':
      return metadata.format;
    case 'heif':
      // AVIF is HEIF with AV1. HEIC (HEVC) is deliberately not supported (D-026).
      return metadata.compression === 'av1' ? 'avif' : null;
    default:
      return null;
  }
}

/**
 * Validates an upload by its real content, never by its filename or declared
 * type: the format must be on the allowlist, the pixel count under the
 * ceiling, and the image must fully decode. Throws HTTP exceptions with
 * stable error codes.
 */
export async function inspectImage(
  buffer: Buffer,
  { maxPixels = MAX_INPUT_PIXELS }: { maxPixels?: number } = {},
): Promise<ImageInfo> {
  const open = () =>
    sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error' });

  let metadata: Metadata;
  try {
    metadata = await open().metadata();
  } catch (error) {
    throw classify(error, maxPixels);
  }

  const format = detectFormat(metadata);
  if (!format) {
    throw unsupported();
  }

  // For animated images the height can span all frames; use one frame's.
  const rawWidth = metadata.width;
  const rawHeight = metadata.pageHeight ?? metadata.height;
  if (!rawWidth || !rawHeight) {
    throw invalid('The image has no readable dimensions.');
  }
  if (rawWidth * rawHeight > maxPixels) {
    throw tooManyPixels(maxPixels);
  }

  // Decode the whole image once, so a truncated or corrupt file is rejected
  // now and never reaches storage.
  try {
    await open().resize(1, 1, { fit: 'fill' }).raw().toBuffer();
  } catch (error) {
    throw classify(error, maxPixels);
  }

  // EXIF orientations 5 to 8 are rotated by 90 degrees when displayed.
  const rotated = (metadata.orientation ?? 1) >= 5;

  return {
    format,
    ...FORMATS[format],
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
    sizeBytes: buffer.length,
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}
