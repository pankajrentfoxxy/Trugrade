import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom's `Blob` has neither `.text()` nor `.arrayBuffer()`.
 *
 * Both have been on `Blob` in every browser since 2019 and the file-upload paths
 * use them — the magic-byte check reads the first eight bytes before anything is
 * decoded, which is the whole reason a renamed workbook is refused rather than
 * half-parsed. Without them the CSV panel was simply untestable, which is why it
 * had no test until T29.
 *
 * `FileReader` IS implemented, so the polyfill goes through it rather than
 * inventing a second reader. Test-environment only: production code must not
 * grow a branch for a browser that does not exist.
 */
const read = (blob: Blob, how: 'text' | 'buffer'): Promise<string | ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result as string | ArrayBuffer);
    if (how === 'text') r.readAsText(blob);
    else r.readAsArrayBuffer(blob);
  });

if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return read(this, 'text') as Promise<string>;
  };
}
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return read(this, 'buffer') as Promise<ArrayBuffer>;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
