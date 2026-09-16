/**
 * Stage 4 — the portal is built from one design system, not two.
 *
 * It was measurably two. Three screens wrapped their content in `.hub-page`
 * from `packages/ui/hub.css`; twenty-three used `<div className="body"><div
 * className="wrap">` from `storefront.css`, a sheet written for the public shop.
 * `--maxw` on the hub surface is 1800px and `.wrap` hard-codes 1400px, so the
 * content column jumped 400px between `/home` and `/orders`.
 *
 * Three page-header grammars existed across seventeen routes, and `.pill.wire`
 * — the secondary control on six record screens — read `--chrome-*` tokens,
 * which resolve to a near-white border on a white sheet. Six separate rules
 * around `storefront.css` existed to undo its own base rule.
 *
 * These assert against the source and the stylesheets rather than a browser,
 * because every property here is a fact about the files: which wrapper a route
 * renders, which tokens a selector reads, how many header components the portal
 * imports. A screenshot would prove one viewport on one machine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = __dirname;
const UI = join(PORTAL, '..', '..', '..', '..', '..', 'packages', 'ui', 'src');
const STOREFRONT_CSS = readFileSync(join(PORTAL, '..', 'storefront.css'), 'utf8');
const GLOBALS_CSS = readFileSync(join(UI, 'globals.css'), 'utf8');

/** Every .tsx under the portal that is a route or a skeleton, not a spec. */
function routeFiles(dir: string = PORTAL, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name.endsWith('.tsx') && !e.name.includes('.spec.')) out.push(p);
  }
  return out;
}

const FILES = routeFiles();
const rel = (p: string): string => p.slice(PORTAL.length + 1).replace(/\\/g, '/');

/* ==========================================================================
 * 1. One page wrapper
 * ======================================================================== */

describe('the page wrapper', () => {
  it('is never the shop’s `.body > .wrap` anywhere in the portal', () => {
    const offenders = FILES.filter((f) => {
      const s = readFileSync(f, 'utf8');
      return s.includes('className="body"') || s.includes('className="wrap"');
    }).map(rel);
    // Twenty-four files carried one of these, skeletons included.
    expect(offenders).toEqual([]);
  });

  it('is `.hub-page` on every route and every skeleton that draws a page', () => {
    // A page file that renders its own chrome must use the surface's wrapper.
    // Components mounted inside one inherit it and are exempt.
    const pages = FILES.filter((f) => /[\\/](page|loading)\.tsx$/.test(f));
    const missing = pages
      .filter((f) => {
        const s = readFileSync(f, 'utf8');
        // A delegate that only mounts a component carries no wrapper of its own.
        const delegates = !s.includes('<div') && !s.includes('<main');
        return !delegates && !s.includes('hub-page');
      })
      .map(rel);
    expect(missing).toEqual([]);
  });

  it('clamps to one width, because `.wrap` and `--maxw` disagreed by 400px', () => {
    // The two numbers that made /home and /orders different widths.
    expect(STOREFRONT_CSS).toMatch(/\.wrap\{max-width:1400px/);
    const hub = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf(":root[data-surface='hub'] {"));
    expect(hub.slice(0, hub.indexOf('}'))).toMatch(/--maxw:\s*1800px/);
    // …and nothing in the portal reaches for the narrower one any more.
    for (const f of FILES) {
      expect(readFileSync(f, 'utf8')).not.toContain('className="wrap"');
    }
  });
});

/* ==========================================================================
 * 2. One page header
 * ======================================================================== */

describe('the page header', () => {
  it('is one of exactly two components, never hand-rolled', () => {
    const handRolled = FILES.filter((f) => readFileSync(f, 'utf8').includes('wshead')).map(rel);
    // Fourteen sites drew their own, with seven different modifier classes.
    expect(handRolled).toEqual([]);
  });

  it('is `HubPageHeader` for boards and `RecordHeader` for records, and nothing else', () => {
    const used = new Set<string>();
    for (const f of FILES) {
      const s = readFileSync(f, 'utf8');
      if (/\bHubPageHeader\b/.test(s)) used.add('HubPageHeader');
      if (/\bRecordHeader\b/.test(s)) used.add('RecordHeader');
    }
    expect([...used].sort()).toEqual(['HubPageHeader', 'RecordHeader']);
  });

  it('draws the same box in a skeleton as in the screen it stands in for', () => {
    // `delivery/loading.tsx` drew `wshead dvhead` while `DeliveryCheck` rendered
    // a `RecordHeader`; the skeleton and the loaded screen were different shapes.
    for (const f of FILES.filter((x) => /loading\.tsx$/.test(x))) {
      const s = readFileSync(f, 'utf8');
      if (s.includes('Skeleton') && /<div className="hub-heading">/.test(s)) {
        expect(s).toContain('hub-heading');
      }
      expect(s).not.toMatch(/wshead/);
    }
  });
});

