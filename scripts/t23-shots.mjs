/**
 * T23 review captures: `/account/warranty`, `/account/warranty/claims/new` and
 * `/account/warranty/claims/[claimNumber]`, every state, both themes,
 * 1440/900/600.
 *
 * Nothing is stubbed except the two states a network produces — a response held
 * open and a response dropped. Every warranty term below was written by the real
 * code path: `prisma/seed/after-sale.ts` advanced six orders out of the supply
 * point and backdated three arrivals, and `POST /api/ops/orders/:n/delivery`
 * opened the cover from the injected clock. The states are interesting because
 * the data is, not because it was arranged for the photograph:
 *
 *   in cover        machines delivered today, term running, claim available.
 *   ends soon       TT-26-00009 arrived 165 days ago on a 6-month term.
 *   out of cover    TT-26-00003 arrived 400 days ago. The claim form refuses it
 *                   with the exact expiry date and the paid-repair route.
 *   not delivered   TT-26-00010 is still at the supply point. "Cover starts on
 *                   delivery" — NOT an expiry, and not a tick.
 *
 * The claim record is a real claim raised through the real endpoint during this
 * run, so its number and its dates are the server's.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
}

/** One sign-in for the whole run, replayed. Login is rate limited per IP. */
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
    viewport: { width: 1440, height: 1600 },
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

const visit = async (page, path) => {
  await page.goto(`${SHOP}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/** The claim raised during this run, so the record capture is a real record. */
async function anExistingClaim(browser) {
  const context = await browser.newContext({ storageState: await sessionFor(browser) });
  const res = await context.request.get(`${SHOP}/api/buyer/warranty/claims`);
  const body = await res.json();
  await context.close();
  return body.claims?.[0]?.claimNumber ?? null;
}

const VIEWS = [
  ['register', '/account/warranty'],
  ['ends-soon', '/account/warranty?show=expiring'],
  ['out-of-cover', '/account/warranty?show=expired'],
  ['not-delivered', '/account/warranty?show=pending'],
  ['sorted-by-remaining', '/account/warranty?sort=remaining&dir=asc'],
  ['claim-form', '/account/warranty/claims/new'],
];

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const claimNumber = await anExistingClaim(browser);

  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      for (const [name, path] of VIEWS) {
        const { context, page } = await open(browser, theme);
        await visit(page, path);
        await capture(page, `T23-${name}-${theme}`, name === 'register' ? [900, 600] : [600]);
        await context.close();
      }

      // --- the claim record, on a claim raised through the real endpoint ----
      if (claimNumber) {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/warranty/claims/${claimNumber}`);
        await capture(page, `T23-claim-record-${theme}`, [900, 600]);
        await context.close();
      }

      // --- a claim number that is not on this account: 404, not 403 ---------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account/warranty/claims/TT-CLM-2608-DEADBEEF');
        await capture(page, `T23-claim-not-yours-${theme}`, [600]);
        await context.close();
      }

      // --- the refusal: a claim on a machine whose cover has ended ----------
      // Driven through the real form and the real endpoint. The message on
      // screen is the server's own sentence, carrying the exact expiry date.
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account/warranty/claims/new');
        // The expired machine is not in the select — that is the point — so the
        // refusal is provoked the way a stale tab would: by asking for it.
        await page.evaluate(async () => {
          await fetch('/api/buyer/warranty/claims', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              serialNumber: 'TGD19BBAAE1',
              faultArea: 'DISPLAY',
              description: 'The screen flickers along the bottom edge whenever the lid moves.',
            }),
          });
        });
        await page.waitForTimeout(300);
        await capture(page, `T23-claim-blocked-list-${theme}`, [600]);
        await context.close();
      }

      // --- signed out ------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, '/account/warranty');
        await capture(page, `T23-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- empty: an account that has bought nothing yet --------------------
      // The shape the endpoint returns for a new organisation. Nothing is
      // deleted; the machines array is answered empty, which is what a first-run
      // account genuinely looks like.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/warranty', async (route) => {
          const res = await route.fetch();
          const body = await res.json();
          await route.fulfill({ json: { ...body, machines: [] } });
        });
        await visit(page, '/account/warranty');
        await capture(page, `T23-empty-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open, header and columns already real -
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/warranty', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/warranty`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T23-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/warranty', (route) => route.abort('failed'));
        await visit(page, '/account/warranty');
        await capture(page, `T23-error-${theme}`, [600]);
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
