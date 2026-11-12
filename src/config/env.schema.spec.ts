import { envSchema } from './env.schema.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
const JWT_ACCESS_SECRET = 'a-secret-that-is-at-least-32-characters-long';
const required = { DATABASE_URL, JWT_ACCESS_SECRET };

describe('envSchema', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(envSchema.parse(required)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      SWAGGER_ENABLED: true,
      JWT_ACCESS_SECRET,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604_800,
      DATABASE_URL,
    });
  });

  it('requires DATABASE_URL and JWT_ACCESS_SECRET', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(envSchema.safeParse({ DATABASE_URL }).success).toBe(false);
    expect(envSchema.safeParse({ JWT_ACCESS_SECRET }).success).toBe(false);
  });

  it('rejects a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(
      envSchema.safeParse({ ...required, JWT_ACCESS_SECRET: 'too-short' })
        .success,
    ).toBe(false);
  });

  it('coerces token lifetimes from strings', () => {
    const env = envSchema.parse({
      ...required,
      ACCESS_TOKEN_TTL_SECONDS: '60',
      REFRESH_TOKEN_TTL_SECONDS: '3600',
    });

    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(60);
    expect(env.REFRESH_TOKEN_TTL_SECONDS).toBe(3600);
  });

  it('rejects non-positive token lifetimes', () => {
    expect(
      envSchema.safeParse({ ...required, ACCESS_TOKEN_TTL_SECONDS: '0' })
        .success,
    ).toBe(false);
  });

  it('accepts postgres:// and postgresql:// URLs', () => {
    expect(
      envSchema.safeParse({
        ...required,
        DATABASE_URL: 'postgres://u:p@localhost/db',
      }).success,
    ).toBe(true);
    expect(envSchema.safeParse(required).success).toBe(true);
  });

  it('rejects a DATABASE_URL that is not a PostgreSQL URL', () => {
    expect(
      envSchema.safeParse({
        ...required,
        DATABASE_URL: 'mysql://u:p@localhost/db',
      }).success,
    ).toBe(false);
  });

  it('coerces PORT from a string', () => {
    expect(envSchema.parse({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects an out-of-range PORT', () => {
    expect(envSchema.safeParse({ ...required, PORT: '70000' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(
      envSchema.safeParse({ ...required, NODE_ENV: 'staging' }).success,
    ).toBe(false);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(
      envSchema.safeParse({ ...required, LOG_LEVEL: 'verbose' }).success,
    ).toBe(false);
  });

  it('parses SWAGGER_ENABLED from a string boolean', () => {
    expect(
      envSchema.parse({ ...required, SWAGGER_ENABLED: 'false' })
        .SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      envSchema.parse({ ...required, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
  });
});
