import { randomUUID } from 'node:crypto';

/**
 * Where an original image lives in object storage. Grouped by owner, never
 * reused, and built only from server-controlled values: the user ID, a random
 * UUID, and an extension taken from the detected format.
 */
export function buildImageKey(
  userId: string,
  extension: string,
  id: string = randomUUID(),
): string {
  return `users/${userId}/images/${id}.${extension}`;
}
