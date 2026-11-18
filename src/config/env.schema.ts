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
 * Variables for later stages (Redis) are added here as the code that needs
 * them is introduced.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SWAGGER_ENABLED: z.stringbool().default(true),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(604_800),
  // S3-compatible object storage: Cloudflare R2 in production, SeaweedFS locally.
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default('auto'),
  STORAGE_BUCKET: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
      'STORAGE_BUCKET must be a valid bucket name',
    ),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  // Path-style addressing works with R2 and with local emulators.
  STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'DATABASE_URL must be a PostgreSQL connection URL',
    ),
});

export type Env = z.infer<typeof envSchema>;
