/**
 * Stage 8 §6 — zero horizontal page overflow, at four widths, on every portal
 * route.
 *
 * 1700 is the wide desktop the hub's 1800px `--maxw` was raised for, 1280 a
 * laptop, 900 the tablet where the rail collapses, and 420 a phone. A board that
 * scrolls sideways at 420 is the commonest way a table-shaped screen fails, and
 * it is invisible to every jsdom test in this repo because jsdom has no layout.
 *
 * A deliberate scroller is not overflow: `DataBoard` wraps its table in an
 * `overflow-x: auto` container on purpose, and the check ignores anything
 * inside one. What it catches is the PAGE scrolling, which no design here asks
 * for.
 */
import type { Browser, Page } from 'playwright';
import { PORTAL_ROUTES, STOREFRONT, WIDTHS, openBrowser, overflow, signIn } from './support/portal';
import { anApprovalId, anOrderNumber } from './support/portal';

/**
 * Acme's owner: a verified buyer org with orders, so no route lands on a 404,
 * and the only seat that can open all eight rail entries.
 *
 * A different seat from the one `first-order.spec.ts` uses, deliberately. A
 * code budget is per account, and two spec files signing in as the same person
 * inside the same hour spend one budget twice.
 */
const OWNER = process.env.E2E_OWNER ?? 'owner@acme.example';

let browser: Browser;
let page: Page;
let order: string;
let approval: string;

beforeAll(async () => {
  browser = await openBrowser();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, OWNER);
  order = await anOrderNumber(page);
  const found = await anApprovalId(page);
  approval = found.id;
  console.log(
    `sweep — order ${order}; approval ${approval}` +
      `${found.real ? '' : ' (no live approval: measuring the refusal state)'}`,
  );
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

describe('the buyer portal', () => {
  const cases = WIDTHS.flatMap((width) => PORTAL_ROUTES.map((route) => ({ width, route })));

  it.each(cases)('does not scroll sideways at $width on $route', async ({ width, route }) => {
    const path = route.replace(':order', order).replace(':approval', approval);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${STOREFRONT}${path}`, { waitUntil: 'networkidle' });
    // The rail and the boards render after the session resolves; without this
    // the measurement is of a skeleton, which never overflows.
    await page.waitForSelector('.hub-main, main', { timeout: 30_000 });

    const { over, culprit } = await overflow(page);
    expect(`${path} @${width}: ${over}px${culprit ? ` — ${culprit}` : ''}`).toBe(
      `${path} @${width}: 0px`,
    );
  });
});

/* ==========================================================================
 * The measurement itself
 * ======================================================================== */

describe('the overflow check', () => {
  it('fails on a page that really does scroll sideways', async () => {
    // Sixty-four green ticks prove nothing if the detector cannot go red. This
    // widens one element past the viewport and asserts the check notices, so a
    // future change that quietly breaks the measurement breaks this instead.
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`${STOREFRONT}/home`, { waitUntil: 'networkidle' });
    expect((await overflow(page)).over).toBe(0);

    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.cssText = 'width:2000px;height:20px';
      wide.id = 'deliberate-overflow';
      document.body.appendChild(wide);
    });

    const dirty = await overflow(page);
    expect(dirty.over).toBeGreaterThan(1000);
    expect(dirty.culprit).toContain('reaches');

    await page.evaluate(() => document.getElementById('deliberate-overflow')?.remove());
    expect((await overflow(page)).over).toBe(0);
  });
});
