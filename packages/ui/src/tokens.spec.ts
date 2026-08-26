/**
 * The Darkroom palette, checked against WCAG 2.2 AA arithmetic rather than
 * against a number written in a document.
 *
 * `09_FRONTEND_LOCKED.md` §9 tabulates seven verified pairs. This file
 * recomputes every one of them from the tokens actually present in
 * `globals.css`, so the document and the stylesheet cannot drift apart — the
 * previous version of this file was pinned to the Workbench palette and went on
 * passing after that palette was replaced, which is exactly the failure it was
 * written to prevent.
 *
 * The interesting property of a two-theme system is that a pair can pass in one
 * theme and fail in the other. Every text pair below is therefore asserted in
 * BOTH, and `--acc-ink` exists precisely because raw `--acc` fails as a text
 * colour on a light surface.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** The dark block is `:root, :root[data-t='dark']`; light is its own block. */
const DARK = css.slice(css.indexOf(':root,'), css.indexOf(":root[data-t='light']"));
const LIGHT = css.slice(css.indexOf(":root[data-t='light']"), css.indexOf('html {'));

/**
 * Read a token out of one theme block, so a test cannot accidentally compare a
 * dark foreground against a light ground and report a reassuring number.
 */
function token(scope: string, name: string): string {
  const match = scope.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} not found in that theme block`);
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

describe('the palette is Darkroom, and every earlier one is gone', () => {
  it('carries none of the dead palettes', () => {
    // Original prototypes, the Anodised draft and the Workbench draft.
    for (const dead of ['#191f2e', '#17afc5', '#fe9d00', '#1f3ce0', '#b4611c', '#f7f5f0']) {
      // The header comment names them as dead; strip comments before checking.
      const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code.toLowerCase()).not.toContain(dead);
    }
  });

  it('is amber, and amber is the only accent family', () => {
    expect(token(DARK, 'acc')).toBe('#ffb627');
    const accents = [...DARK.matchAll(/--acc[a-z-]*:/g)].map((m) => m[0]).sort();
    expect(accents).toEqual(['--acc-dk:', '--acc-glow:', '--acc-ink:', '--acc-on:', '--acc-wash:', '--acc:']);
  });

  it('ships two themes, dark first', () => {
    expect(css).toMatch(/:root\[data-t='dark'\]/);
    expect(css).toMatch(/:root\[data-t='light'\]/);
  });

  it('does not follow prefers-color-scheme — light is a deliberate opt-out', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it('paints the body ground explicitly, so the page never borrows a host colour', () => {
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--ground\)/s);
  });

  /**
   * Rule 3, and the one most likely to be broken by someone "tidying up" the
   * light block: the header and footer are the brand and never change.
   */
  it('keeps the chrome identical in both themes', () => {
    for (const name of ['chrome', 'chrome-2', 'chrome-3', 'on-chrome', 'on-chrome-2', 'on-chrome-3']) {
      expect(token(LIGHT, name)).toBe(token(DARK, name));
    }
  });
});

describe('WCAG 2.2 AA — the §9 pairs, in both themes', () => {
  it.each([
    ['ink on sheet', 'ink', 'sheet'],
    ['ink-2 on sheet', 'ink-2', 'sheet'],
    ['ink-2 on ground', 'ink-2', 'ground'],
    ['ink on ground', 'ink', 'ground'],
  ])('dark: %s clears 4.5:1', (_n, fg, bg) => {
    expect(contrast(token(DARK, fg), token(DARK, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['ink on sheet', 'ink', 'sheet'],
    ['ink-2 on sheet', 'ink-2', 'sheet'],
    ['ink-2 on ground', 'ink-2', 'ground'],
    ['ink on ground', 'ink', 'ground'],
  ])('light: %s clears 4.5:1', (_n, fg, bg) => {
    expect(contrast(token(LIGHT, fg), token(LIGHT, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('the primary button passes: acc-on on acc', () => {
    // Identical in both themes — amber fill, near-black text.
    expect(contrast(token(DARK, 'acc-on'), token(DARK, 'acc'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, 'acc-on'), token(LIGHT, 'acc'))).toBeGreaterThanOrEqual(4.5);
  });

  it('amber on the chrome passes, which is what makes the header usable', () => {
    expect(contrast(token(DARK, 'acc'), token(DARK, 'chrome'))).toBeGreaterThanOrEqual(4.5);
  });

  it('acc-ink on acc-wash passes in light, which is the amber-text-on-tint case', () => {
    expect(contrast(token(LIGHT, 'acc-ink'), token(LIGHT, 'acc-wash'))).toBeGreaterThanOrEqual(4.5);
  });

  it('semantic text passes on the working surface in both themes', () => {
    for (const scope of [DARK, LIGHT]) {
      for (const name of ['pass', 'fail']) {
        expect(contrast(token(scope, name), token(scope, 'sheet'))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

/**
 * The reason `--acc-ink` exists at all. If someone "simplifies" it away and
 * reaches for raw `--acc` as a text colour, this is what fails.
 */
describe('why --acc-ink is a separate token', () => {
  it('raw --acc fails as text on a light sheet', () => {
    expect(contrast(token(LIGHT, 'acc'), token(LIGHT, 'sheet'))).toBeLessThan(4.5);
  });

  it('--acc-ink is the fix, and it passes', () => {
    expect(contrast(token(LIGHT, 'acc-ink'), token(LIGHT, 'sheet'))).toBeGreaterThanOrEqual(4.5);
  });

  it('in dark it goes the other way — acc-ink is LIGHTER than acc', () => {
    expect(relativeLuminance(token(DARK, 'acc-ink'))).toBeGreaterThan(
      relativeLuminance(token(DARK, 'acc')),
    );
    expect(relativeLuminance(token(LIGHT, 'acc-ink'))).toBeLessThan(
      relativeLuminance(token(LIGHT, 'acc')),
    );
  });
});

describe('typography is an instrument, not a document', () => {
  it('is 14px based, not 16px', () => {
    expect(css).toMatch(/body\s*\{[^}]*font-size:\s*14px/s);
  });

  it('body is one step down from headings — the hierarchy rule', () => {
    expect(css).toMatch(/body\s*\{[^}]*color:\s*var\(--ink-2\)/s);
    expect(css).toMatch(/h1[^)]*\)\s*\{[^}]*color:\s*var\(--ink\)/s);
  });

  it('the numeric utility carries mono AND tabular together, so it cannot be half-applied', () => {
    expect(css).toMatch(/\.mono,\s*\n?\s*\.tnum\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.mono,\s*\n?\s*\.tnum\s*\{[^}]*tabular-nums/s);
  });

  it('uses Inter and IBM Plex Mono, not the superseded faces', () => {
    expect(css).toContain("'Inter'");
    expect(css).toContain("'IBM Plex Mono'");
    expect(css).not.toContain('Instrument Sans');
  });
});

describe('the seven QC motifs exist and the moving two stop moving', () => {
  it.each(['.vf', '.scanbox', '.barcode', '.tickrule', '.grid-bg', '.blip', '.qr'])(
    '%s is defined',
    (cls) => {
      expect(css).toContain(`${cls} {`);
    },
  );

  /**
   * The global reduced-motion block clamps duration to 0.01ms, which is merely
   * fast. These two are stated as `animation: none` because a sweeping line and
   * a pulsing dot are the two most likely to cause discomfort.
   */
  it('scanbox and blip are explicitly stilled under prefers-reduced-motion', () => {
    const reduced = css.slice(css.lastIndexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.scanbox::after\s*\{[^}]*animation:\s*none/s);
    expect(reduced).toMatch(/\.blip\s*\{[^}]*animation:\s*none/s);
  });
});

describe('spacing, radii and density', () => {
  it('defines s1 through s8', () => {
    for (let i = 1; i <= 8; i++) {
      expect(css).toMatch(new RegExp(`--s${i}\\s*:\\s*\\d+px`));
    }
  });

  it('radii are flat — 3/4/5/7/9, nothing pill-shaped', () => {
    expect(css).toMatch(/--r-xs:\s*3px/);
    expect(css).toMatch(/--r:\s*5px/);
    expect(css).toMatch(/--r-xl:\s*9px/);
  });

  const DENSITY_TOKENS = ['d-row', 'd-cell', 'd-card', 'd-stack', 'd-section'];

  it('defines every density token in both densities', () => {
    const compact = css.slice(css.indexOf("[data-density='compact']"));
    for (const name of DENSITY_TOKENS) {
      expect(css).toMatch(new RegExp(`--${name}\\s*:`));
      expect(compact).toMatch(new RegExp(`--${name}\\s*:`));
    }
  });

  /**
   * `data-t` and `data-density` are orthogonal: both live on the root and
   * neither knows about the other. A density block that also set a colour, or a
   * theme block that also set a gap, would couple them.
   */
  it('keeps density and theme orthogonal', () => {
    const compact = css.slice(
      css.indexOf("[data-density='compact']"),
      css.indexOf('html {'),
    );
    expect(compact).not.toMatch(/--ink|--sheet|--acc|--chrome/);
    expect(DARK).not.toMatch(/--d-row|--d-cell|--d-card/);
  });

  it('exposes the density through classes, so a component never hard-codes a gap', () => {
    for (const cls of ['.tg-cell', '.tg-card', '.tg-stack', '.tg-section']) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(/\.tg-cell\s*\{[^}]*var\(--d-row\)/s);
  });
});

/**
 * CLAUDE.md: "One DataBoard component, three settings." The three settings are
 * row heights, and they are asserted here because they are the one part of the
 * density system a component could quietly stop honouring — `DataTable` reads
 * them through `.tg-cell`, never through a prop, so nothing in TypeScript would
 * catch a caller passing its own.
 */
describe('density — the three row heights', () => {
  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it.each([
    ["comfortable — storefront — is a 60px row", "[data-density='comfortable']", '60px'],
    ['the default — vendor — is a 46px row', ':root {', '46px'],
    ["compact — admin — is a 34px row", "[data-density='compact']", '34px'],
  ])('%s', (_name, selector, height) => {
    expect(block(selector)).toMatch(new RegExp(String.raw`--d-row-h:\s*` + height));
  });

  it('drives the row height from the cell, so no component takes a density prop', () => {
    expect(css).toMatch(/\.tg-cell\s*\{[^}]*height:\s*var\(--d-row-h\)/s);
  });

  /**
   * `height` on a table cell is a minimum, so the padding at each density has to
   * stay small enough for the height to be the number that actually wins. At
   * compact that is the binding constraint: 34px less 13px of text at 1.55
   * leaves under 7px a side.
   */
  it('keeps the compact padding inside the compact row height', () => {
    expect(block("[data-density='compact']")).toMatch(/--d-row:\s*var\(--s1\)/);
  });
});
