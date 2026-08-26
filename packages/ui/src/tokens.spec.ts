/**
 * The palette, checked against WCAG 2.2 AA arithmetic rather than against a
 * number written in a document.
 *
 * `08_BRAND_SYSTEM.md` §9 still cites the *old* cobalt palette's contrast pairs
 * — "white on signal 7.4:1" — because §4 was revised on 26 August and §9 was
 * not. Recomputing here found three real failures in the Workbench set:
 *
 *   1. white on `--acc` is **4.499:1**, below the 4.5 floor by a thousandth
 *   2. `--ink-3` on `--paper` is **4.19:1**
 *   3. `--ink-4` is **2.53:1**, failing both the text floor and the 3:1 floor
 *      for meaningful graphics
 *
 * The components were changed to avoid all three. This file is what stops
 * someone reaching for them again.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** Read a token straight out of globals.css, so the test cannot drift from it. */
function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} not found in globals.css`);
  return match[1]!.toLowerCase();
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

export function contrast(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const WHITE = '#ffffff';

describe('the palette is the Workbench set, not the cobalt one', () => {
  it('has no cobalt signal token left', () => {
    expect(css).not.toMatch(/--signal\s*:/);
    expect(css).not.toContain('#1f3ce0');
  });

  it('has none of the pre-Trugrade navy, cyan or orange', () => {
    for (const dead of ['#191f2e', '#17afc5', '#fe9d00', '#232b3d', '#0e8da0']) {
      expect(css.toLowerCase()).not.toContain(dead);
    }
  });

  it('is single-theme — no dark-mode block to keep in sync', () => {
    expect(css).not.toMatch(/prefers-color-scheme\s*:\s*dark/);
    expect(css).not.toMatch(/\[data-theme=["']dark["']\]/);
  });

  it('paints the body ground explicitly, so the page never borrows a host colour', () => {
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--paper\)/s);
  });
});

describe('WCAG 2.2 AA — text at 4.5:1', () => {
  it.each([
    ['ink on paper', 'ink', 'paper'],
    ['ink on sheet', 'ink', 'sheet'],
    ['ink-2 on paper', 'ink-2', 'paper'],
    ['ink-2 on sheet', 'ink-2', 'sheet'],
    ['ink-3 on sheet', 'ink-3', 'sheet'],
    ['pass on pass-wash', 'pass', 'pass-wash'],
    ['fail on fail-wash', 'fail', 'fail-wash'],
    ['warn on paper', 'warn', 'paper'],
    ['warn on sheet', 'warn', 'sheet'],
    ['acc-hi on paper', 'acc-hi', 'paper'],
    ['acc-hi on sheet', 'acc-hi', 'sheet'],
    ['acc-hi on acc-wash', 'acc-hi', 'acc-wash'],
    ['on-dark on dark', 'on-dark', 'dark'],
    ['on-dark-2 on dark', 'on-dark-2', 'dark'],
    ['acc-lit on dark', 'acc-lit', 'dark'],
  ])('%s clears 4.5:1', (_name, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('white on acc-hi is the primary button, and it passes', () => {
    expect(contrast(WHITE, token('acc-hi'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the three pairs the components deliberately avoid', () => {
  it('white on --acc misses AA by a thousandth, which is why the button uses --acc-hi', () => {
    const r = contrast(WHITE, token('acc'));
    expect(r).toBeGreaterThan(4.4);
    expect(r).toBeLessThan(4.5);
  });

  it('--ink-3 on --paper misses AA, which is why hints use --ink-2', () => {
    expect(contrast(token('ink-3'), token('paper'))).toBeLessThan(4.5);
  });

  it('--ink-4 fails even the 3:1 floor for meaningful graphics', () => {
    expect(contrast(token('ink-4'), token('sheet'))).toBeLessThan(3);
  });
});

describe('the accent means something', () => {
  it('there is exactly one accent family, so there is no second colour to reach for', () => {
    const accents = [...css.matchAll(/--acc[a-z-]*:/g)].map((m) => m[0]);
    expect(accents.sort()).toEqual(['--acc-hi:', '--acc-lit:', '--acc-wash:', '--acc:']);
  });

  it('WARN has no wash token — rule 4 says it renders outlined, never filled', () => {
    expect(css).not.toMatch(/--warn-wash\s*:/);
  });
});

describe('the spacing scale exists', () => {
  it('defines s1 through s9', () => {
    for (let i = 1; i <= 9; i++) {
      expect(css).toMatch(new RegExp(`--s${i}\\s*:\\s*\\d+px`));
    }
  });

  it('radii are flat — nothing pill-shaped', () => {
    const r = css.match(/--r:\s*(\d+)px/);
    expect(Number(r![1])).toBeLessThanOrEqual(8);
  });
});
