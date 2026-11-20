import { matchesEtag } from './etag.js';

const etag = '"abc123"';

describe('matchesEtag', () => {
  it('matches an identical ETag', () => {
    expect(matchesEtag('"abc123"', etag)).toBe(true);
  });

  it('matches a weak validator of the same value', () => {
    expect(matchesEtag('W/"abc123"', etag)).toBe(true);
  });

  it('matches one of several candidates', () => {
    expect(matchesEtag('"other", "abc123" , "third"', etag)).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(matchesEtag('*', etag)).toBe(true);
    expect(matchesEtag(' * ', etag)).toBe(true);
  });

  it('does not match a different ETag', () => {
    expect(matchesEtag('"nope"', etag)).toBe(false);
  });

  it('does not match when the header is missing or empty', () => {
    expect(matchesEtag(undefined, etag)).toBe(false);
    expect(matchesEtag('', etag)).toBe(false);
  });
});
