import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_CONSOLE_PREPAINT_SCRIPT } from '@trugrade/ui';

/**
 * The theme is read before first paint or it is not read at all.
 *
 * `index.html` inlines a copy of `THEME_CONSOLE_PREPAINT_SCRIPT` because
 * Vite's HTML entry cannot import a TypeScript constant. A copy that drifts
 * reintroduces a theme flash on load — and silently, because nothing else
 * compares the two.
 */
describe('the pre-paint theme read', () => {
  // `process.cwd()`, not `import.meta.url`: the jsdom environment rewrites the
  // module URL to http:// and `fileURLToPath` refuses it. Vitest runs from the
  // package root.
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  it('is inlined in <head>, byte-identical to the exported constant', () => {
    expect(html).toContain(`<script>${THEME_CONSOLE_PREPAINT_SCRIPT}</script>`);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'));
  });

  it('runs before the stylesheet it is guarding against a flash of', () => {
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('fonts.googleapis.com/css2'));
    expect(html).toContain('data-t="dark"');
  });
});
