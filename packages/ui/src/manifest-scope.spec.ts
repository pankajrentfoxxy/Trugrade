/**
 * MANIFEST is a surface, not a theme. The safety property: when
 * `data-surface="manifest"` is absent, this block changes nothing — it only
 * ever overrides tokens the rest of the system already has.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

const MANIFEST_START = css.indexOf(":root[data-surface='manifest'] {");
const MANIFEST_END = css.indexOf('}', MANIFEST_START);
const MANIFEST_BLOCK = css.slice(MANIFEST_START, MANIFEST_END + 1);

const LIGHT = css.slice(css.indexOf(":root[data-t='light']"), css.indexOf(":root[data-t='slate']"));
const ROOT = css.slice(css.indexOf('  :root {'), css.indexOf("[data-density='comfortable']"));

function customProperties(block: string): string[] {
  return [...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
}

describe('MANIFEST token scope — safety property', () => {
  it('is present as a data-surface block', () => {
    expect(MANIFEST_START).toBeGreaterThan(-1);
    expect(MANIFEST_BLOCK).toMatch(/:root\[data-surface='manifest'\]/);
  });

  it('declares only custom properties — no element selectors, no utilities', () => {
    const body = MANIFEST_BLOCK.replace(/:root\[data-surface='manifest'\]\s*\{/, '').replace(/\}$/, '');
    expect(body).not.toMatch(/^[^{}]*[a-z][^{}:]*\{/m);
    const decls = body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && !d.startsWith('/*') && !d.startsWith('*'));
    expect(decls.length).toBeGreaterThan(0);
    for (const decl of decls) {
      expect(decl.startsWith('--')).toBe(true);
    }
  });

  it('only overrides tokens the light theme (or the shared :root) already has', () => {
    const known = new Set([...customProperties(LIGHT), ...customProperties(ROOT)]);
    for (const name of customProperties(MANIFEST_BLOCK)) {
      expect(known.has(name)).toBe(true);
    }
  });
});
