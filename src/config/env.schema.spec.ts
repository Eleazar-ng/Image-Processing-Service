import { envSchema } from './env.schema.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5430/db?schema=public';
const JWT_ACCESS_SECRET = 'a-secret-that-is-at-least-32-characters-long';
const storage = {
  STORAGE_ENDPOINT: 'http://localhost:8333',
  STORAGE_BUCKET: 'images',
  STORAGE_ACCESS_KEY_ID: 'access-key',
  STORAGE_SECRET_ACCESS_KEY: 'secret-key',
};
const required = { DATABASE_URL, JWT_ACCESS_SECRET, ...storage };

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
      ...storage,
      STORAGE_REGION: 'auto',
      STORAGE_FORCE_PATH_STYLE: true,
      DATABASE_URL,
    });
  });

  it('requires every mandatory variable', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    for (const key of Object.keys(required)) {
      const { [key as keyof typeof required]: _omitted, ...rest } = required;
      expect(envSchema.safeParse(rest).success, `missing ${key}`).toBe(false);
    }
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

  it('requires STORAGE_ENDPOINT to be a URL', () => {
    expect(
      envSchema.safeParse({ ...required, STORAGE_ENDPOINT: 'not a url' })
        .success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...required,
        STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
      }).success,
    ).toBe(true);
  });

  it('validates STORAGE_BUCKET as a bucket name', () => {
    for (const bad of ['UPPER', 'a', 'has space', '-leading', 'trailing-']) {
      expect(
        envSchema.safeParse({ ...required, STORAGE_BUCKET: bad }).success,
        bad,
      ).toBe(false);
    }
    expect(
      envSchema.safeParse({ ...required, STORAGE_BUCKET: 'my-images.v2' })
        .success,
    ).toBe(true);
  });

  it('parses STORAGE_FORCE_PATH_STYLE from a string boolean', () => {
    expect(
      envSchema.parse({ ...required, STORAGE_FORCE_PATH_STYLE: 'false' })
        .STORAGE_FORCE_PATH_STYLE,
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
