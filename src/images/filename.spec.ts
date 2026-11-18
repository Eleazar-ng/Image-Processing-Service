import { sanitizeFilename } from './filename.js';

describe('sanitizeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeFilename('holiday photo (1).jpg')).toBe(
      'holiday photo (1).jpg',
    );
  });

  it('drops directory parts from both kinds of separator', () => {
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd.png');
    expect(sanitizeFilename('C:\\Users\\me\\cat.png')).toBe('cat.png');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('a\u0000b\nc\u007fd.png')).toBe('abcd.png');
  });

  it('removes bidirectional override characters', () => {
    expect(sanitizeFilename('photo\u202egpj.exe')).toBe('photogpj.exe');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeFilename('   cat.png  ')).toBe('cat.png');
  });

  it('falls back when nothing usable is left', () => {
    for (const raw of [undefined, '', '   ', '.', '..', 'folder/', '\u0000']) {
      expect(sanitizeFilename(raw)).toBe('upload');
    }
  });

  it('keeps non-ASCII names and normalizes them', () => {
    expect(sanitizeFilename('cafe\u0301.png')).toBe('caf\u00e9.png');
    expect(sanitizeFilename('写真.jpg')).toBe('写真.jpg');
  });

  it('caps the length at 255 characters and keeps the extension', () => {
    const result = sanitizeFilename(`${'a'.repeat(400)}.jpeg`);

    expect(Array.from(result)).toHaveLength(255);
    expect(result.endsWith('.jpeg')).toBe(true);
  });

  it('caps a very long name without an extension', () => {
    expect(Array.from(sanitizeFilename('b'.repeat(400)))).toHaveLength(255);
  });
});
