import { sanitizeFilename } from './filename.js';
import { extensionForMimeType } from './inspect-image.js';

// Image extensions people use, mapped to the canonical one we store.
const KNOWN_IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  jpe: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tif: 'tiff',
  tiff: 'tiff',
};

/**
 * The name a downloaded file gets: the sanitized original name, with its
 * extension corrected to match the real format, so a PNG uploaded as
 * "holiday.jpg" downloads as "holiday.png".
 */
export function downloadFilename(
  originalFilename: string,
  mimeType: string,
): string {
  const name = sanitizeFilename(originalFilename);
  const actual = extensionForMimeType(mimeType);
  if (!actual) {
    return name;
  }

  const dot = name.lastIndexOf('.');
  const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const canonical = KNOWN_IMAGE_EXTENSIONS[current];

  if (canonical === actual) {
    return name;
  }
  if (canonical) {
    return sanitizeFilename(`${name.slice(0, dot)}.${actual}`);
  }
  return sanitizeFilename(`${name}.${actual}`);
}

/**
 * A Content-Disposition header value with an ASCII fallback and an RFC 5987
 * `filename*` carrying the real name, so non-ASCII names survive.
 */
export function buildContentDisposition(
  type: 'inline' | 'attachment',
  filename: string,
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
