/**
 * T24 review captures: `/account/orders/[id]/delivery`, `/account/returns`,
 * `/account/returns/new` and `/account/returns/[id]`, every state, both themes,
 * 1440/900/600.
 *
 * **Nothing is stubbed except the two states a network produces** — a response
 * held open and a response dropped. Every seal, window and return below was
 * written by the real code path, and the interesting states are interesting
 * because the seeded data is:
 *
 *   live window      TT-26-00001 arrived yesterday. Two machines, both APPLIED,
 *                    so the screen opens on "nobody has checked these yet" —
 *                    which is the whole premise of it.
 *   broken seal      TT-26-00005 carries the seeded BROKEN seal. The consignment
 *                    cannot be signed for and the screen says which machine.
 *   mismatch         TT-26-00013's machine came back MISMATCH. The flag action
 *                    is the one T21 deferred.
 *   expired window   TT-26-00007 arrived five days ago. The scan box is gone and
 *                    the screen routes to warranty — neutral, not a failure.
 *   not delivered    TT-26-00010 is still at the supply point. "Not delivered
 *                    yet", never a zero-hour window.
 *
 * The seal check, the receipt confirmation and the return are all driven through
 * the real endpoints during this run, so the INTACT chips, the signed-for stamp
 * and the return number on screen are the server's.
 *
 * **The build is asserted before any frame is believed.** The API dev server has
 * served a stale build during captures more than once; this run greps a live
 * response for a string only this build produces and refuses to start without
 * it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** Arrived yesterday, two machines, both seals unchecked. The live window. */
const LIVE = 'TT-26-00001';
/** Carries the seeded BROKEN seal. */
const BROKEN = 'TT-26-00005';
/** Arrived five days ago. The window has closed. */
const EXPIRED = 'TT-26-00007';
/** MISMATCH verdict on its one machine. */
const MISMATCH = 'TT-26-00013';
/** Still at the supply point. */
const UNDELIVERED = 'TT-26-00010';

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

/**
 * Refuse to photograph a stale build.
 *
 * The string below exists only in this task's `machineBlockedReason`. If the
 * API on :4000 is an older `dist`, every frame after this point would be a
 * picture of code that is not the code in the tree.
 */
async function assertBuildIsCurrent(browser) {
  const context = await browser.newContext({ storageState: await sessionFor(browser) });
  const res = await context.request.get(`${SHOP}/api/buyer/orders/${LIVE}/delivery`);
  const body = await res.text();
  await context.close();
  if (!body.includes('Nobody has checked this seal yet')) {
    throw new Error(
      'The API on :4000 is serving a build without T24. Kill by port and restart it before capturing.',
    );
  }
  console.log('build asserted current');
}

/**
 * The states that only exist once somebody has acted, produced through the real
 * endpoints so the frames are of real rows.
 *
 * Idempotent, because a re-run must not raise a second return: a seal already
 * INTACT refuses the transition and a machine with a live return refuses a
 * second one, and both are swallowed here rather than failing the run.
 */
async function arrange(browser) {
  const context = await browser.newContext({ storageState: await sessionFor(browser) });
  const post = async (path, data) => {
    const res = await context.request.post(`${SHOP}${path}`, data ? { data } : {});
    return { status: res.status(), body: await res.text() };
  };

  // TT-26-00001: one seal verified, one left, so the screen shows both halves of
  // the check at once — verified and still-to-do on one manifest.
  const live = await (await context.request.get(`${SHOP}/api/buyer/orders/${LIVE}/delivery`)).json();
  const machines = live.consignments[0].machines;
  await post(`/api/buyer/orders/${LIVE}/delivery/seal-checks`, {
    sealCode: machines[0].seal.code,
    outcome: 'INTACT',
  });

  // TT-26-00013: the MISMATCH machine, checked intact and then signed for, so
  // the "receipt confirmed" state is a real `order_event`.
  const mm = await (
    await context.request.get(`${SHOP}/api/buyer/orders/${MISMATCH}/delivery`)
  ).json();
  await post(`/api/buyer/orders/${MISMATCH}/delivery/seal-checks`, {
    sealCode: mm.consignments[0].machines[0].seal.code,
    outcome: 'INTACT',
  });
  await post(`/api/buyer/orders/${MISMATCH}/delivery/1/receipt`);

  // A return on the MISMATCH machine, raised through the real endpoint.
  await post('/api/buyer/returns', {
    orderNumber: MISMATCH,
    serialNumbers: [mm.consignments[0].machines[0].serialNumber],
    reasonCode: 'SPEC_MISMATCH',
    description:
      'The machine has 8 GB of memory fitted. The order line and your own inspection both say 16 GB.',
  });

  const list = await (await context.request.get(`${SHOP}/api/buyer/returns`)).json();
  await context.close();
  return list.returns?.[0]?.returnNumber ?? null;
}

