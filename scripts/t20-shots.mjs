/**
 * T20 review captures: `/account/orders`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed, nothing is seeded and nothing is moved. The board below
 * is the real route reading `GET /api/buyer/orders`, signed in as the buyer
 * whose organisation placed the thirteen orders on this database.
 *
 * **Every filtered state is reached by a URL, not by a mock**, which is the
 * point of the task: the board's whole state is in the address bar, so a
 * capture script that visits an address is exercising exactly what a colleague
 * receiving a pasted link gets. The applied-filter capture navigates by URL and
 * the screenshot shows the rail already ticked, the chip already there and the
 * count already narrowed — none of which was clicked.
 *
 * The searches use real values off this database:
 *   TT-26-00004     our order number
 *   PO/2026/00417   the buyer's OWN PO reference, on seven orders
 *   TGD88B6C311     a serial on TT-26-00004
 *
 * Loading and the failure arm need nothing moved: the response is held open for
 * one and dropped for the other, the way a slow and a lost network do it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** Every board state, as the URL that produces it. */
const VIEWS = [
  ['list', ''],
  ['filtered-status', '?status=AWAITING_APPROVAL'],
  ['filtered-site', '?status=PAYMENT_PENDING&site=SITE'],
  ['search-order-number', '?q=TT-26-00004'],
  ['search-po-reference', '?q=PO%2F2026%2F00417'],
  ['search-serial', '?q=TGD88B6C311'],
  ['search-nothing', '?q=TT-26-09999'],
  ['sorted-by-value', '?sort=value'],
  ['page-2', '?page=2'],
  ['per-50', '?per=50&sort=oldest'],
];

/* --------------------------------------------------------------------- utils */

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

const visit = async (page, suffix) => {
  await page.goto(`${SHOP}/account/orders${suffix}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/**
 * The buyer's own Gurugram delivery site, by id.
 *
 * Read off the board's own facet response rather than typed in, because the id
 * is generated per seed run and a hard-coded uuid is a capture that silently
 * stops filtering the moment the database is reset.
 */
async function siteId(browser) {
  const context = await browser.newContext({ storageState: await sessionFor(browser) });
  const res = await context.request.get(`${SHOP}/api/buyer/orders?per=5`);
  const body = await res.json();
  await context.close();
  const site = body.facets.site.find((s) => s.label.includes('Gurugram')) ?? body.facets.site[0];
  return site.value;
}

/* ---------------------------------------------------------------------- run */

async function run() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    const site = await siteId(browser);
    console.log('delivery site facet:', site);

    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      for (const [name, suffix] of VIEWS) {
        const { context, page } = await open(browser, theme);
        await visit(page, suffix.replace('SITE', site));
        await capture(page, `T20-${name}-${theme}`, name === 'list' ? [900, 600] : [600]);
        await context.close();
      }

      // --- the rail as a sheet, under 900px --------------------------------
      {
        const { context, page } = await open(browser, theme);
        await page.setViewportSize({ width: 600, height: 1200 });
        await visit(page, '');
        await page.getByRole('button', { name: /^Filters/ }).click();
        await page.waitForTimeout(400);
        await shot(page, `T20-filter-sheet-${theme}-600`);
        await context.close();
      }

      // --- signed out ------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, '');
        await capture(page, `T20-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open, so the skeleton rows are on
      //     screen under a header that is already real -----------------------
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders?**', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/orders`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T20-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders?**', (route) => route.abort('failed'));
        await visit(page, '');
        await capture(page, `T20-error-${theme}`, [600]);
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
