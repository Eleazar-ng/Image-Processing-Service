import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * Reuses a well-formed incoming request ID (so traces can span services)
 * or generates a new one. Unsafe or oversized values are replaced, never
 * reflected back to the client.
 */
export function resolveRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];

  return typeof incoming === 'string' &&
    incoming.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/** Marks the raw request with the ID Fastify assigned, so pino reuses it. */
export function attachRequestId(req: IncomingMessage, id: string): void {
  (req as RequestWithId).id = id;
}

/** pino's `genReqId`: prefer the ID Fastify assigned, else resolve one. */
export function pinoRequestId(req: IncomingMessage): string {
  const existing = (req as RequestWithId).id;
  return typeof existing === 'string' ? existing : resolveRequestId(req);
}
