/**
 * Whether an `If-None-Match` header matches an ETag. Weak validators and the
 * wildcard are honored; the comparison is the weak one HTTP prescribes here.
 */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) {
    return false;
  }
  if (header.trim() === '*') {
    return true;
  }
  return header
    .split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}