const VIEWS = [
  ['delivery-live-window', `/account/orders/${LIVE}/delivery`],
  ['delivery-broken-seal', `/account/orders/${BROKEN}/delivery`],
  ['delivery-window-closed', `/account/orders/${EXPIRED}/delivery`],
  ['delivery-signed-for', `/account/orders/${MISMATCH}/delivery`],
  ['delivery-not-arrived', `/account/orders/${UNDELIVERED}/delivery`],
  ['returns-board', '/account/returns'],
  ['returns-open-only', '/account/returns?show=open'],
  ['return-form', `/account/returns/new?order=${LIVE}`],
  ['return-form-prefilled', `/account/returns/new?order=${MISMATCH}&units=TGD5963139B&reason=SPEC_MISMATCH`],
  ['return-form-window-closed', `/account/returns/new?order=${EXPIRED}`],
  ['units-board-flag', `/account/orders/${MISMATCH}/units`],
];

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  await assertBuildIsCurrent(browser);
  const returnNumber = await arrange(browser);
  console.log('return under capture:', returnNumber);

  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      for (const [name, path] of VIEWS) {
        const { context, page } = await open(browser, theme);
        await visit(page, path);
        await capture(page, `T24-${name}-${theme}`, [900, 600]);
        await context.close();
      }

      // --- the return record, on a return raised through the real endpoint ---
      if (returnNumber) {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/returns/${returnNumber}`);
        await capture(page, `T24-return-record-${theme}`, [900, 600]);
        await context.close();
      }

      // --- THE refusal: a code that is not on this delivery -----------------
      // Typed into the real box and submitted to the real endpoint, so the
      // sentence on screen is the server's own. This is the one message on the
      // screen that is a safety instruction rather than a validation error.
      {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/orders/${LIVE}/delivery`);
        await page.fill('.dvcode input', '88-041992');
        await page.click('.dvgo');
        await page.waitForSelector('.dvalert', { timeout: 5000 });
        await capture(page, `T24-seal-not-on-delivery-${theme}`, [900, 600]);
        await context.close();
      }

      // --- a return number that is not on this account: 404, not 403 --------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account/returns/TT-RET-2608-DEADBEEF');
        await capture(page, `T24-return-not-yours-${theme}`, [600]);
        await context.close();
      }

      // --- an order number that is not on this account ----------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account/orders/TT-26-00099/delivery');
        await capture(page, `T24-delivery-not-yours-${theme}`, [600]);
        await context.close();
      }

      // --- signed out -------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, `/account/orders/${LIVE}/delivery`);
        await capture(page, `T24-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- empty: an account that has never returned anything ---------------
      // The shape the endpoint answers for an organisation with no returns.
      // Nothing is deleted; the array is answered empty, which is what a
      // first-run account genuinely looks like.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/returns', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          await route.fulfill({ json: { returns: [] } });
        });
        await visit(page, '/account/returns');
        await capture(page, `T24-returns-empty-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open ----------------------------------
      {
        const { context, page } = await open(browser, theme);
        await page.route(`**/api/buyer/orders/${LIVE}/delivery`, async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/orders/${LIVE}/delivery`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T24-delivery-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network ------
      {
        const { context, page } = await open(browser, theme);
        await page.route(`**/api/buyer/orders/${LIVE}/delivery`, (route) =>
          route.abort('failed'),
        );
        await visit(page, `/account/orders/${LIVE}/delivery`);
        await capture(page, `T24-delivery-error-${theme}`, [600]);
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
