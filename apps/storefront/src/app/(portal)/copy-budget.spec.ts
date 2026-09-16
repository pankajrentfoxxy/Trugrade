/**
 * Stage 7 — the dashboard explains itself less.
 *
 * It was not cluttered because it lacked features. Every board carried a two-to
 * four-sentence paragraph under its `<h1>`, fourteen of seventeen screens
 * carried at least one footnote, and `/addresses` had fifteen paragraphs.
 *
 * Measured in a browser across sixteen portal routes, counting paragraphs of six
 * words or more inside `.hub-main`:
 *
 *              total   mean   peak
 *   before     1,249     78    186
 *   after        874     55    186
 *
 * The peak is `/team`, and it stays: its fourteen paragraphs are one line each
 * against a role in the capability matrix — *"Approves or rejects orders that
 * need a signature. Cannot place them."* That is a Tier 3 consequence read at
 * the moment somebody chooses what a colleague may do, which is exactly where
 * the budget says a consequence belongs.
 *
 * This file pins the structure rather than the word count: a count drifts one
 * sentence at a time and a rule does not.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = __dirname;

function files(dir: string = PORTAL, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (e.name.endsWith('.tsx') && !e.name.includes('.spec.')) out.push(p);
  }
  return out;
}

const FILES = files();
const rel = (p: string): string => p.slice(PORTAL.length + 1).replace(/\\/g, '/');
const read = (p: string): string => readFileSync(p, 'utf8');

/** Source with comments stripped: a docblock is not on screen. */
const BLOCK = new RegExp(String.raw`/\*[\s\S]*?\*/`, 'g');
const LINE = new RegExp(String.raw`^\s*//.*$`, 'gm');
const code = (p: string): string => read(p).replace(BLOCK, '').replace(LINE, '');

/* ==========================================================================
 * 1. A screen header is a title and a count
 * ======================================================================== */

describe('a screen header', () => {
  it('carries no paragraph of prose', () => {
    // `HubPageHeader` takes a `subtitle`, which is a count or a short phrase.
    // A sentence there is the paragraph under an `<h1>` by another name.
    const long: string[] = [];
    for (const f of FILES) {
      for (const m of code(f).matchAll(/subtitle="([^"]{1,400})"/g)) {
        const words = m[1]!.trim().split(/\s+/).length;
        if (words > 12) long.push(`${rel(f)}: ${words} words`);
      }
    }
    expect(long).toEqual([]);
  });
});

/* ==========================================================================
 * 2. Tier 4 goes behind a disclosure
 * ======================================================================== */

describe('the long explanations', () => {
  it('use the disclosure that already existed, not a new control', () => {
    // `InfoPopover` was exported from `packages/ui`, styled with
    // `hub-info__btn` and `hub-info__panel`, and imported by neither app.
    const users = FILES.filter((f) => code(f).includes('<InfoPopover')).map(rel);
    expect(users.length).toBeGreaterThanOrEqual(5);
  });

  it('never re-implements one with a raw <details>', () => {
    // Narrow on purpose. A `<details>` is the right element for a filter
    // section or a form expander, and the portal uses it for both. What must
    // not be hand-rolled is the EXPLANATION disclosure, which is a styled,
    // focus-managing control that already exists — these three were written as
    // `<details>` before noticing it. "Never invent a component."
    for (const f of [
      ['returns', 'ReturnsBoard.tsx'],
      ['warranty', 'WarrantyBoard.tsx'],
      ['orders', '[orderNumber]', 'delivery', 'DeliveryCheck.tsx'],
    ] as const) {
      const source = code(join(PORTAL, ...f));
      expect(source).toContain('<InfoPopover');
      expect(source).not.toMatch(/<details/);
    }
  });

  it('says the statutory basis once, beside the fact it is about', () => {
    const record = code(join(PORTAL, 'orders', '[orderNumber]', 'OrderRecord.tsx'));
    // It was on the label AND repeated in the money footnote.
    expect(record).toContain('Why this state decides the tax');
    expect(record.match(/order\.tax\.basis/g) ?? []).toHaveLength(1);
  });
});

/* ==========================================================================
 * 3. The empty state goes through the shared board
 * ======================================================================== */

describe('an empty board', () => {
  it('renders through DataBoard rather than instead of it', () => {
    // `DataBoard` used to put its `empty` slot in a `<td colSpan>`, so on a
    // phone the one sentence explaining why there is no data sat off the right
    // edge of a scroll nobody knew was there. One board worked around it and
    // reported the defect; four others passed `empty` straight into it. It is
    // fixed in the component, so the workaround is gone.
    const board = code(join(PORTAL, 'returns', 'ReturnsBoard.tsx'));
    expect(board).toContain('empty={');
    expect(board).not.toContain('rendered INSTEAD of the board');
  });
});
