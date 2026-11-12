import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp, createFastifyAdapter } from '../src/app.setup.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { Roles } from '../src/auth/decorators/roles.decorator.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestPrisma, truncateAll } from './support/database.js';

// Test-only routes to exercise the global guards.
@Controller('test')
class GuardProbeController {
  @Get('public')
  @Public()
  publicRoute() {
    return { ok: true };
  }

  @Get('authenticated')
  authenticatedRoute() {
    return { ok: true };
  }

  @Get('admin')
  @Roles('ADMIN')
  adminRoute() {
    return { ok: true };
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface Session {
  user: { id: string; email: string; role: string; createdAt: string };
  tokens: Tokens;
}

interface Problem {
  status: number;
  errorCode?: string;
  detail?: string;
  errors?: unknown[];
}

const PASSWORD = 'correct-horse-battery';
const PROBLEM_JSON = 'application/problem+json';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [GuardProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
    );
    configureApp(app);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object });

  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const register = (email = 'alice@example.com', password = PASSWORD) =>
    post('/api/v1/auth/register', { email, password });

  const login = (email = 'alice@example.com', password = PASSWORD) =>
    post('/api/v1/auth/login', { email, password });

  const refresh = (refreshToken: string) =>
    post('/api/v1/auth/refresh', { refreshToken });

  const registerOk = async (email?: string): Promise<Session> =>
    (await register(email)).json<Session>();

  describe('POST /auth/register', () => {
    it('creates a USER and returns the profile with tokens', async () => {
      const res = await register('  Alice@Example.COM ');
      const body = res.json<Session>();

      expect(res.statusCode).toBe(201);
      expect(body.user).toMatchObject({
        email: 'alice@example.com',
        role: 'USER',
      });
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body.tokens).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      expect(body.tokens.accessToken).toBeTruthy();
      expect(body.tokens.refreshToken).toBeTruthy();
    });

    it('stores a lowercase email and an Argon2id hash', async () => {
      await register('Alice@Example.COM');

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'alice@example.com' },
      });

      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(user.passwordHash).not.toContain(PASSWORD);
    });

    it('stores only a hash of the refresh token', async () => {
      const { tokens } = await registerOk();

      const stored = await prisma.refreshToken.findFirstOrThrow();

      expect(stored.tokenHash).not.toBe(tokens.refreshToken);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects a duplicate email regardless of case with 409', async () => {
      await register('alice@example.com');

      const res = await register('ALICE@example.com');

      expect(res.statusCode).toBe(409);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(res.json<Problem>().errorCode).toBe('EMAIL_TAKEN');
    });

    it('rejects a password shorter than 12 characters with 400', async () => {
      const res = await register('alice@example.com', 'short');
      const body = res.json<Problem>();

      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(Array.isArray(body.errors)).toBe(true);
    });

    it('rejects an invalid email with 400', async () => {
      const res = await register('not-an-email');

      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing body with 400', async () => {
      const res = await post('/api/v1/auth/register', {});

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with the right credentials', async () => {
      await register();

      const res = await login();
      const body = res.json<Session>();

      expect(res.statusCode).toBe(200);
      expect(body.user.email).toBe('alice@example.com');
      expect(body.tokens.accessToken).toBeTruthy();
    });

    it('normalizes the email on login', async () => {
      await register('alice@example.com');

      expect((await login('  ALICE@Example.com ')).statusCode).toBe(200);
    });

    it('rejects a wrong password with 401', async () => {
      await register();

      const res = await login('alice@example.com', 'wrong-password-123');

      expect(res.statusCode).toBe(401);
      expect(res.json<Problem>().errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      await register();

      const wrongPassword = await login(
        'alice@example.com',
        'wrong-password-123',
      );
      const unknownEmail = await login(
        'nobody@example.com',
        'wrong-password-123',
      );

      expect(unknownEmail.statusCode).toBe(401);
      expect(unknownEmail.json<Problem>().errorCode).toBe(
        'INVALID_CREDENTIALS',
      );
      expect(unknownEmail.json<Problem>().detail).toBe(
        wrongPassword.json<Problem>().detail,
      );
    });

    it('starts a separate session on every login', async () => {
      await register();
      await login();
      await login();

      const families = await prisma.refreshToken.findMany({
        distinct: ['familyId'],
        select: { familyId: true },
      });

      expect(families).toHaveLength(3);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the signed-in user', async () => {
      const { tokens } = await registerOk();

      const res = await get('/api/v1/auth/me', tokens.accessToken);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        email: 'alice@example.com',
        role: 'USER',
      });
      expect(res.json()).not.toHaveProperty('passwordHash');
    });

    it('rejects a missing token with 401', async () => {
      const res = await get('/api/v1/auth/me');

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(res.json<Problem>().errorCode).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed token with 401', async () => {
      const res = await get('/api/v1/auth/me', 'not.a.jwt');

      expect(res.statusCode).toBe(401);
      expect(res.json<Problem>().errorCode).toBe('INVALID_ACCESS_TOKEN');
    });

    it('rejects a refresh token used as an access token', async () => {
      const { tokens } = await registerOk();

      const res = await get('/api/v1/auth/me', tokens.refreshToken);

      expect(res.statusCode).toBe(401);
    });

    it('rejects a valid token whose account no longer exists', async () => {
      const { tokens } = await registerOk();
      await prisma.user.deleteMany();

      const res = await get('/api/v1/auth/me', tokens.accessToken);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token within the same family', async () => {
      const { tokens } = await registerOk();

      const res = await refresh(tokens.refreshToken);
      const next = res.json<{ tokens: Tokens }>().tokens;

      expect(res.statusCode).toBe(200);
      expect(next.refreshToken).not.toBe(tokens.refreshToken);
      expect(next.accessToken).toBeTruthy();

      const rows = await prisma.refreshToken.findMany();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
      expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    });

    it('issues an access token that works', async () => {
      const { tokens } = await registerOk();
      const next = (await refresh(tokens.refreshToken)).json<{
        tokens: Tokens;
      }>();

      const res = await get('/api/v1/auth/me', next.tokens.accessToken);

      expect(res.statusCode).toBe(200);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      const { tokens: first } = await registerOk();
      const second = (await refresh(first.refreshToken)).json<{
        tokens: Tokens;
      }>();

      const replay = await refresh(first.refreshToken);
      const afterReplay = await refresh(second.tokens.refreshToken);

      expect(replay.statusCode).toBe(401);
      expect(replay.json<Problem>().errorCode).toBe('INVALID_REFRESH_TOKEN');
      expect(afterReplay.statusCode).toBe(401);
      expect(
        await prisma.refreshToken.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });

    it('does not touch other sessions when one family is revoked', async () => {
      await register();
      const sessionA = (await login()).json<Session>();
      const sessionB = (await login()).json<Session>();

      const next = (await refresh(sessionA.tokens.refreshToken)).json<{
        tokens: Tokens;
      }>();
      await refresh(sessionA.tokens.refreshToken); // replay revokes A's family

      expect((await refresh(sessionB.tokens.refreshToken)).statusCode).toBe(
        200,
      );
      expect((await refresh(next.tokens.refreshToken)).statusCode).toBe(401);
    });

    it('rejects an unknown token with 401', async () => {
      const res = await refresh('x'.repeat(43));

      expect(res.statusCode).toBe(401);
      expect(res.json<Problem>().errorCode).toBe('INVALID_REFRESH_TOKEN');
    });

    it('rejects an expired token with 401', async () => {
      const { tokens } = await registerOk();
      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await refresh(tokens.refreshToken);

      expect(res.statusCode).toBe(401);
    });

    it('rejects a missing token with 400', async () => {
      const res = await post('/api/v1/auth/refresh', {});

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('ends the session so the refresh token stops working', async () => {
      const { tokens } = await registerOk();

      const res = await post('/api/v1/auth/logout', {
        refreshToken: tokens.refreshToken,
      });

      expect(res.statusCode).toBe(204);
      expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
      expect(
        await prisma.refreshToken.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });

    it('is idempotent for unknown tokens', async () => {
      const res = await post('/api/v1/auth/logout', {
        refreshToken: 'x'.repeat(43),
      });

      expect(res.statusCode).toBe(204);
    });

    it('works without an access token', async () => {
      const { tokens } = await registerOk();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: tokens.refreshToken },
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('global guards', () => {
    it('leaves @Public() routes open', async () => {
      expect((await get('/api/v1/test/public')).statusCode).toBe(200);
    });

    it('protects other routes by default', async () => {
      expect((await get('/api/v1/test/authenticated')).statusCode).toBe(401);
    });

    it('lets any authenticated user into routes without @Roles()', async () => {
      const { tokens } = await registerOk();

      const res = await get('/api/v1/test/authenticated', tokens.accessToken);

      expect(res.statusCode).toBe(200);
    });

    it('keeps health probes public', async () => {
      expect((await get('/health/live')).statusCode).toBe(200);
      expect((await get('/health/ready')).statusCode).toBe(200);
    });

    it('rejects an unauthenticated caller on an admin route with 401', async () => {
      expect((await get('/api/v1/test/admin')).statusCode).toBe(401);
    });

    it('rejects a USER on an admin route with 403', async () => {
      const { tokens } = await registerOk();

      const res = await get('/api/v1/test/admin', tokens.accessToken);

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain(PROBLEM_JSON);
      expect(res.json<Problem>().errorCode).toBe('FORBIDDEN');
    });

    it('admits an ADMIN to an admin route', async () => {
      await register();
      await prisma.user.update({
        where: { email: 'alice@example.com' },
        data: { role: 'ADMIN' },
      });
      const { tokens } = (await login()).json<Session>();

      const res = await get('/api/v1/test/admin', tokens.accessToken);

      expect(res.statusCode).toBe(200);
    });

    it('cannot self-assign a role through registration', async () => {
      const res = await post('/api/v1/auth/register', {
        email: 'mallory@example.com',
        password: PASSWORD,
        role: 'ADMIN',
      });

      expect(res.json<Session>().user.role).toBe('USER');
    });
  });
});
