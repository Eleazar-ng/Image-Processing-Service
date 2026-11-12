import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.schema.js';
import { TokenService } from './token.service.js';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';

function makeJwt(secret = SECRET): JwtService {
  return new JwtService({
    secret,
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  });
}

function makeService(jwt = makeJwt()): TokenService {
  const values = {
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 604_800,
  };
  const config = {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<Env, true>;
  return new TokenService(jwt, config);
}

describe('TokenService access tokens', () => {
  it('round-trips the subject and role', async () => {
    const service = makeService();

    const token = await service.signAccessToken({
      id: 'user-1',
      role: 'ADMIN',
    });
    const claims = await service.verifyAccessToken(token);

    expect(claims).toMatchObject({ sub: 'user-1', role: 'ADMIN' });
  });

  it('exposes the configured lifetime', () => {
    expect(makeService().accessTokenTtlSeconds).toBe(900);
  });

  it('rejects an expired token', async () => {
    const jwt = makeJwt();
    const token = await jwt.signAsync(
      { role: 'USER' },
      { subject: 'user-1', expiresIn: -10 },
    );

    await expect(makeService(jwt).verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = await makeJwt(
      'another-secret-that-is-32-chars-or-more!!',
    ).signAsync({ role: 'ADMIN' }, { subject: 'user-1', expiresIn: 60 });

    await expect(makeService().verifyAccessToken(forged)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const service = makeService();
    const token = await service.signAccessToken({ id: 'user-1', role: 'USER' });
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'ADMIN', exp: 9_999_999_999 }),
    ).toString('base64url');

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signature}`),
    ).rejects.toThrow();
  });

  it('rejects a validly signed token with an unknown role', async () => {
    const jwt = makeJwt();
    const token = await jwt.signAsync(
      { role: 'SUPERUSER' },
      { subject: 'user-1', expiresIn: 60 },
    );

    await expect(makeService(jwt).verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects a validly signed token without a subject', async () => {
    const jwt = makeJwt();
    const token = await jwt.signAsync({ role: 'USER' }, { expiresIn: 60 });

    await expect(makeService(jwt).verifyAccessToken(token)).rejects.toThrow();
  });
});

describe('TokenService refresh tokens', () => {
  const service = makeService();

  it('generates unique 256-bit base64url tokens', () => {
    const a = service.generateRefreshToken();
    const b = service.generateRefreshToken();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically to a hex SHA-256 digest', () => {
    const token = service.generateRefreshToken();

    expect(service.hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hashRefreshToken(token)).toBe(
      service.hashRefreshToken(token),
    );
    expect(service.hashRefreshToken(token)).not.toBe(token);
  });

  it('computes expiry from the configured lifetime', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    expect(service.refreshTokenExpiry(now).toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
  });
});
