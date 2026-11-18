import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

export function createTestS3(): S3Client {
  return new S3Client({
    region: process.env.STORAGE_REGION ?? 'auto',
    endpoint: process.env.STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

const bucket = () => process.env.STORAGE_BUCKET ?? '';

export async function listKeys(client: S3Client): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket(), ContinuationToken: token }),
    );
    keys.push(...(page.Contents ?? []).flatMap((object) => object.Key ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Removes every object so tests can assert exact contents. */
export async function clearBucket(client: S3Client): Promise<void> {
  const keys = await listKeys(client);
  if (keys.length === 0) {
    return;
  }
  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
