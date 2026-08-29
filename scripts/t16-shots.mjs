/**
 * T16 review captures: `/checkout`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed. Every screen is the real route, signed in as the seeded
 * buyer, driving the real six-step flow against the real API — which means every
 * `startCheckout` below takes a REAL twenty-minute hold on real serial numbers
 * and drops `listing.qty_available`. The script therefore releases each hold
 * through `DELETE /api/buyer/checkout/:cartId` — the same route the screen's own
 * "Leave checkout" link calls — before moving on. A run that leaked its holds
 * would starve the next state of stock, and it did exactly that once.
 *
 * Four states need the environment moved rather than a URL, and all four move
 * through the real column the real service reads:
 *
 * **PO reference required** needs `customer.org_preference.po_required = TRUE`.
 * The seed has it FALSE. It is set, captured, and set back.
 *
 * **The hold expiring** needs `ordering.checkout_hold.expires_at` brought
 * forward. That is the column the countdown reads and the column the
 * every-minute cron releases on, so bringing it forward is what a buyer who
 * stared at the screen for twenty minutes actually experiences — not a mocked
 * clock. Two values are used: +90 s for the under-two-minutes warn colour, and
 * +20 s to watch it reach 00:00 and the screen flip.
 *
 * **The race lost** needs somebody to have taken the units first. Supply Point B
 * · Palwal holds three of this model and no more, so one session holds all three
 * and a second session asks for them. The second is refused by `HoldService`,
 * through the real conflict, with the real sentence.
 *
 * **Error** is reached by stopping the API, and the API is started again after.
 *
 * The approval arm needs nothing moved: the seed gives Farah a
 * `buyer_approval_policy` at ₹2,00,000, so a cart above it holds stock and does
 * not confirm, and a cart below it places a real order with real serials and a
 * real purchase order per supply point.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };
/** The org owner. Used only as the OTHER side of the race. */
const OWNER = { email: 'owner@acme.example', password: 'Trugrade!Demo2026' };

/**
 * One supply point per state, because this script really buys machines.
 *
 * A full two-theme pass places two real orders and leaves two real
 * approval-held orders behind, so running every state through one lane empties
 * it — which is what refused the light run twice, with a true "only 1 of the 2
 * units you selected are still available" on the screen that was supposed to be
 * showing step 4. The seed carries ten supply points precisely so a run does not
 * have to. Each state below gets its own, with the ones that place orders on the
 * deepest lanes, and the transient holds (released in a `finally`) on the rest.
 */
const OFFERS = {
  /** F · Faridabad, 13 units at ₹53,500. The flow that ends in a real order. */
  flowA: '684e7ec5-a046-4ae8-b996-86f0fac44dbc',
  /** P · New Delhi, 10 at ₹43,500. Two supply points make one order. */
  flowB: '44eca3b5-7593-41dd-b088-b914b48163ce',
  /** J · Noida, 12 at ₹51,000, and D · Ghaziabad, 10 at ₹46,000 — six machines
      is ₹2,91,000, comfortably over the ₹2,00,000 the seeded policy sets. */
  approvalA: '6c900fc1-7230-407d-b3c7-f2375e7a1214',
  approvalB: '36c77714-d9e5-422d-a9a4-d4f478a64fc5',
  /** M · Gurugram, 12. Held and released. */
  transient: '303455ab-972b-4a8c-8d9f-475d1bd46d67',
  /** V · Sonipat, 10. The countdown runs on this one. */
  hold: 'b5f652b1-9ee4-460c-8049-7e43a01214ea',
  /** M · Gurugram, 8. The two states that never get past the first read. */
  brief: '796536a4-1234-41b9-b429-f5b8dbdd12b0',
  /** B · Palwal. Three units and no more. The last-unit race is run on this. */
  palwalB: '2204dba4-1631-43b9-822f-7282b9d5b38b',
};

const SITE = {
  /** Haryana 06 — the state we are registered in. CGST + SGST. */
  gurugram: 'Gurugram IT campus',
  /** Delhi 07 — a different state, still inside the NCR lane. IGST. */
  delhi: 'New Delhi head office',
  /** Karnataka 29 — outside the service area. The lane cannot be priced. */
  bengaluru: 'Bengaluru office',
};

const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();

const sql = (statement) =>
  execFileSync(
    'docker',
    ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-c', statement],
    { encoding: 'utf8' },
  ).trim();

const stopApi = () =>
  ps(
    'Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |' +
      ' ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; "stopped"',
  );

