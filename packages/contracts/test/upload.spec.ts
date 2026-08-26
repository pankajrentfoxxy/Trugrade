/**
 * VR-061 to VR-072. Upload validation.
 *
 * The premise these tests defend: the extension and the declared MIME type are
 * both attacker-controlled, and only the bytes are evidence.
 */

import {
  checkDocumentAge,
  checkUpload,
  pdfHasActiveContent,
  sanitiseFilename,
  sniffMime,
} from '../src/upload';
import { UPLOAD_MAX_BYTES } from '../src/rules';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF = new Uint8Array([...Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n')]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
/** RIFF, but a WAV — the reason WEBP needs both markers checked. */
const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

describe('VR-063 — the bytes, not the extension', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['PDF', PDF, 'application/pdf'],
    ['WEBP', WEBP, 'image/webp'],
  ])('identifies a real %s', (_name, bytes, expected) => {
    expect(sniffMime(bytes)).toBe(expected);
  });

  it('does not mistake a WAV for a WEBP, though both start RIFF', () => {
    expect(sniffMime(WAV)).toBeNull();
  });

  it('returns null for something it does not recognise', () => {
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('rejects a PNG declared as a PDF — the shape of a probe, not a typo', () => {
    const r = checkUpload({ bytes: PNG, declaredMime: 'application/pdf', filename: 'gst.pdf' });
    expect(r.ok).toBe(false);
    expect(r.rejection).toBe('MAGIC_MISMATCH');
    // The caller quarantines and audit-logs on this, so it reports what it saw.
    expect(r.sniffedMime).toBe('image/png');
  });

  it('rejects a file whose bytes are nothing at all', () => {
    const r = checkUpload({
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), // a Windows executable
      declaredMime: 'image/jpeg',
      filename: 'photo.jpg',
    });
    expect(r.rejection).toBe('MAGIC_MISMATCH');
    expect(r.sniffedMime).toBeNull();
  });

  it('accepts an honest file', () => {
    expect(
      checkUpload({ bytes: JPEG, declaredMime: 'image/jpeg', filename: 'cheque.jpg' }).ok,
    ).toBe(true);
  });
});

describe('VR-062 — the allow-list', () => {
  it.each(['image/svg+xml', 'text/html', 'application/zip', 'application/octet-stream'])(
    'refuses %s outright',
    (mime) => {
      const r = checkUpload({ bytes: PNG, declaredMime: mime, filename: 'x.png' });
      expect(r.ok).toBe(false);
      expect(r.rejection).toBe('MIME_NOT_ALLOWED');
    },
  );

  it('SVG is not an allowed type at all — it is a script container', () => {
    const svg = new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>'));
    expect(checkUpload({ bytes: svg, declaredMime: 'image/svg+xml', filename: 'a.svg' }).ok).toBe(
      false,
    );
  });
});

describe('VR-064 — active content in a PDF', () => {
  it.each(['/JavaScript', '/OpenAction', '/Launch', '/EmbeddedFile'])('detects %s', (token) => {
    const bytes = new Uint8Array(Buffer.from(`%PDF-1.7\n<< /Type /Catalog ${token} 4 0 R >>`));
    expect(pdfHasActiveContent(bytes)).toBe(true);
  });

  it('passes an ordinary PDF', () => {
    expect(pdfHasActiveContent(PDF)).toBe(false);
  });

  it('rejects rather than sanitises — a KYC document has no reason to execute', () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.7\n<< /OpenAction << /S /JavaScript >> >>'));
    const r = checkUpload({ bytes, declaredMime: 'application/pdf', filename: 'gst.pdf' });
    expect(r.rejection).toBe('ACTIVE_CONTENT');
    expect(r.message).toMatch(/active content/i);
  });
});

describe('VR-061 — size', () => {
  it('rejects on the real byte count, not only the declared one', () => {
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    big.set(JPEG);
    // A client claiming a small size does not get to bypass the cap.
    const r = checkUpload({
      bytes: big,
      declaredMime: 'image/jpeg',
      filename: 'a.jpg',
      declaredSize: 1000,
    });
    expect(r.rejection).toBe('TOO_LARGE');
  });

  it('rejects early on a lying Content-Length that claims too much', () => {
    const r = checkUpload({
      bytes: JPEG,
      declaredMime: 'image/jpeg',
      filename: 'a.jpg',
      declaredSize: UPLOAD_MAX_BYTES + 1,
    });
    expect(r.rejection).toBe('TOO_LARGE');
  });

  it('rejects an empty file with its own message', () => {
    const r = checkUpload({
      bytes: new Uint8Array(0),
      declaredMime: 'image/jpeg',
      filename: 'a.jpg',
    });
    expect(r.rejection).toBe('EMPTY');
  });
});

describe('VR-067 — filenames', () => {
  it.each([
    // Takes the basename, so a traversal loses its path entirely rather than
    // being flattened into a name that still hints at one.
    ['../../etc/passwd', 'passwd'],
    ['C:\\Windows\\System32\\evil.pdf', 'evil.pdf'],
    ['GST certificate (2026).pdf', 'GST_certificate_2026_.pdf'],
    ['   .hidden', 'hidden'],
    ['', 'file'],
  ])('sanitises %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it('strips a path traversal rather than escaping it', () => {
    expect(sanitiseFilename('../../../root.jpg')).not.toContain('..');
  });

  it('refuses a filename with characters that would need escaping downstream', () => {
    const r = checkUpload({ bytes: JPEG, declaredMime: 'image/jpeg', filename: 'a;rm -rf.jpg' });
    expect(r.rejection).toBe('BAD_FILENAME');
  });
});

describe('VR-072 — document age', () => {
  const today = new Date('2026-08-26T00:00:00Z');

  it('lets a registration certificate through at any age', () => {
    const r = checkDocumentAge({
      documentDate: new Date('2019-07-01'),
      maxAgeDays: null,
      today,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a bank statement inside the window', () => {
    expect(
      checkDocumentAge({ documentDate: new Date('2026-07-01'), maxAgeDays: 90, today }).ok,
    ).toBe(true);
  });

  it('names the actual date in the rejection, which is the whole point', () => {
    const r = checkDocumentAge({ documentDate: new Date('2026-01-12'), maxAgeDays: 90, today });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/12 Jan 2026/);
    expect(r.message).toMatch(/last 90 days/);
  });

  it('refuses a future date', () => {
    const r = checkDocumentAge({ documentDate: new Date('2026-12-01'), maxAgeDays: 90, today });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/future/);
  });

  it('asks for the date rather than guessing when an age-limited document has none', () => {
    const r = checkDocumentAge({ documentDate: null, maxAgeDays: 90, today });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Tell us the date/);
  });

  it('is inclusive at exactly the limit', () => {
    const exactly90 = new Date(today.getTime() - 90 * 86_400_000);
    expect(checkDocumentAge({ documentDate: exactly90, maxAgeDays: 90, today }).ok).toBe(true);

    const day91 = new Date(today.getTime() - 91 * 86_400_000);
    expect(checkDocumentAge({ documentDate: day91, maxAgeDays: 90, today }).ok).toBe(false);
  });
});
