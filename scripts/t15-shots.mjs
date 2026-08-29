/**
 * T15 review captures: `/cart`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed. Every screen below is the real route, signed in as the
 * seeded buyer (`buyer@acme.example`), reading the real cart out of the real
 * database through the real API — including the availability re-check, which is
 * counted through `v_sellable_unit` at the moment each page opens.
 *
 * Three states need the environment moved rather than a URL:
 *
 * **A line that is gone entirely** needs an offer that is no longer purchasable.
 * One listing's status is moved to PAUSED, captured, and moved back. That is the
 * real column the real service reads (`PURCHASABLE_STATUSES`), and it is what
 * happens to a buyer's line when a supply point pauses an offer overnight.
 *
 * **A line that is short** needs no change at all: Supply Point B · Palwal holds
 * three of this model, and asking for five is exactly the state a buyer lands in
 * when two of their five sell while they were deciding.
 *
 * **Error** is reached by stopping the API, and the API is started again after.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** Dell Latitude 5420 at Grade A, carried by ten supply points. */
const OFFERS = {
  delhiW: 'b6e12109-34d1-49be-a047-e5062289b0aa',
  delhiP: '44eca3b5-7593-41dd-b088-b914b48163ce',
  gurugramL: '51336995-4625-4ea9-b81a-071a711ed0e1',
  sonipatV: 'b5f652b1-9ee4-460c-8049-7e43a01214ea',
  noidaF: '445e1874-ca5e-4d60-9d21-ad4357b230de',
  /** Three units only — asking for five is the reduced-availability state. */
  palwalB: '2204dba4-1631-43b9-822f-7282b9d5b38b',
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
  await page.waitForTimeout(500);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(500);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(250);
}

