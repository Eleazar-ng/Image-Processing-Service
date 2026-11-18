import {
  RequestMethod,
  StandardSchemaValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { Logger } from 'nestjs-pino';
import {
  REQUEST_ID_HEADER,
  attachRequestId,
  resolveRequestId,
} from './common/logging/request-id.js';
import { setupSwagger } from './common/swagger/setup-swagger.js';
import { MAX_UPLOAD_BYTES } from './images/upload.constants.js';
import type { Env } from './config/env.schema.js';
import { IncomingMessage } from 'node:http';

export const API_PREFIX = 'api';
export const DEFAULT_API_VERSION = '1';

/**
 * Fastify adapter that assigns every request an ID: a well-formed incoming
 * `x-request-id` is reused, otherwise one is generated. Validation lives in
 * `resolveRequestId`, so the header is never trusted blindly.
 */
export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    requestIdHeader: false,
    genReqId: (req: IncomingMessage) => resolveRequestId(req),
  });
}

/**
 * Shared application configuration. Used by the real bootstrap (main.ts)
 * and by e2e tests so tests exercise the same setup as production.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));

  // Echo the request ID on every response. A Fastify hook (rather than Nest
  // middleware) covers all routes, including those outside the /api prefix.
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('onRequest', (request, reply, done) => {
    attachRequestId(request.raw, request.id);
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  // Routes live under /api/v1/...; health probes stay unversioned.
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: DEFAULT_API_VERSION,
  });

  // Multipart parsing for uploads. The size limit is enforced while streaming,
  // so an oversized file is rejected without being read in full.
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 11 },
  });

  // Validates request input against the Zod schemas attached to route decorators.
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app);
  }
}
