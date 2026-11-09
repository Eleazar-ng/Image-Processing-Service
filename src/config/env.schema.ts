import { z } from 'zod';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

/**
 * Environment contract for the application. Validated once at startup:
 * the app refuses to boot when a variable is missing or malformed.
 * Variables for later stages (Redis, storage) are added here as the code
 * that needs them is introduced.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SWAGGER_ENABLED: z.stringbool().default(true),
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'DATABASE_URL must be a PostgreSQL connection URL',
    ),
});

export type Env = z.infer<typeof envSchema>;
