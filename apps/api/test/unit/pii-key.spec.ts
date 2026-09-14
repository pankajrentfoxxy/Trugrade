import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requirePiiEncryptionKey } from '../../src/shared/config/config.service';

/** Every .ts file under a directory. */
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });

describe('the PII encryption key has no fallback', () => {
  it('throws, naming the variable, when it is unset', () => {
    expect(() => requirePiiEncryptionKey({ PII_ENCRYPTION_KEY: undefined })).toThrow(
      /PII_ENCRYPTION_KEY is not set/,
    );
  });

  it('returns the configured key', () => {
    expect(requirePiiEncryptionKey({ PII_ENCRYPTION_KEY: 'k' })).toBe('k');
  });

  it('no application source still carries the key that used to be committed', () => {
    const offenders = sources(join(__dirname, '../../src')).filter((file) =>
      readFileSync(file, 'utf8').includes('trugrade-local-pii-key'),
    );
    expect(offenders).toEqual([]);
  });
});
