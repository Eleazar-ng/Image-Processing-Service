import { envSchema } from './env.schema.js';

describe('envSchema', () => {
  it('applies defaults for an empty environment', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      SWAGGER_ENABLED: true,
    });
  });

  it('coerces PORT from a string', () => {
    expect(envSchema.parse({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects an out-of-range PORT', () => {
    expect(envSchema.safeParse({ PORT: '70000' }).success).toBe(false);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(envSchema.safeParse({ NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(envSchema.safeParse({ LOG_LEVEL: 'verbose' }).success).toBe(false);
  });

  it('parses SWAGGER_ENABLED from a string boolean', () => {
    expect(envSchema.parse({ SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(
      false,
    );
    expect(envSchema.parse({ SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(
      true,
    );
  });
});
