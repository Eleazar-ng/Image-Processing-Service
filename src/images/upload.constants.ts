/** Maximum upload size: 10 MiB (D-026). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Pixel-count ceiling that guards against decompression bombs (D-027). */
export const MAX_INPUT_PIXELS = 50_000_000;

/** The multipart field that carries the file. */
export const UPLOAD_FIELD_NAME = 'file';