async function open(browser, theme, { signedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
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
  // Signing in through the same origin the page uses, so the session cookies
  // the browser then sends are the ones the real sign-in sets — httpOnly, and
  // never touched by this script.
  if (signedIn) {
    const res = await context.request.post(`${SHOP}/api/auth/login`, { data: BUYER });
    if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { context, page };
}

const go = async (page, path) => {
  await page.goto(`${SHOP}${path}`, { waitUntil: 'networkidle' });
  // The cart reads itself after hydration; wait for the read, not the document.
  await page.waitForTimeout(900);
};

/* ---------------------------------------------------------------- cart state */

/**
 * The carts this run photographs, rebuilt from nothing each time.
 *
 * Deleting first is what makes the shots reproducible: a run that appended to
 * whatever was already there would photograph a different cart every time and
 * prove nothing about the screen.
 */
function resetCarts() {
  sql(
    `DELETE FROM ordering.cart_item WHERE cart_id IN (
       SELECT c.id FROM ordering.cart c
         JOIN identity.user_account u ON u.id = c.user_id
        WHERE u.email = '${BUYER.email}');
     DELETE FROM ordering.cart WHERE user_id IN (
       SELECT id FROM identity.user_account WHERE email = '${BUYER.email}');`,
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

/* ------------------------------------------------------------------ the run */

async function signedOut(browser, theme) {
  const { context, page } = await open(browser, theme, { signedIn: false });
  await go(page, '/cart');
  await capture(page, `T15-signed-out-${theme}`, [600]);
  await context.close();
}

async function states(browser, theme) {
  const { context, page } = await open(browser, theme);

  // 1 — no carts at all. The first-visit state.
  await resetCarts();
  await go(page, '/cart');
  await capture(page, `T15-no-carts-${theme}`, [600]);

  // 2 — a named cart with nothing in it.
  const empty = await makeCart(context.request, 'Q3 refresh', []);
  await go(page, `/cart?cart=${empty}`);
  await capture(page, `T15-empty-cart-${theme}`, [600]);

  // 3 — one line, from one dispatch point.
  const one = await makeCart(context.request, 'Delhi office', [[OFFERS.delhiW, 3]]);
  await go(page, `/cart?cart=${one}`);
  await capture(page, `T15-one-line-${theme}`, [900, 600]);

  // 4 — TWO NAMED CARTS. The switcher, with a line count on each.
  await capture(page, `T15-two-carts-${theme}`, []);
  await page.locator('.cartsw .chipf', { hasText: 'Q3 refresh' }).click();
  await page.waitForTimeout(700);
  await capture(page, `T15-cart-switched-${theme}`, []);

  // 5 — THE SCREEN. Five supply points in one cart: New Delhi twice, Gurugram,
  // Sonipat and Noida. One order, one invoice, five places the machines leave
  // from — and nowhere on it does the word "sub-order" appear.
  const many = await makeCart(context.request, 'National rollout', [
    [OFFERS.delhiW, 4],
    [OFFERS.delhiP, 2],
    [OFFERS.gurugramL, 6],
    [OFFERS.sonipatV, 3],
    [OFFERS.noidaF, 5],
  ]);
  await go(page, `/cart?cart=${many}`);
  await capture(page, `T15-multi-supply-point-${theme}`, [900, 600]);

  // 6 — a line whose availability has dropped. Palwal holds three; the cart
  // asks for five, and the line says so with both numbers.
  const short = await makeCart(context.request, 'Short line', [
    [OFFERS.delhiW, 2],
    [OFFERS.palwalB, 5],
  ]);
  await go(page, `/cart?cart=${short}`);
  await capture(page, `T15-reduced-availability-${theme}`, [900, 600]);
  await page
    .locator('.cartlines table tbody tr', { hasText: 'still available' })
    .first()
    .screenshot({ path: `${OUT}/T15-reduced-row-${theme}.png` });
  console.log('captured', `T15-reduced-row-${theme}`);

  // 7 — the hand-off from the comparison board: `/cart?listing=&qty=`, the URL
  // `OfferGrid.onAdd` builds. This is the add path end to end.
  await go(page, `/cart?listing=${OFFERS.noidaF}&qty=2`);
  await capture(page, `T15-added-from-board-${theme}`, []);

  // 8 — naming a new cart, and the refusal when the name is already taken.
  await page.getByRole('button', { name: 'New cart' }).click();
  await page.locator('#cartname').fill('Q3 refresh');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(700);
  await capture(page, `T15-duplicate-cart-name-${theme}`, []);

  await context.close();
}

/**
 * A line whose offer has gone.
 *
 * The listing is paused — the same thing that happens when a supply point takes
 * an offer down — so `CartService` reports zero sellable for it however many
 * machines are still sitting in the warehouse. Checkout closes, and the panel
 * says what has to change before it opens.
 */
async function unavailable(browser, theme) {
  const { context, page } = await open(browser, theme);
  const cart = await makeCart(context.request, 'Paused offer', [
    [OFFERS.delhiW, 2],
    [OFFERS.gurugramL, 4],
  ]);
  sql(`UPDATE listing.listing SET status = 'PAUSED' WHERE id = '${OFFERS.gurugramL}'`);
  try {
    await go(page, `/cart?cart=${cart}`);
    await capture(page, `T15-line-unavailable-${theme}`, [900, 600]);
  } finally {
    sql(`UPDATE listing.listing SET status = 'ACTIVE' WHERE id = '${OFFERS.gurugramL}'`);
  }
  await context.close();
}

/** The client read, caught in flight: the API answers, slowly. */
async function loading(browser, theme) {
  const { context, page } = await open(browser, theme);
  await page.route('**/api/buyer/carts', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  page.goto(`${SHOP}/cart`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(1800);
  await shot(page, `T15-loading-${theme}`);
  await page.setViewportSize({ width: 600, height: 1400 });
  await page.waitForTimeout(300);
  await shot(page, `T15-loading-${theme}-600`);
  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitFor(`${API}/health`, true);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      await signedOut(browser, theme);
      await states(browser, theme);
      await unavailable(browser, theme);
      await loading(browser, theme);
    }

    // --- the error state: the API is not there ------------------------------
    // Signed in first, because a signed-in buyer meeting a dead API is the
    // state worth photographing; a signed-out one would show the sign-in path.
    const sessions = [];
    for (const theme of ['dark', 'light']) sessions.push([theme, await open(browser, theme)]);
    console.log(stopApi());
    await waitFor(`${API}/health`, false);
    try {
      for (const [theme, { context, page }] of sessions) {
        await go(page, '/cart');
        await capture(page, `T15-error-${theme}`, [600]);
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
