import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id', async () => {
    const hash = await service.hash('correct-horse-battery');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the right password', async () => {
    const hash = await service.hash('correct-horse-battery');

    expect(await service.verify(hash, 'correct-horse-battery')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await service.hash('correct-horse-battery');

    expect(await service.verify(hash, 'wrong-horse-battery')).toBe(false);
  });

  it('salts every hash differently', async () => {
    const a = await service.hash('correct-horse-battery');
    const b = await service.hash('correct-horse-battery');

    expect(a).not.toBe(b);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('can verify against the dummy hash without throwing', async () => {
    await expect(
      service.verifyAgainstDummy('anything'),
    ).resolves.toBeUndefined();
  });
});
