/**
 * Checks that the S3-compatible storage (SeaweedFS locally, R2 in production)
 * is reachable and usable, one step at a time, with a hint for each failure.
 *
 * Reads the same STORAGE_* settings as the app (from the environment or .env).
 *
 *   pnpm storage:check
 *   pnpm storage:check --create-bucket   create the bucket if it is missing
 *   pnpm storage:check --timeout=10000   per-step timeout in milliseconds
 *
 * Exits with code 0 when every step passes, 1 otherwise.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { z } from 'zod';

const configSchema = z.object({
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default('auto'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
});

const args = process.argv.slice(2);
const shouldCreateBucket = args.includes('--create-bucket');
const timeoutMs = readTimeout(args);

function readTimeout(argv: string[]): number {
  const raw = argv.find((arg) => arg.startsWith('--timeout='))?.split('=')[1];
  const value = raw === undefined ? 5000 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

const out = (line = '') => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------- errors

interface ErrorDetails {
  name: string;
  message: string;
  code?: string;
  status?: number;
}

function errorDetails(error: unknown): ErrorDetails {
  const e = error as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string };
    errors?: { code?: string }[];
    $metadata?: { httpStatusCode?: number };
  };
  return {
    name: e?.name ?? 'Error',
    message: e?.message ?? String(error),
    // Node can nest the system error code in `cause` or in an AggregateError.
    code: e?.code ?? e?.cause?.code ?? e?.errors?.[0]?.code,
    status: e?.$metadata?.httpStatusCode,
  };
}

function hintsFor(details: ErrorDetails, endpoint: string): string[] {
  const { name, code, status } = details;

  if (code === 'ECONNREFUSED') {
    return [
      `Nothing is listening at ${endpoint}. Is the storage container running?`,
      '  docker compose up -d storage',
      '  docker compose ps storage',
      '  docker compose logs --tail 50 storage',
      'Also check that STORAGE_PORT in .env matches the port in STORAGE_ENDPOINT.',
    ];
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return [
      'The hostname in STORAGE_ENDPOINT could not be resolved.',
      'For the local container use http://localhost:8333.',
    ];
  }
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return [
      `No answer within ${String(timeoutMs)} ms. Try a longer --timeout=15000.`,
      'A freshly started container can take a few seconds to open its S3 port.',
      'Otherwise check the port mapping and any firewall or VPN in between.',
    ];
  }
  if (
    status === 403 ||
    ['Forbidden', 'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(name)
  ) {
    return [
      'The server is up but rejected the credentials.',
      'STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must equal the values the',
      'container was started with (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY).',
      'If you changed them in .env, recreate it so it picks them up:',
      '  docker compose up -d --force-recreate storage',
      'For Cloudflare R2, check the API token has object read and write access.',
    ];
  }
  if (status === 404 || name === 'NoSuchBucket' || name === 'NotFound') {
    return [
      'The bucket does not exist. The local container creates STORAGE_BUCKET at start;',
      'if you changed the name, recreate the container, or let this script create it:',
      '  pnpm storage:check --create-bucket',
    ];
  }
  return [
    'Unexpected error. The container logs usually say why:',
    '  docker compose logs --tail 50 storage',
  ];
}

// ----------------------------------------------------------------- runner

let failed = false;
let skipRest = false;

async function step(
  title: string,
  fn: () => Promise<string | void>,
  endpoint: string,
): Promise<boolean> {
  if (skipRest) {
    out(`[SKIP] ${title}`);
    return false;
  }

  const started = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - started);
    out(`[ OK ] ${title} (${String(ms)} ms)${detail ? `: ${detail}` : ''}`);
    return true;
  } catch (error) {
    const details = errorDetails(error);
    const label = [details.name, details.code, details.status]
      .filter((part) => part !== undefined)
      .join(' / ');
    out(`[FAIL] ${title}`);
    out(`       ${label}: ${details.message}`);
    for (const hint of hintsFor(details, endpoint)) {
      out(`       ${hint}`);
    }
    failed = true;
    skipRest = true;
    return false;
  }
}

// ------------------------------------------------------------------ checks

function connect(address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error(`timed out after ${String(timeoutMs)} ms`), { name: 'TimeoutError' }));
    });
    socket.once('error', (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function main(): Promise<void> {
  out('Storage reachability check');
  out('==========================');

  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    out('[FAIL] Configuration');
    out(z.prettifyError(parsed.error).replace(/^/gm, '       '));
    out('       Set the STORAGE_* variables (see .env.example).');
    process.exitCode = 1;
    return;
  }
  const config = parsed.data;
  const url = new URL(config.STORAGE_ENDPOINT);
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);

  out(`endpoint   ${config.STORAGE_ENDPOINT}`);
  out(`bucket     ${config.STORAGE_BUCKET}`);
  out(`region     ${config.STORAGE_REGION}`);
  out(`path style ${String(config.STORAGE_FORCE_PATH_STYLE)}`);
  out(`access key ${config.STORAGE_ACCESS_KEY_ID.slice(0, 4)}... (secret not shown)`);
  out(`timeout    ${String(timeoutMs)} ms per step`);
  out();

  if (!config.STORAGE_FORCE_PATH_STYLE && url.hostname === 'localhost') {
    out('[WARN] STORAGE_FORCE_PATH_STYLE=false with a localhost endpoint usually fails');
    out('       (the bucket becomes part of the hostname). Set it to true locally.');
    out();
  }

  // 1. Network: can we open a TCP connection?
  await step(
    `TCP connection to ${url.hostname}:${String(port)}`,
    async () => {
      const addresses = await dns.lookup(url.hostname, { all: true });
      const results: string[] = [];
      let connected = false;
      let lastError: unknown;
      for (const { address } of addresses) {
        try {
          await connect(address, port);
          results.push(`${address} reachable`);
          connected = true;
        } catch (error) {
          lastError = error;
          results.push(`${address} ${errorDetails(error).code ?? 'failed'}`);
        }
      }
      if (!connected) {
        throw lastError ?? new Error('no addresses resolved');
      }
      return results.join(', ');
    },
    config.STORAGE_ENDPOINT,
  );

  // 2. HTTP: does something answer HTTP there?
  await step(
    'HTTP response from the endpoint',
    async () => {
      const response = await fetch(config.STORAGE_ENDPOINT, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const server = response.headers.get('server');
      return `status ${String(response.status)}${server ? `, server ${server}` : ''} (any status means it is reachable; 403 is normal without credentials)`;
    },
    config.STORAGE_ENDPOINT,
  );

  // 3. S3 API: signed requests with the configured credentials.
  const client = new S3Client({
    region: config.STORAGE_REGION,
    endpoint: config.STORAGE_ENDPOINT,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
    },
    // Same settings as the app: R2 rejects the SDK's default extra checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // Fail fast instead of retrying, so problems show up immediately.
    maxAttempts: 1,
  });
  const options = () => ({ abortSignal: AbortSignal.timeout(timeoutMs) });
  const bucket = config.STORAGE_BUCKET;
  const key = `healthcheck/${randomUUID()}.txt`;
  const payload = `storage check ${new Date().toISOString()}`;

  try {
    await step(
      `Credentials accepted and bucket "${bucket}" exists`,
      async () => {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }), options());
          return 'bucket found';
        } catch (error) {
          const { status, name } = errorDetails(error);
          const missing = status === 404 || name === 'NotFound' || name === 'NoSuchBucket';
          if (!missing || !shouldCreateBucket) {
            throw error;
          }
          await client.send(new CreateBucketCommand({ Bucket: bucket }), options());
          return 'bucket was missing, created it';
        }
      },
      config.STORAGE_ENDPOINT,
    );

    await step(
      'Write an object',
      async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from(payload),
            ContentType: 'text/plain',
          }),
          options(),
        );
        return key;
      },
      config.STORAGE_ENDPOINT,
    );

    await step(
      'Read it back',
      async () => {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          options(),
        );
        const body = await response.Body?.transformToString();
        if (body !== payload) {
          throw new Error(`content mismatch: expected "${payload}", got "${String(body)}"`);
        }
        return 'content matches';
      },
      config.STORAGE_ENDPOINT,
    );

    await step(
      'Delete it',
      async () => {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options());
        try {
          await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), options());
        } catch (error) {
          const { name, status } = errorDetails(error);
          if (name === 'NoSuchKey' || status === 404) {
            return 'object is gone';
          }
          throw error;
        }
        throw new Error('the object is still readable after deleting it');
      },
      config.STORAGE_ENDPOINT,
    );
  } finally {
    // Best-effort cleanup if a step failed after the write.
    if (!skipRest || failed) {
      await client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options())
        .catch(() => undefined);
    }
    client.destroy();
  }

  out();
  if (failed) {
    out('Result: FAILED. Fix the first failing step above and run the check again.');
    process.exitCode = 1;
  } else {
    out('Result: OK. The storage is reachable, authenticated, and read/write capable.');
  }
}

await main();