function startApi() {
  spawn('node', ['dist/main.js'], {
    cwd: 'apps/api',
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function waitFor(url, want) {
  for (let i = 0; i < 60; i += 1) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok === want) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} never became ${want ? 'up' : 'down'}`);
}

/* --------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(450);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(450);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(200);
}

/**
 * One sign-in per account for the whole run, replayed into every context.
 *
 * `POST /auth/login` is rate limited to 20 per IP per 15 minutes, and a
 * two-theme pass opens fourteen contexts. Signing in per context spent the
 * budget and the run died with a 429 halfway through the dark theme — so each
 * account signs in exactly once, and `storageState()` carries the real
 * `httpOnly` cookies the real sign-in set into every context after it. Nothing
 * here forges a session; it replays one.
 */
const sessions = new Map();

async function sessionFor(browser, who) {
  const cached = sessions.get(who.email);
  if (cached) return cached;
  const context = await browser.newContext();
  const res = await context.request.post(`${SHOP}/api/auth/login`, { data: who });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
  const state = await context.storageState();
  await context.close();
  sessions.set(who.email, state);
  return state;
}

async function open(browser, theme, { signedIn = true, who = BUYER } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    storageState: signedIn ? await sessionFor(browser, who) : undefined,
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

/* ---------------------------------------------------------------- cart state */

/**
 * Clear this run's carts — but expire their holds FIRST and let the cron release
 * them.
 *
 * `checkout_hold.cart_id` is `ON DELETE CASCADE`, so deleting a cart destroys
 * the hold rows without any of the code that took the hold ever running. The
 * units stay `RESERVED` and `qty_available` stays decremented — permanently, by
 * a DELETE. A crashed run of this script leaked stock exactly that way.
 */
async function resetCarts() {
  sql(`UPDATE ordering.checkout_hold SET expires_at = now() - interval '1 minute'
        WHERE user_id IN (SELECT id FROM identity.user_account
                           WHERE email IN ('${BUYER.email}', '${OWNER.email}'));`);
  for (let i = 0; i < 20; i += 1) {
    const left = sql('SELECT count(*) AS n FROM ordering.checkout_hold;');
    if (left.split('\n').some((row) => row.trim() === '0')) break;
    await new Promise((r) => setTimeout(r, 6000));
  }
  sql(
    `DELETE FROM ordering.cart WHERE user_id IN (
       SELECT id FROM identity.user_account
        WHERE email IN ('${BUYER.email}', '${OWNER.email}'));`,
  );
}

async function makeCart(request, name, lines) {
  const created = await request.post(`${SHOP}/api/buyer/carts`, { data: { name } });
  if (!created.ok()) throw new Error(`create ${name}: ${created.status()}`);
  const { id } = await created.json();
  for (const [listingId, qty] of lines) {
    const added = await request.post(`${SHOP}/api/buyer/carts/${id}/items`, {
      data: { listingId, qty },
    });
    if (!added.ok()) throw new Error(`add to ${name}: ${added.status()} ${await added.text()}`);
  }
  return id;
}

/** The real "Leave checkout" route. Never leave a hold behind. */
const release = (request, cartId) =>
  request.delete(`${SHOP}/api/buyer/checkout/${cartId}`).catch(() => undefined);

const enter = async (page, cartId) => {
  await page.goto(`${SHOP}/checkout?cart=${cartId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
};

const next = async (page) => {
  try {
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/../../scripts/tmp/stuck.png`, fullPage: true });
    console.log('[stuck]', (await page.locator('main, .empty').first().innerText()).slice(0, 400));
    throw e;
  }
  await page.waitForTimeout(1000);
};

/* ------------------------------------------------------------------ the run */

/** Signed out, and the visitor who arrived without a cart. Neither is a crash. */
async function entryStates(browser, theme) {
  const out = await open(browser, theme, { signedIn: false });
  await out.page.goto(`${SHOP}/checkout?cart=nothing`, { waitUntil: 'networkidle' });
  await out.page.waitForTimeout(1200);
  await capture(out.page, `T16-signed-out-${theme}`, [600]);
  await out.context.close();

  const { context, page } = await open(browser, theme);
  await page.goto(`${SHOP}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await capture(page, `T16-no-cart-${theme}`, [600]);
  await context.close();
}

/**
 * The six steps, in order, on a cart that spans two supply points — and the
 * tax split resolved against all three delivery states on the way through.
 */
async function walkTheFlow(browser, theme) {
  const { context, page } = await open(browser, theme);
  // Under ₹2,00,000, so this buyer may place it herself and the flow ends in a
  // real order rather than an approval.
  const cart = await makeCart(context.request, `Two supply points ${theme}`, [
    [OFFERS.flowA, 2],
    [OFFERS.flowB, 1],
  ]);
  await enter(page, cart);

  await capture(page, `T16-step1-review-${theme}`, [900, 600]);
  await next(page);
  await capture(page, `T16-step2-billing-${theme}`, [900, 600]);
  await next(page);
  await capture(page, `T16-step3-delivery-${theme}`, [900, 600]);

  // --- THE TAX SPLIT, resolved against each delivery state in turn ----------
  // Gurugram is Haryana 06, where we are registered: intra-state, so CGST +
  // SGST. New Delhi is 07: the movement terminates in another state, so
  // s.10(1)(a) makes the whole thing IGST. Nothing about the goods changed.
  for (const [name, label] of [
    ['cgst-sgst-gurugram', SITE.gurugram],
    ['igst-newdelhi', SITE.delhi],
  ]) {
    await page.getByText(label, { exact: true }).click();
    await page.waitForTimeout(1300);
    await capture(page, `T16-tax-${name}-${theme}`, [900, 600]);
    await page
      .locator('h2', { hasText: 'What this costs' })
      .locator('..')
      .screenshot({ path: `${OUT}/T16-breakup-${name}-${theme}.png` })
      .catch(() => undefined);
    console.log('captured', `T16-breakup-${name}-${theme}`);
  }

  // A lane we cannot price. Freight is "Not priced", never a zero.
  await page.getByText(SITE.bengaluru, { exact: true }).click();
  await page.waitForTimeout(1300);
  await capture(page, `T16-delivery-unpriced-${theme}`, [900, 600]);

  // …and the confirm step for that lane: the split is NOT resolved, the total
  // does not exist, and the primary action says why it is unavailable on the
  // screen rather than only in a tooltip.
  await next(page);
  await next(page);
  await next(page);
  await capture(page, `T16-confirm-unpriced-${theme}`, [900, 600]);

  // Back to a lane we can price, and on through the last three steps.
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForTimeout(600);
  await page.getByText(SITE.delhi, { exact: true }).click();
  await page.waitForTimeout(1300);
  await next(page);
  await capture(page, `T16-step4-reference-${theme}`, [900, 600]);
  await page.locator('#po').fill('PO/2026/00417');
  await page.locator('#cc').fill('IT — Delhi office');
  await page.waitForTimeout(300);
  await capture(page, `T16-step4-reference-filled-${theme}`, [600]);
  await next(page);
  await capture(page, `T16-step5-payment-${theme}`, [900, 600]);
  await next(page);
  await capture(page, `T16-step6-confirm-${theme}`, [900, 600]);

  // --- the order actually gets placed --------------------------------------
  await page.getByRole('button', { name: 'Place this order' }).click();
  await page.waitForTimeout(5000);
  await capture(page, `T16-order-placed-${theme}`, [900, 600]);

  await context.close();
}

/** `org_preference.po_required` is the real column, so it is what gets moved. */
async function poRequired(browser, theme) {
  sql(
    `UPDATE customer.org_preference SET po_required = TRUE
      WHERE org_id = (SELECT id FROM identity.organization
                       WHERE legal_name = 'Acme Industries Pvt. Ltd.');`,
  );
  const { context, page } = await open(browser, theme);
  const cart = await makeCart(context.request, `PO required ${theme}`, [[OFFERS.transient, 2]]);
  try {
    await enter(page, cart);
    await next(page);
    await next(page);
    await next(page);
    await capture(page, `T16-po-required-${theme}`, [600]);
    // Empty, and Continue refused with a sentence that says what to do.
    await next(page);
    await capture(page, `T16-po-required-refused-${theme}`, [900, 600]);
  } finally {
    await release(context.request, cart);
    sql(
      `UPDATE customer.org_preference SET po_required = FALSE
        WHERE org_id = (SELECT id FROM identity.organization
                         WHERE legal_name = 'Acme Industries Pvt. Ltd.');`,
    );
    await context.close();
  }
}

/**
 * Above the threshold: stock is held, the order does NOT confirm, and no
 * purchase order is raised. The seeded policy puts Farah's ceiling at ₹2,00,000.
 */
async function approvalRequired(browser, theme) {
  const { context, page } = await open(browser, theme);
  const cart = await makeCart(context.request, `Above threshold ${theme}`, [
    [OFFERS.approvalA, 3],
    [OFFERS.approvalB, 3],
  ]);
  await enter(page, cart);
  for (let i = 0; i < 2; i += 1) await next(page);
  await page.getByText(SITE.gurugram, { exact: true }).click();
  await page.waitForTimeout(1300);
  for (let i = 0; i < 3; i += 1) await next(page);
  await capture(page, `T16-approval-required-${theme}`, [900, 600]);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await page.waitForTimeout(5000);
  await capture(page, `T16-order-awaiting-approval-${theme}`, [900, 600]);
  await context.close();
}

/**
 * The countdown, running and then run out.
 *
 * `expires_at` is brought forward through the real column — the one the screen
 * reads and the one the every-minute cron releases on. Nothing here is a fake
 * clock: at 00:00 those machines really are back on sale.
 */
async function theHold(browser, theme) {
  const { context, page } = await open(browser, theme);
  const cart = await makeCart(context.request, `Hold ${theme}`, [[OFFERS.hold, 2]]);
  await enter(page, cart);

  // Under two minutes the figure changes colour as well as value.
  sql(
    `UPDATE ordering.checkout_hold SET expires_at = now() + interval '95 seconds'
      WHERE cart_id = '${cart}';`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await capture(page, `T16-hold-running-${theme}`, [600]);
  await page
    .locator('p', { hasText: 'These machines are held for' })
    .screenshot({ path: `${OUT}/T16-countdown-${theme}.png` });
  console.log('captured', `T16-countdown-${theme}`);

  // …and run out, on screen, while the buyer is standing there.
  sql(
    `UPDATE ordering.checkout_hold SET expires_at = now() + interval '12 seconds'
      WHERE cart_id = '${cart}';`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(15000);
  await capture(page, `T16-hold-expired-${theme}`, [600]);
  await release(context.request, cart);
  await context.close();
}

/**
 * Two buyers, three machines, and only one of them gets them.
 *
 * Supply Point B · Palwal carries three units of this model and no more. The
 * first session holds all three; the second asks for the same three and is
 * refused by `HoldService` before anything is charged, anything is ordered, or
 * either buyer sees a half-finished screen.
 */
async function raceLost(browser, theme) {
  const winner = await open(browser, theme);
  const loser = await open(browser, theme, { who: OWNER });
  const wonCart = await makeCart(winner.context.request, `Race winner ${theme}`, [
    [OFFERS.palwalB, 3],
  ]);
  const lostCart = await makeCart(loser.context.request, `Race loser ${theme}`, [
    [OFFERS.palwalB, 3],
  ]);
  try {
    await enter(winner.page, wonCart);
    await capture(winner.page, `T16-race-won-${theme}`, []);
    await enter(loser.page, lostCart);
    await capture(loser.page, `T16-race-lost-${theme}`, [900, 600]);
  } finally {
    await release(winner.context.request, wonCart);
    await winner.context.close();
    await loser.context.close();
  }
}

/** The client read, caught in flight: the API answers, slowly. */
async function loading(browser, theme) {
  const { context, page } = await open(browser, theme);
  const cart = await makeCart(context.request, `Loading ${theme}`, [[OFFERS.brief, 1]]);
  await page.route('**/api/buyer/checkout', async (route) => {
    await new Promise((r) => setTimeout(r, 8000));
    await route.continue();
  });
  page.goto(`${SHOP}/checkout?cart=${cart}`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, `T16-loading-${theme}`);
  await page.setViewportSize({ width: 600, height: 1400 });
  await page.waitForTimeout(300);
  await shot(page, `T16-loading-${theme}-600`);
  await page.waitForTimeout(7000);
  await release(context.request, cart);
  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitFor(`${API}/health`, true);
  await resetCarts();

  const browser = await chromium.launch();
  try {
    const THEMES = process.argv[2] ? [process.argv[2]] : ['dark', 'light'];
    for (const theme of THEMES) {
      await entryStates(browser, theme);
      await walkTheFlow(browser, theme);
      await poRequired(browser, theme);
      await approvalRequired(browser, theme);
      await theHold(browser, theme);
      await raceLost(browser, theme);
      await loading(browser, theme);
    }

    // --- the error state: the API is not there ------------------------------
    const dead = [];
    const carts = [];
    for (const theme of THEMES) {
      const s = await open(browser, theme);
      carts.push(await makeCart(s.context.request, `Error ${theme}`, [[OFFERS.brief, 1]]));
      dead.push([theme, s]);
    }
    console.log(stopApi());
    await waitFor(`${API}/health`, false);
    try {
      for (let i = 0; i < dead.length; i += 1) {
        const [theme, { context, page }] = dead[i];
        await page.goto(`${SHOP}/checkout?cart=${carts[i]}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        await capture(page, `T16-error-${theme}`, [600]);
        await context.close();
      }
    } finally {
      startApi();
      await waitFor(`${API}/health`, true);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
