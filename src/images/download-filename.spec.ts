import {
  buildContentDisposition,
  downloadFilename,
} from './download-filename.js';
import { extensionForMimeType } from './inspect-image.js';

describe('extensionForMimeType', () => {
  it('maps accepted types to their extension', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('jpg');
    expect(extensionForMimeType('image/tiff')).toBe('tiff');
    expect(extensionForMimeType('image/avif')).toBe('avif');
  });

  it('returns undefined for anything else', () => {
    expect(extensionForMimeType('image/svg+xml')).toBeUndefined();
  });
});

describe('downloadFilename', () => {
  it('keeps a name whose extension already matches', () => {
    expect(downloadFilename('holiday.jpg', 'image/jpeg')).toBe('holiday.jpg');
  });

  it('treats jpeg and jpg, tif and tiff as the same', () => {
    expect(downloadFilename('a.JPEG', 'image/jpeg')).toBe('a.JPEG');
    expect(downloadFilename('b.tif', 'image/tiff')).toBe('b.tif');
  });

  it('corrects a misleading image extension to the real format', () => {
    expect(downloadFilename('holiday.jpg', 'image/png')).toBe('holiday.png');
    expect(downloadFilename('scan.png', 'image/tiff')).toBe('scan.tiff');
  });

  it('appends the extension when there is none', () => {
    expect(downloadFilename('holiday', 'image/webp')).toBe('holiday.webp');
  });

  it('appends rather than replaces an unrelated extension', () => {
    expect(downloadFilename('notes.txt', 'image/png')).toBe('notes.txt.png');
    expect(downloadFilename('archive.v2', 'image/gif')).toBe('archive.v2.gif');
  });

  it('sanitizes the name first', () => {
    expect(downloadFilename('../../etc/passwd.jpg', 'image/png')).toBe(
      'passwd.png',
    );
    expect(downloadFilename('', 'image/jpeg')).toBe('upload.jpg');
  });

  it('never exceeds 255 characters', () => {
    const result = downloadFilename(`${'a'.repeat(300)}.jpg`, 'image/png');

    expect(Array.from(result).length).toBeLessThanOrEqual(255);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('leaves the name alone for an unknown type', () => {
    expect(downloadFilename('x.bin', 'application/octet-stream')).toBe('x.bin');
  });
});

describe('buildContentDisposition', () => {
  it('builds an inline header with both filename forms', () => {
    expect(buildContentDisposition('inline', 'holiday.jpg')).toBe(
      `inline; filename="holiday.jpg"; filename*=UTF-8''holiday.jpg`,
    );
  });

  it('builds an attachment header', () => {
    expect(buildContentDisposition('attachment', 'a.png')).toMatch(
      /^attachment; filename="a\.png"/,
    );
  });

  it('keeps non-ASCII names in filename* and gives an ASCII fallback', () => {
    const header = buildContentDisposition('attachment', '写真.png');

    expect(header).toContain(`filename*=UTF-8''%E5%86%99%E7%9C%9F.png`);
    expect(header).toContain('filename="__.png"');
  });

  it('neutralizes quotes, backslashes, percent signs, and semicolons in the fallback', () => {
    const header = buildContentDisposition('inline', 'a"b\\c%d;e.png');

    expect(header).toContain('filename="a_b_c_d_e.png"');
  });

  it('percent-encodes characters that are special in RFC 5987 values', () => {
    expect(buildContentDisposition('inline', "it's (1)*.png")).toContain(
      `filename*=UTF-8''it%27s%20%281%29%2A.png`,
    );
  });
});
