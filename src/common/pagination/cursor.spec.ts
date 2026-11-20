import { BadRequestException } from '@nestjs/common';
import { afterCursor, decodeCursor, encodeCursor, toPage } from './cursor.js';

const cursor = {
  createdAt: new Date('2026-03-04T05:06:07.089Z'),
  id: 'cabc123',
};

describe('encodeCursor and decodeCursor', () => {
  it('round-trips, keeping millisecond precision', () => {
    const decoded = decodeCursor(encodeCursor(cursor));

    expect(decoded.id).toBe('cabc123');
    expect(decoded.createdAt.getTime()).toBe(cursor.createdAt.getTime());
  });

  it('produces a URL-safe token', () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 json', '%%%'],
    ['empty payload', Buffer.from('{}').toString('base64url')],
    ['non-json text', Buffer.from('hello').toString('base64url')],
    [
      'bad date',
      Buffer.from(JSON.stringify({ c: 'yesterday', i: 'x' })).toString(
        'base64url',
      ),
    ],
    [
      'missing id',
      Buffer.from(JSON.stringify({ c: '2026-01-01T00:00:00.000Z' })).toString(
        'base64url',
      ),
    ],
    [
      'oversized id',
      Buffer.from(
        JSON.stringify({ c: '2026-01-01T00:00:00.000Z', i: 'x'.repeat(65) }),
      ).toString('base64url'),
    ],
  ])('rejects %s with INVALID_CURSOR', (_label, token) => {
    expect.assertions(2);
    try {
      decodeCursor(token);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        errorCode: 'INVALID_CURSOR',
      });
    }
  });
});

describe('afterCursor', () => {
  it('selects older rows, breaking ties by id', () => {
    expect(afterCursor(cursor)).toEqual({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: 'cabc123' } },
      ],
    });
  });
});

describe('toPage', () => {
  const row = (n: number) => ({
    id: `id${String(n)}`,
    createdAt: new Date(2026, 0, n),
  });

  it('returns everything and no cursor when the rows fit', () => {
    const page = toPage([row(3), row(2)], 5, (r) => r.id);

    expect(page.items).toEqual(['id3', 'id2']);
    expect(page.nextCursor).toBeNull();
  });

  it('returns no cursor when the rows exactly fill the page', () => {
    expect(toPage([row(3), row(2)], 2, (r) => r.id).nextCursor).toBeNull();
  });

  it('drops the extra row and points the cursor at the last kept one', () => {
    const page = toPage([row(3), row(2), row(1)], 2, (r) => r.id);

    expect(page.items).toEqual(['id3', 'id2']);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string)).toMatchObject({
      id: 'id2',
      createdAt: row(2).createdAt,
    });
  });

  it('handles no rows', () => {
    expect(toPage([], 10, (r: ReturnType<typeof row>) => r.id)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
