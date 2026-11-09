import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Runs once per e2e run: starts a throwaway PostgreSQL container, applies the
 * committed migrations, and points DATABASE_URL at it for the test workers.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = container.getConnectionUri();

  process.env.DATABASE_URL = url;

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });

  return async () => {
    await container.stop();
  };
}
