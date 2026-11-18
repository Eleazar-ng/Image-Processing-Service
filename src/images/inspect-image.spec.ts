import {
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { inspectImage } from './inspect-image.js';

const WIDTH = 40;
const HEIGHT = 30;

function blank() {
  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: '#336699',
    },
  });
}

const encoders = {
  jpeg: () => blank().jpeg().toBuffer(),
  png: () => blank().png().toBuffer(),
  webp: () => blank().webp().toBuffer(),
  avif: () => blank().avif().toBuffer(),
  gif: () => blank().gif().toBuffer(),
  tiff: () => blank().tiff().toBuffer(),
} as const;

const expected = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  avif: { mimeType: 'image/avif', extension: 'avif' },
  gif: { mimeType: 'image/gif', extension: 'gif' },
  tiff: { mimeType: 'image/tiff', extension: 'tiff' },
} as const;

describe('inspectImage', () => {
  describe.each(Object.keys(encoders) as (keyof typeof encoders)[])(
    'accepted format %s',
    (format) => {
      it('detects the format, size, and checksum', async () => {
        const buffer = await encoders[format]();

        const info = await inspectImage(buffer);

        expect(info).toMatchObject({
          format,
          ...expected[format],
          width: WIDTH,
          height: HEIGHT,
          sizeBytes: buffer.length,
        });
        expect(info.checksum).toMatch(/^[0-9a-f]{64}$/);
      });
    },
  );

  it('computes the checksum over the original bytes', async () => {
    const buffer = await encoders.png();
    const { createHash } = await import('node:crypto');

    const info = await inspectImage(buffer);

    expect(info.checksum).toBe(
      createHash('sha256').update(buffer).digest('hex'),
    );
  });

  it('reports dimensions as displayed when EXIF rotates the image', async () => {
    const buffer = await blank()
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const info = await inspectImage(buffer);

    expect(info.width).toBe(HEIGHT);
    expect(info.height).toBe(WIDTH);
  });

  it('keeps dimensions when the orientation does not rotate', async () => {
    const buffer = await blank()
      .jpeg()
      .withMetadata({ orientation: 3 })
      .toBuffer();

    const info = await inspectImage(buffer);

    expect(info.width).toBe(WIDTH);
    expect(info.height).toBe(HEIGHT);
  });

  it('rejects SVG even though it is an image format', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );

    await expect(inspectImage(svg)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects content that is not an image', async () => {
    await expect(
      inspectImage(Buffer.from('just some text, definitely not an image')),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects random bytes', async () => {
    const bytes = Buffer.alloc(2048);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = (i * 31 + 7) % 256;
    }

    await expect(inspectImage(bytes)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects a truncated image', async () => {
    const noisy = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#000000',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();

    await expect(
      inspectImage(noisy.subarray(0, Math.floor(noisy.length * 0.6))),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an image over the pixel limit', async () => {
    const buffer = await encoders.png(); // 1,200 pixels

    await expect(
      inspectImage(buffer, { maxPixels: 1000 }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('megapixel') as string,
    });
    await expect(
      inspectImage(buffer, { maxPixels: 1000 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('accepts an image exactly at the pixel limit', async () => {
    const buffer = await encoders.png();

    await expect(
      inspectImage(buffer, { maxPixels: WIDTH * HEIGHT }),
    ).resolves.toMatchObject({ width: WIDTH, height: HEIGHT });
  });

  it('carries stable error codes', async () => {
    const unsupported = await inspectImage(Buffer.from('nope')).catch(
      (error: UnsupportedMediaTypeException) => error,
    );

    expect(
      (unsupported as UnsupportedMediaTypeException).getResponse(),
    ).toMatchObject({
      errorCode: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });
});
