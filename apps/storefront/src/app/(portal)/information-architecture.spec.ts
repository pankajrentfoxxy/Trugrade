/**
 * Stage 6 — nothing counted that cannot be opened, and nothing duplicated.
 *
 * Four defects of the same family: a figure a screen counts and cannot open, a
 * route two comments promise and nobody built, a document named and never
 * produced, and one screen kept in two files that will drift.
 *
 * These read the source and the route tree rather than rendering, because every
 * property here is a fact about the app's shape: which routes exist, how many
 * components render a case, which endpoint a screen reads. Behaviour is covered
 * by the specs beside each screen.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = __dirname;
const API = join(PORTAL, '..', '..', '..', '..', 'api', 'src');

const read = (...p: string[]): string => readFileSync(join(PORTAL, ...p), 'utf8');

/**
 * The file with its comments removed.
 *
 * Several of these assertions are "this word must not appear", and the comment
 * explaining WHY it must not appear contains it. Stripping comments is the
 * difference between testing the code and testing its own docstring.
 */
const BLOCK_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, 'g');
const LINE_COMMENT = new RegExp(String.raw`^\s*//.*$`, 'gm');

const code = (...p: string[]): string =>
  read(...p)
    .replace(BLOCK_COMMENT, '')
    .replace(LINE_COMMENT, '');
const route = (...p: string[]): boolean => existsSync(join(PORTAL, ...p, 'page.tsx'));

/* ==========================================================================
 * 1. Routes that were promised and did not exist
 * ======================================================================== */

describe('the routes two comments promised', () => {
  it('has a tracking route, which the order layout and OrderNav both named', () => {
    expect(route('orders', '[orderNumber]', 'tracking')).toBe(true);
    // And the tab strip reaches it, so it is not a route only a URL can find.
    expect(read('orders', '[orderNumber]', 'OrderNav.tsx')).toContain("segment: '/tracking'");
  });

  it('shows no carrier, AWB or ETA on it, because nothing writes one', () => {
    // `logistics.shipment` and `logistics.shipment_tracking` model all three and
    // have no writer anywhere in this product. Rendering a courier reference
    // from nothing would be the first fabricated fact on a buyer's screen.
    // Comments stripped: the docblock explaining why these are absent names
    // all three, and testing a file's own docstring proves nothing.
    const tracking = code('orders', '[orderNumber]', 'tracking', 'Tracking.tsx');
    expect(tracking).not.toMatch(/\bawb\b/i);
    expect(tracking).not.toMatch(/estimated delivery/i);
    // What is absent says what will bring it, rather than sitting as an empty row.
    expect(tracking).toContain('No carrier scan has reached us');

    const ops = readFileSync(join(API, 'modules', 'identity', 'ops.controller.ts'), 'utf8');
    expect(ops).toContain('logistics.shipment has no writer');
  });

  it('has a claims list, so the figure the warranty board counts can be opened', () => {
    expect(route('warranty', 'claims')).toBe(true);
    // "2 of 11 raised" counted every claim; the board linked only the open one
    // on a machine, because the register query excludes CLOSED and REJECTED.
    const board = read('warranty', 'WarrantyBoard.tsx');
    expect(board).toContain('href="/warranty/claims"');
  });
});

/* ==========================================================================
 * 2. A document named must be a document produced
 * ======================================================================== */

describe('our order confirmation', () => {
  it('is a PDF, not the words "This page"', () => {
    const record = read('orders', '[orderNumber]', 'OrderRecord.tsx');
    expect(record).toContain('confirmation.pdf');
    // The literal string that used to be the value of a named document.
    expect(record).not.toMatch(/<dd>This page<\/dd>/);
  });

  it('is reachable on a buyer route, gated on reading the order', () => {
    const controller = readFileSync(
      join(API, 'modules', 'ordering', 'ordering.controller.ts'),
      'utf8',
    );
    expect(controller).toContain("@Get('orders/:orderNumber/confirmation.pdf')");
    // A confirmation is not an invoice: every seat that may read the order may
    // read what was ordered, including an approver deciding whether to sign.
    const at = controller.indexOf("@Get('orders/:orderNumber/confirmation.pdf')");
    expect(controller.slice(at, at + 260)).toContain("@RequirePermissions('ordering.own.read')");
    // Streamed as bytes: a returned Buffer is serialised to JSON by default and
    // sent under the PDF content type, which every reader refuses.
    expect(controller).toContain('new StreamableFile(document.bytes)');
  });

  it('no longer restates a link the record’s own tab strip already draws', () => {
    const record = read('orders', '[orderNumber]', 'OrderRecord.tsx');
    expect(record).not.toContain('>Documents on this order<\n');
  });
});

/* ==========================================================================
 * 3. One case screen, in one file
 * ======================================================================== */

