import type { IncomingMessage } from 'node:http';
import {
  REQUEST_ID_HEADER,
  attachRequestId,
  pinoRequestId,
  resolveRequestId,
} from './request-id.js';

function makeReq(headerValue?: string): IncomingMessage {
  return {
    headers:
      headerValue === undefined ? {} : { [REQUEST_ID_HEADER]: headerValue },
  } as unknown as IncomingMessage;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a well-formed incoming request ID', () => {
    expect(resolveRequestId(makeReq('trace-123.abc:7'))).toBe(
      'trace-123.abc:7',
    );
  });

  it('generates an ID when none is supplied', () => {
    expect(resolveRequestId(makeReq())).toMatch(UUID);
  });

  it('replaces an ID containing unsafe characters', () => {
    expect(resolveRequestId(makeReq('bad id with spaces'))).toMatch(UUID);
  });

  it('replaces an overly long ID', () => {
    expect(resolveRequestId(makeReq('a'.repeat(129)))).toMatch(UUID);
  });
});

describe('pinoRequestId', () => {
  it('prefers the ID attached to the raw request', () => {
    const req = makeReq('from-header');
    attachRequestId(req, 'assigned-by-fastify');

    expect(pinoRequestId(req)).toBe('assigned-by-fastify');
  });

  it('falls back to resolving an ID when none is attached', () => {
    expect(pinoRequestId(makeReq('from-header'))).toBe('from-header');
  });
});
