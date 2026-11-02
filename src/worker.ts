import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Placeholder so the process stays alive until Stage 7, when BullMQ
  // connections take over that job. Shutdown signals still terminate it.
  setInterval(() => undefined, 60_000);

  app.get(Logger).log('Worker started (no processors registered yet)');
}

await bootstrap();
