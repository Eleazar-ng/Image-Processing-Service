import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

const cursorPayloadSchema = z.object({
  c: z.iso.datetime(),
  i: z.string().min(1).max(64),
});

/** An opaque token: base64url of the last row's (createdAt, id). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString('base64url');
}

/** Throws 400 INVALID_CURSOR for anything that is not a token we issued. */
export function decodeCursor(token: string): Cursor {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    );
    const { c, i } = cursorPayloadSchema.parse(json);
    return { createdAt: new Date(c), id: i };
  } catch {
    throw new BadRequestException('Invalid cursor.', {
      errorCode: 'INVALID_CURSOR',
    });
  }
}

/**
 * The `where` fragment selecting the rows that come after a cursor when
 * ordering by (createdAt desc, id desc). Ties on createdAt are broken by id,
 * so no row is skipped or repeated.
 */
export function afterCursor(cursor: Cursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only signals that
 * another page exists.
 */
export function toPage<Row extends Cursor, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
): Page<Item> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    items: pageRows.map(map),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
