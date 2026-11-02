import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/**
 * Serves the Swagger UI at /docs and the OpenAPI document at /docs-json.
 *
 * Request schemas are Zod schemas passed to route decorators (Standard
 * Schema). Zod 4.2+ converts to OpenAPI natively; if an older Zod is ever
 * used, supply `standardSchemaConverter` in the document options.
 * The document is built lazily on first request.
 */
export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Image Processing Service')
    .setDescription('Upload, transform, and retrieve images.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(SWAGGER_PATH, app, () =>
    SwaggerModule.createDocument(app, config),
  );
}