/* ==========================================================================
 * 3. No chrome token on a working surface
 * ======================================================================== */

describe('the tokens a portal control resolves', () => {
  /** Every class the portal actually puts in a `className`. */
  const portalClasses = new Set<string>();
  for (const f of FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/className="([^"{}]+)"/g)) {
      for (const c of m[1]!.split(/\s+/)) if (c) portalClasses.add(c);
    }
  }

  it('never reads a --chrome-* token on a class the portal renders', () => {
    // `.fscrim` is the one deliberate exception and says so at its definition:
    // a full-page scrim is the chrome colour by intent.
    const ALLOWED = new Set(['fscrim']);
    const offenders: string[] = [];

    for (const m of STOREFRONT_CSS.matchAll(/^([^@{}\n][^{}\n]*)\{([^{}]*)\}/gm)) {
      const [selector, body] = [m[1]!.trim(), m[2]!];
      if (!/var\(--chrome-|var\(--on-chrome/.test(body)) continue;
      // Judge each comma-separated selector by the class it is ROOTED at. A
      // rule like `.gline .v` lives inside the shop's gauge; that the portal
      // also renders something called `v` does not put it inside one.
      for (const one of selector.split(',')) {
        const first = one.trim().match(/^\.([a-z][\w-]*)/);
        if (!first) continue;
        const name = first[1]!;
        if (ALLOWED.has(name)) continue;
        if (!portalClasses.has(name)) continue;
        offenders.push(`${one.trim()} → --chrome-* (root class .${name})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives `.pill.wire` the working surface as its base, with chrome as the exception', () => {
    // It was the other way round: the chrome variant was the base, and six rules
    // around this file existed only to undo it on a sheet.
    expect(STOREFRONT_CSS).toMatch(/\.pill\.wire\{background:var\(--sheet\)/);
    expect(STOREFRONT_CSS).toMatch(/\.hero \.pill\.wire\{[^}]*--chrome-line-2/);

    // And none of the six patches survive.
    for (const patch of [
      '.doctable .pill.wire',
      '.cactions .pill.wire',
      '.crside .pill.wire',
      '.dvside .pill.wire',
      '.empty .pill.wire',
      '.chdonewire{background',
    ]) {
      expect(STOREFRONT_CSS).not.toContain(patch);
    }
  });
});

/* ==========================================================================
 * 4. Contrast, recomputed from the stylesheet
 * ======================================================================== */

const HUB = GLOBALS_CSS.slice(
  GLOBALS_CSS.indexOf(":root[data-surface='hub'] {"),
  GLOBALS_CSS.indexOf('}', GLOBALS_CSS.indexOf(":root[data-surface='hub'] {")) + 1,
);

function hubToken(name: string): string {
  const m = HUB.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`--${name} is not declared on the hub surface`);
  return m[1]!.toLowerCase();
}

function luminance(hex: string): number {
  const full =
    hex.length === 4
      ? '#' +
        hex
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

const contrast = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

describe('the ink the portal reads on', () => {
  it.each([
    ['ink', 'sheet'],
    ['ink', 'ground'],
    ['ink-2', 'sheet'],
    ['ink-2', 'ground'],
    ['acc-ink', 'sheet'],
  ])('clears 4.5:1 for --%s on --%s', (ink, ground) => {
    expect(contrast(hubToken(ink), hubToken(ground))).toBeGreaterThanOrEqual(4.5);
  });

  it('is why `.pill.wire` on a sheet had to stop being bordered in chrome', () => {
    // The defect was the BORDER, not the ink: on this surface --on-chrome and
    // --ink are the same value, while --chrome-line-2 is lighter than the
    // hairline every other bordered control on the same sheet uses. A control
    // outlined in it has no visible edge at all.
    const sheet = hubToken('sheet');
    expect(contrast(hubToken('chrome-line-2'), sheet)).toBeLessThan(
      contrast(hubToken('rule'), sheet),
    );
    // And the ink it reads with clears AA on that sheet.
    expect(contrast(hubToken('ink'), sheet)).toBeGreaterThanOrEqual(4.5);
  });
});
