import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../../config/env.schema.js';
import { pinoRequestId } from './request-id.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDevelopment =
          config.get('NODE_ENV', { infer: true }) === 'development';

        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: pinoRequestId,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.refreshToken',
              ],
              censor: '[REDACTED]',
            },
            autoLogging: {
              ignore: (req) => req.url?.startsWith('/health') ?? false,
            },
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}
