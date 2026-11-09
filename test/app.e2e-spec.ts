import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp, createFastifyAdapter } from '../src/app.setup.js';

describe('App (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
    );
    configureApp(app);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('reports the process as alive', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('reports the database as up', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' } },
      });
    });
  });

  describe('request IDs', () => {
    it('echoes a well-formed incoming request ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': 'test-request-id' },
      });

      expect(res.headers['x-request-id']).toBe('test-request-id');
    });

    it('generates a request ID when none is supplied', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('replaces an unsafe incoming request ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': 'not safe!' },
      });

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sets the header on routes under the API prefix too', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });

      expect(typeof res.headers['x-request-id']).toBe('string');
    });
  });

  describe('error handling', () => {
    it('returns RFC 9457 problem details for unknown routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/nope',
        headers: { 'x-request-id': 'problem-test' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        instance: '/api/v1/nope',
        requestId: 'problem-test',
      });
    });
  });

  describe('OpenAPI', () => {
    it('serves the OpenAPI document', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs-json' });
      const doc = res.json<{ openapi: string; paths: Record<string, unknown> }>();

      expect(res.statusCode).toBe(200);
      expect(doc.openapi).toMatch(/^3\./);
      expect(Object.keys(doc.paths)).toEqual(
        expect.arrayContaining(['/health/live', '/health/ready']),
      );
    });
  });
});
