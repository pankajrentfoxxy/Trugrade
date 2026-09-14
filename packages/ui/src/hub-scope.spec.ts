/**
 * SUPPLIER HUB is a surface, not a theme. The safety property: when
 * `data-surface="hub"` is absent, this block changes nothing — it only ever
 * overrides tokens the rest of the system already has.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

const HUB_START = css.indexOf(":root[data-surface='hub'] {");
const HUB_END = css.indexOf('}', HUB_START);
const HUB_BLOCK = css.slice(HUB_START, HUB_END + 1);

const LIGHT = css.slice(css.indexOf(":root[data-t='light']"), css.indexOf(":root[data-t='slate']"));
const ROOT = css.slice(css.indexOf('  :root {'), css.indexOf("[data-density='comfortable']"));

function customProperties(block: string): string[] {
  return [...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
}

describe('SUPPLIER HUB token scope — safety property', () => {
  it('is present as a data-surface block', () => {
    expect(HUB_START).toBeGreaterThan(-1);
    expect(HUB_BLOCK).toMatch(/:root\[data-surface='hub'\]/);
  });

  it('declares only custom properties — no element selectors, no utilities', () => {
    const body = HUB_BLOCK.replace(/:root\[data-surface='hub'\]\s*\{/, '').replace(/\}$/, '');
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
    for (const name of customProperties(HUB_BLOCK)) {
      expect(known.has(name)).toBe(true);
    }
  });
});
