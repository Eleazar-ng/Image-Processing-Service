const MAX_FILENAME_LENGTH = 255;
const MAX_EXTENSION_LENGTH = 16;
const FALLBACK_NAME = 'upload';

function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // control characters
    codePoint === 0x7f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) || // bidi overrides
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * Makes a client-supplied filename safe to store and display: drops any
 * directory part, control and bidirectional-override characters, and caps the
 * length while keeping the extension. The result is metadata only; it is never
 * used to build a storage key.
 */
export function sanitizeFilename(raw: string | undefined): string {
  const base = (raw ?? '').normalize('NFC').split(/[\\/]/).pop() ?? '';

  const cleaned = Array.from(base)
    .filter((char) => !isUnsafeCodePoint(char.codePointAt(0) ?? 0))
    .join('')
    .trim();

  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return FALLBACK_NAME;
  }

  const chars = Array.from(cleaned);
  if (chars.length <= MAX_FILENAME_LENGTH) {
    return cleaned;
  }

  const dot = cleaned.lastIndexOf('.');
  const extension =
    dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH
      ? cleaned.slice(dot)
      : '';
  const stem = Array.from(cleaned.slice(0, dot > 0 ? dot : undefined));
  return (
    stem.slice(0, MAX_FILENAME_LENGTH - extension.length).join('') + extension
  );
}
