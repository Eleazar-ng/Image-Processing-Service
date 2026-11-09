import { envSchema } from './env.schema.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';

describe('envSchema', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(envSchema.parse({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      SWAGGER_ENABLED: true,
      DATABASE_URL,
    });
  });

  it('requires DATABASE_URL', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
  });

  it('accepts postgres:// and postgresql:// URLs', () => {
    expect(
      envSchema.safeParse({ DATABASE_URL: 'postgres://u:p@localhost/db' })
        .success,
    ).toBe(true);
    expect(envSchema.safeParse({ DATABASE_URL }).success).toBe(true);
  });

  it('rejects a DATABASE_URL that is not a PostgreSQL URL', () => {
    expect(
      envSchema.safeParse({ DATABASE_URL: 'mysql://u:p@localhost/db' }).success,
    ).toBe(false);
  });

  it('coerces PORT from a string', () => {
    expect(envSchema.parse({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects an out-of-range PORT', () => {
    expect(envSchema.safeParse({ DATABASE_URL, PORT: '70000' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(
      envSchema.safeParse({ DATABASE_URL, NODE_ENV: 'staging' }).success,
    ).toBe(false);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(
      envSchema.safeParse({ DATABASE_URL, LOG_LEVEL: 'verbose' }).success,
    ).toBe(false);
  });

  it('parses SWAGGER_ENABLED from a string boolean', () => {
    expect(
      envSchema.parse({ DATABASE_URL, SWAGGER_ENABLED: 'false' })
        .SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      envSchema.parse({ DATABASE_URL, SWAGGER_ENABLED: 'true' })
        .SWAGGER_ENABLED,
    ).toBe(true);
  });
});