describe('the case screens', () => {
  it('render through one CaseRecord rather than two copies', () => {
    expect(existsSync(join(PORTAL, 'cases', 'CaseRecord.tsx'))).toBe(true);
    for (const f of [
      ['returns', '[returnNumber]', 'ReturnRecord.tsx'],
      ['warranty', 'claims', '[claimNumber]', 'ClaimRecord.tsx'],
    ] as const) {
      const source = read(...f);
      expect(source).toContain('CaseRecord');
      // The ~140 identical lines: the phase machine and all four states that
      // are not the record live in one place now.
      expect(source).not.toContain("k: 'signed-out'");
      expect(source).not.toContain('function LoadingRecord');
      expect(source).not.toContain('function Missing');
    }
  });

  it('share the form shell and the refusal, which were character-identical', () => {
    expect(existsSync(join(PORTAL, 'cases', 'CaseForm.tsx'))).toBe(true);
    for (const f of [
      ['returns', 'new', 'ReturnForm.tsx'],
      ['warranty', 'claims', 'new', 'ClaimForm.tsx'],
    ] as const) {
      const source = read(...f);
      expect(source).toContain('CaseFormShell');
      // The local copies of `Refusal` are gone.
      expect(source).not.toMatch(/^function Refusal\(/m);
    }
  });

  it('keeps the two forms as two forms, which is the honest half of the merge', () => {
    // The records were one screen: ~140 of ~300 lines identical apart from a
    // noun, and the same layout. The forms are not — 76 shared substantive
    // lines against 278 unique — so only the shell is shared. Forcing one
    // component would mean passing the picker, the picklist, the field set and
    // the submit as props: the whole form as configuration.
    const returns = read('returns', 'new', 'ReturnForm.tsx');
    const claims = read('warranty', 'claims', 'new', 'ClaimForm.tsx');
    // A return picks several machines off one order; a claim picks one off
    // everything the buyer owns.
    expect(returns).toContain('type="checkbox"');
    expect(claims).toContain('<select');
  });
});

/* ==========================================================================
 * 4. One source per fact
 * ======================================================================== */

describe('pending approvals', () => {
  it('reach Home from the same place the board reads, not a second DTO', () => {
    // Home rendered `/orders/summary`'s own `PendingApproval` while `/approvals`
    // rendered `ApprovalRow` — two endpoints, two shapes, the same rows.
    const home = code('home', 'Home.tsx');
    expect(home).not.toContain('PendingApproval');
    expect(home).toContain('ApprovalRow');
    expect(home).toContain('const { approvals } = usePortal()');
  });
});

/* ==========================================================================
 * 5. Dead ends
 * ======================================================================== */

describe('the ways in', () => {
  it('reaches every rail destination from Home', () => {
    const home = read('home', 'Home.tsx');
    const nav = read('shell', 'nav.ts');
    const destinations = [...nav.matchAll(/to: '([^']+)'/g)].map((m) => m[1]!);
    expect(destinations.length).toBe(8);
    for (const to of destinations) {
      if (to === '/home') continue;
      // Either spelling of a link to it.
      expect(home.includes(`'${to}'`) || home.includes(`"${to}"`)).toBe(true);
    }
  });

  it('keeps a serial’s primary click inside the portal', () => {
    const record = read('orders', '[orderNumber]', 'OrderRecord.tsx');
    // It used to go to /unit/[serial] — the public passport, outside the portal
    // chrome — so a buyer checking a machine on their own order left the portal.
    expect(record).toContain('/units#');
    expect(record).not.toMatch(/href=\{`\/unit\/\$\{m\.serialNumber\}`\}/);
  });

  it('searches the buyer’s own orders from the masthead, offering the catalogue', () => {
    const shell = read('shell', 'PortalShell.tsx');
    expect(shell).toContain('/orders?q=');
    expect(shell).toContain('Search the catalogue instead');
  });

  it('leads back to the shop from the wordmark and from the account menu', () => {
    // Every rail entry is something already bought. The portal had no door to
    // the catalogue at all, and the wordmark pointed at the portal Home the
    // rail's first entry already opens.
    const shell = code('shell', 'PortalShell.tsx');
    expect(shell).toContain('<Link href="/" aria-label="Trugrade home" className="hub-mast__brand">');
    expect(shell).not.toContain('href="/home" aria-label="Buyer portal home"');
    expect(shell).toContain('Start purchasing');
  });
});

/* ==========================================================================
 * 6. Every portal route has a page, and none is orphaned
 * ======================================================================== */

describe('the route tree', () => {
  it('gives every directory that holds a screen a page.tsx', () => {
    const orphans: string[] = [];
    const walk = (dir: string, rel = ''): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      const tsx = entries.filter((e) => e.isFile() && e.name.endsWith('.tsx'));
      const hasScreen = tsx.some((e) => /^[A-Z]/.test(e.name) && !e.name.includes('.spec.'));
      const hasPage = tsx.some((e) => e.name === 'page.tsx');
      // `cases/` and `shell/` hold shared components, not routes.
      const shared = rel === 'cases' || rel === 'shell' || rel.startsWith('profile');
      if (hasScreen && !hasPage && !shared) orphans.push(rel || '.');
      for (const e of entries.filter((x) => x.isDirectory())) {
        walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
    };
    walk(PORTAL);
    expect(orphans).toEqual([]);
  });
});
