import {
  loginSchema,
  passwordSchema,
  refreshTokenSchema,
  registerSchema,
} from './auth.schemas.js';

const PASSWORD = 'correct-horse-battery';

describe('registerSchema', () => {
  it('trims and lowercases the email', () => {
    const result = registerSchema.parse({
      email: '  Alice@Example.COM ',
      password: PASSWORD,
    });

    expect(result.email).toBe('alice@example.com');
  });

  it('rejects an invalid email', () => {
    expect(
      registerSchema.safeParse({ email: 'not-an-email', password: PASSWORD })
        .success,
    ).toBe(false);
  });

  it('rejects an overly long email', () => {
    const email = `${'a'.repeat(250)}@example.com`;

    expect(
      registerSchema.safeParse({ email, password: PASSWORD }).success,
    ).toBe(false);
  });

  it('does not alter the password', () => {
    const password = '  spaces are kept  ';

    expect(
      registerSchema.parse({ email: 'a@example.com', password }).password,
    ).toBe(password);
  });
});

describe('passwordSchema', () => {
  it('accepts 12 to 128 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('rejects fewer than 12 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('rejects more than 128 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('does not require character classes', () => {
    expect(passwordSchema.safeParse('alllowercaseletters').success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('accepts any non-empty password up to 128 characters', () => {
    expect(
      loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success,
    ).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(
      loginSchema.safeParse({ email: 'a@example.com', password: '' }).success,
    ).toBe(false);
  });

  it('normalizes the email like registration does', () => {
    expect(
      loginSchema.parse({ email: ' A@Example.com', password: 'x' }).email,
    ).toBe('a@example.com');
  });
});

describe('refreshTokenSchema', () => {
  it('requires a non-empty token', () => {
    expect(refreshTokenSchema.safeParse({ refreshToken: '' }).success).toBe(
      false,
    );
    expect(refreshTokenSchema.safeParse({}).success).toBe(false);
    expect(refreshTokenSchema.safeParse({ refreshToken: 'abc' }).success).toBe(
      true,
    );
  });
});
