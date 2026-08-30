/**
 * T21 review captures: `/account/orders/[orderNumber]/units`, every state, both
 * themes, 1440/900/600.
 *
 * Nothing is stubbed and nothing is seeded for the occasion. Every board below
 * is the real route reading `GET /api/buyer/orders/:orderNumber/units`, signed
 * in as the buyer whose organisation placed the thirteen orders on this
 * database. The interesting rows are interesting because `prisma/seed/qc-spread.ts`
 * gave the QC estate the spread a real intake produces — they are not moved into
 * place for the photograph:
 *
 *   TT-26-00004   six machines, two re-graded to A+ after inspection, three
 *                 carrying a note. The hero.
 *   TT-26-00005   a seal found BROKEN at handover, under a passing inspection.
 *   TT-26-00009   the one machine on the platform with NO battery reading, plus
 *                 a machine re-graded down to B.
 *   TT-26-00010   a FAIL.
 *   TT-26-00013   a spec MISMATCH, on a one-machine order.
 *
 * Loading and the failure arm need nothing moved: the response is held open for
 * one and dropped for the other, the way a slow and a lost network do it.
 *
 * The empty arm is the only one that cannot be reached from real data — every
 * order on this database has its machines allocated, which is what the spec says
 * should be true post-confirmation. It is captured by answering the endpoint
 * with an order that has no units, which is the shape the API returns before
 * allocation, rather than by deleting rows.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** Each capture, as the order and query string that produces it. */
const VIEWS = [
  ['board', 'TT-26-00004', ''],
  ['regraded', 'TT-26-00004', '?sort=score&dir=asc'],
  ['broken-seal', 'TT-26-00005', ''],
  ['not-measured', 'TT-26-00009', ''],
  ['not-measured-sorted', 'TT-26-00009', '?sort=battery&dir=asc'],
  ['fail', 'TT-26-00010', ''],
  ['mismatch', 'TT-26-00013', ''],
  ['attention-only', 'TT-26-00004', '?show=attention'],
  ['attention-none', 'TT-26-00006', '?show=attention'],
  ['no-such-order', 'TT-26-09999', ''],
];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1500 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1500 });
}

/**
 * One sign-in for the whole run, replayed into every context.
 *
 * `POST /auth/login` is limited to 20 per IP per 15 minutes and this run opens
 * two dozen contexts. Nothing here forges a session; it replays the real
 * cookies the real sign-in set.
 */
let session = null;

async function sessionFor(browser) {
  if (session) return session;
  const context = await browser.newContext();
  const res = await context.request.post(`${SHOP}/api/auth/login`, { data: BUYER });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
  session = await context.storageState();
  await context.close();
  return session;
}

async function open(browser, theme, { signedIn = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1500 },
    storageState: signedIn ? await sessionFor(browser) : undefined,
  });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);
    else hide();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { context, page };
}

const visit = async (page, order, suffix) => {
  await page.goto(`${SHOP}/account/orders/${order}/units${suffix}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

async function run() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      for (const [name, order, suffix] of VIEWS) {
        const { context, page } = await open(browser, theme);
        await visit(page, order, suffix);
        await capture(page, `T21-${name}-${theme}`, name === 'board' ? [900, 600] : [600]);
        await context.close();
      }

      // --- signed out ------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, 'TT-26-00004', '');
        await capture(page, `T21-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- empty: an order whose machines are not yet allocated ------------
      // The shape the endpoint returns before confirmation. Nothing is deleted;
      // the response is answered with an empty `units` array, which is what a
      // pre-allocation order genuinely looks like.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/*/units', async (route) => {
          const res = await route.fetch();
          const body = await res.json();
          await route.fulfill({ json: { ...body, units: [] } });
        });
        await visit(page, 'TT-26-00004', '');
        await capture(page, `T21-empty-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open, so the skeleton rows are on
      //     screen under a header that is already real -----------------------
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/*/units', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/orders/TT-26-00004/units`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T21-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/*/units', (route) => route.abort('failed'));
        await visit(page, 'TT-26-00004', '');
        await capture(page, `T21-error-${theme}`, [600]);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
