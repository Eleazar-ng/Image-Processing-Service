import { buildImageKey } from './storage-key.js';

describe('buildImageKey', () => {
  it('groups by owner and uses the given extension', () => {
    expect(buildImageKey('user123', 'png', 'fixed-id')).toBe(
      'users/user123/images/fixed-id.png',
    );
  });

  it('generates a unique UUID each time', () => {
    const a = buildImageKey('user123', 'jpg');
    const b = buildImageKey('user123', 'jpg');

    expect(a).not.toBe(b);
    expect(a).toMatch(/^users\/user123\/images\/[0-9a-f-]{36}\.jpg$/);
  });
});
