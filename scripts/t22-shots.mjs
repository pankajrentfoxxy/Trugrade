/**
 * T22 review captures: `/account/orders/[orderNumber]/documents`, every state,
 * both themes, 1440/900/600.
 *
 * Nothing is stubbed and nothing is seeded for the occasion. Every board below
 * is the real route reading `GET /api/buyer/orders/:orderNumber/documents`,
 * signed in as the buyer whose organisation placed the thirteen orders on this
 * database. The states are interesting because the ORDERS are in different
 * places, not because anything was moved for the photograph:
 *
 *   TT-26-00001   dispatched, so its tax invoice exists — the only order on the
 *                 database whose machines have left. `prisma/seed/invoicing.ts`
 *                 moves it and `POST /api/ops/orders/TT-26-00001/invoices`
 *                 raises the invoice through the real numbering.
 *   TT-26-00004   two consignments, still being picked. The hero of the empty
 *                 state: a proforma that exists, two tax invoices that do not,
 *                 and two e-way bills that say they come at pickup.
 *   TT-26-00005   a MARGIN consignment — Rule 32(5), thinner input credit, and
 *                 the flag that says so.
 *   TT-26-00007   awaiting an approval inside the buyer's organisation, so even
 *                 the proforma is not raised yet.
 *   TT-26-00011   cancelled. Nothing to bill, and the rows say why.
 *
 * The **no-permission** arm is real too, and it is the one worth looking at:
 * `buyer@acme.example` is a `CUSTOMER_BUYER`, whose role does not carry
 * `payment.invoice.read_own`, so the API genuinely answers 403 and the screen
 * renders the refusal with a way forward. Nothing is faked to produce it.
 *
 * Loading and the failure arm need nothing moved: the response is held open for
 * one and dropped for the other, the way a slow and a lost network do it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

/** CUSTOMER_OWNER — carries `payment.invoice.read_own`. */
const FINANCE = { email: 'owner@acme.example', password: 'Trugrade!Demo2026' };
/** CUSTOMER_BUYER — places orders, and may not read the organisation's invoices. */
const PROCURER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** Each capture, as the order that produces it. */
const VIEWS = [
  ['issued', 'TT-26-00001'],
  ['awaiting-dispatch', 'TT-26-00004'],
  ['margin', 'TT-26-00005'],
  ['awaiting-approval', 'TT-26-00007'],
  ['cancelled', 'TT-26-00011'],
  ['no-such-order', 'TT-26-09999'],
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
 * One sign-in per persona for the whole run, replayed into every context.
 *
 * `POST /auth/login` is limited to 20 per IP per 15 minutes and this run opens
 * two dozen contexts. Nothing here forges a session; it replays the real cookies
 * the real sign-in set.
 */
const sessions = new Map();

async function sessionFor(browser, who) {
  const cached = sessions.get(who.email);
  if (cached) return cached;
  const context = await browser.newContext();
  const res = await context.request.post(`${SHOP}/api/auth/login`, { data: who });
  if (!res.ok()) throw new Error(`sign-in failed for ${who.email}: ${res.status()}`);
  const state = await context.storageState();
  await context.close();
  sessions.set(who.email, state);
  return state;
}

async function open(browser, theme, { as = FINANCE, signedIn = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1500 },
    storageState: signedIn ? await sessionFor(browser, as) : undefined,
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

const visit = async (page, order, suffix = '/documents') => {
  await page.goto(`${SHOP}/account/orders/${order}${suffix}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

async function run() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      for (const [name, order] of VIEWS) {
        const { context, page } = await open(browser, theme);
        await visit(page, order);
        await capture(page, `T22-${name}-${theme}`, name === 'issued' ? [900, 600] : [600]);
        await context.close();
      }

      // --- the order record's pointer at this screen ------------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, 'TT-26-00004', '');
        await capture(page, `T22-record-pointer-${theme}`, []);
        await context.close();
      }

      // --- a colleague without the finance role. A REAL 403 -----------------
      {
        const { context, page } = await open(browser, theme, { as: PROCURER });
        await visit(page, 'TT-26-00001');
        await capture(page, `T22-no-permission-${theme}`, [600]);
        await context.close();
      }

      // --- signed out -------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, 'TT-26-00001');
        await capture(page, `T22-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open, so the skeleton rows are on
      //     screen under a header that is already real ----------------------
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/*/documents', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/orders/TT-26-00004/documents`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T22-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/*/documents', (route) => route.abort('failed'));
        await visit(page, 'TT-26-00004');
        await capture(page, `T22-error-${theme}`, [600]);
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
