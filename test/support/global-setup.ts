import { execSync } from 'node:child_process';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

const STORAGE_PORT = 8333;
const STORAGE_ACCESS_KEY_ID = 'test-access-key';
const STORAGE_SECRET_ACCESS_KEY = 'test-secret-key-for-e2e';
const STORAGE_BUCKET = 'e2e-images';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the S3 endpoint to answer, then makes sure the bucket exists. */
async function ensureBucket(endpoint: string): Promise<void> {
  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: STORAGE_ACCESS_KEY_ID,
      secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: STORAGE_BUCKET }));
        return;
      } catch (headError) {
        lastError = headError;
        try {
          await client.send(
            new CreateBucketCommand({ Bucket: STORAGE_BUCKET }),
          );
          return;
        } catch (createError) {
          lastError = createError;
          await sleep(1000);
        }
      }
    }
    throw new Error(
      `Storage emulator never became ready: ${String(lastError)}`,
    );
  } finally {
    client.destroy();
  }
}

/**
 * Runs once per e2e run: starts throwaway PostgreSQL and S3-compatible
 * (SeaweedFS) containers, applies the committed migrations, and points the
 * app's environment at them for the test workers.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const [database, storage] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new GenericContainer('chrislusf/seaweedfs:latest')
      .withEnvironment({
        AWS_ACCESS_KEY_ID: STORAGE_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: STORAGE_SECRET_ACCESS_KEY,
        S3_BUCKET: STORAGE_BUCKET,
      })
      .withExposedPorts(STORAGE_PORT)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
  ]);

  const databaseUrl = database.getConnectionUri();
  const storageEndpoint = `http://${storage.getHost()}:${String(
    storage.getMappedPort(STORAGE_PORT),
  )}`;

  process.env.DATABASE_URL = databaseUrl;
  process.env.STORAGE_ENDPOINT = storageEndpoint;
  process.env.STORAGE_REGION = 'auto';
  process.env.STORAGE_BUCKET = STORAGE_BUCKET;
  process.env.STORAGE_ACCESS_KEY_ID = STORAGE_ACCESS_KEY_ID;
  process.env.STORAGE_SECRET_ACCESS_KEY = STORAGE_SECRET_ACCESS_KEY;
  process.env.STORAGE_FORCE_PATH_STYLE = 'true';

  await ensureBucket(storageEndpoint);

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  return async () => {
    await Promise.all([database.stop(), storage.stop()]);
  };
}
