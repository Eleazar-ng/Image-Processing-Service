import { randomUUID } from 'node:crypto';

export interface MultipartPart {
  name: string;
  value: Buffer | string;
  filename?: string;
  contentType?: string;
}

/** Builds a multipart/form-data body for Fastify's inject (no extra dependency). */
export function buildMultipart(parts: MultipartPart[]): {
  payload: Buffer;
  headers: { 'content-type': string };
} {
  const boundary = `----e2e-${randomUUID()}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    const lines = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${part.name}"` +
        (part.filename === undefined ? '' : `; filename="${part.filename}"`),
    ];
    if (part.contentType) {
      lines.push(`Content-Type: ${part.contentType}`);
    }
    chunks.push(
      Buffer.from(`${lines.join('\r\n')}\r\n\r\n`),
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
