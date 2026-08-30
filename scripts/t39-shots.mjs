/**
 * T39 review captures: the ops order board, the order record and the
 * purchase-order board. Every state, both themes, 1440 / 900 / 600.
 *
 * TWO THINGS THIS RUN DOES FOR REAL RATHER THAN FAKING
 * ----------------------------------------------------
 * 1. **The permission slice is two real sign-ins, not two fixtures.** SUPPORT
 *    holds `ordering.any.read` and not `procurement.po.read_any`; PRICING_ADMIN
 *    holds the second and not the first. Each is signed in and pointed at BOTH
 *    routes, so the refusal frames are the product refusing rather than a
 *    screenshot of a mock.
 * 2. **The margin's two arms are two real orders.** TT-26-00013 has a purchase
 *    order on its one machine and the margin is stated to the paisa;
 *    TT-26-00007 has six machines and no purchase order at all, and the margin
 *    is refused with the reason. Neither is stubbed — the second is a genuine
 *    gap on this database and is the whole reason the field is nullable.
 *
 * It asserts the API is not a stale build before believing any frame:
 * `/api/ops/orders` must exist at all (it did not this morning), a `?q=` search
 * must come back with `searchedFor` and a `matchedOn` on the row, and the ops
 * dashboard's two tiles must now carry the hrefs this task gave them. A build
 * that predates any of that serves a plausible-looking screen of the old
 * behaviour, which has produced misleading captures on this machine twice.
 *
 * THE_ONLY_STUBS
 *   - *-loading / *-error: the GET is delayed, then answered 500. A local API
 *     answers in ~30 ms and cannot be made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** Holds `ordering.any.read`, and NOT `procurement.po.read_any`. */
const SUPPORT = 'support@trugrade.in';
/** Holds `procurement.po.read_any`, and NOT `ordering.any.read`. */
const PRICING = 'pricing@trugrade.in';

/** One machine, one purchase order — the margin is stateable. */
const COVERED_ORDER = 'TT-26-00013';
/** Six machines, no purchase order at all — the margin must be refused. */
const UNCOVERED_ORDER = 'TT-26-00007';

const ORDERS = '**/api/ops/orders*';
// A separate pattern for the record, and the reason is a real hour lost: a glob
// `*` does not cross a `/`, so `**/api/ops/orders*` matches the board's
// `?per=25` and does NOT match `/api/ops/orders/TT-26-00013`. The stub silently
// did nothing and the "error" frame came out as a perfectly loaded record.
const ORDER_RECORD = '**/api/ops/orders/**';
const POS = '**/api/ops/purchase-orders*';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1700 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1700 });
  await page.waitForTimeout(300);
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { page, context };
}

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

async function signIn(page, email) {
  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) return;
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
}

/** The console holds its token in memory, so a Vite rebuild signs you out mid-run. */
async function open(page, path, ready, email) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(ready, { timeout: 20000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await signIn(page, email);
    }
  }
}

/**
 * One handler with a mode flag, rather than `route` → `unroute` → `route`.
 *
 * The obvious sequencing races and it cost this run once: the delayed handler
 * sleeps six seconds, so it is still registered when `unroute` is called and it
 * then serves a real 200 for the request the error frame was meant to fail. The
 * capture came out as a perfectly loaded board named `-error`, which is exactly
 * the kind of frame that gets believed.
 */
async function delayedThen500(page, pattern, path, ready, base, email) {
  let mode = 'slow';
  await page.route(pattern, async (route) => {
    if (mode === 'slow') {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue().catch(() => {});
      return;
    }
    await route
      .fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      .catch(() => {});
  });

  await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await capture(page, `${base}-loading`);

  mode = 'fail';
  // The same sign-in retry `open` has, and for the same reason: the API restarts
  // under a watch build, the console's token lives in memory, and a signed-out
  // reload lands on /login — where "did not load" never appears and the wait
  // times out twenty seconds into a twelve-minute run.
  await open(page, path, ready, email);
  await capture(page, `${base}-error`);
  await page.unroute(pattern);
}

/* -------------------------------------------------------------------------
 * Refuse to photograph a stale build, or a database that cannot show what the
 * screens claim.
 * ---------------------------------------------------------------------- */

async function tokenFor(email) {
  const jar = [];
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(';')[0]);
  };
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  keep(login);
  const session = await login.json();
  if (!session.accessToken) throw new Error(`${email} could not sign in: ${JSON.stringify(session)}`);
  if (!session.mfaRequired) return session.accessToken;

  const headers = { Authorization: `Bearer ${session.accessToken}`, Cookie: jar.join('; ') };
  const otp = await fetch(`${API}/api/auth/mfa/otp`, { method: 'POST', headers });
  keep(otp);
  const { devCode } = await otp.json();
  const verified = await fetch(`${API}/api/auth/mfa/verify`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', Cookie: jar.join('; ') },
    body: JSON.stringify({ code: devCode }),
  });
  const done = await verified.json();
  if (!done.accessToken) throw new Error(`${email} could not clear MFA: ${JSON.stringify(done)}`);
  return done.accessToken;
}

const asJson = async (token, path) => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};

async function assertBuildAndData() {
  const support = await tokenFor(SUPPORT);
  const pricing = await tokenFor(PRICING);

  // 1. The routes this task built exist at all. They did not this morning, and a
  //    stale dist/ answers 404 while the Vite console renders its error state —
  //    which photographs as a design fault rather than a missing build.
  const board = await asJson(support, '/api/ops/orders?per=25');
  if (!Array.isArray(board.rows) || board.rows.length === 0) {
    throw new Error('the order board is empty; there is nothing to photograph');
  }

  // 2. The search box is this task's, and `searchedFor` + `matchedOn` are the
  //    two fields the screen's honesty rests on.
  const seal = await asJson(
    support,
    '/api/ops/orders?q=' + encodeURIComponent(SEAL_CODE),
  );
  if (seal.total !== 1) throw new Error(`the seal-code search found ${seal.total}, wanted 1`);
  if (!seal.searchedFor?.some((s) => s.includes('seal'))) {
    throw new Error('searchedFor is absent — this is a build that predates the search box');
  }
  if (!seal.rows[0].matchedOn?.some((m) => m.kind === 'seal')) {
    throw new Error('the row does not say it matched on a seal — stale build');
  }

  // 3. Both arms of the margin are reachable on THIS database. A run where every
  //    order happened to be covered would photograph as if the nullable field
  //    were not there.
  const covered = await asJson(support, `/api/ops/orders/${COVERED_ORDER}`);
  if (!covered.margin) throw new Error(`${COVERED_ORDER} has no margin; pick another order`);
  const uncovered = await asJson(support, `/api/ops/orders/${UNCOVERED_ORDER}`);
  if (uncovered.margin || !uncovered.marginUnavailable) {
    throw new Error(`${UNCOVERED_ORDER} now has a margin; the refusal state is unreachable`);
  }

  // 4. The permission slice is real, not a rendering choice.
  const refused = await fetch(`${API}/api/ops/purchase-orders`, {
    headers: { Authorization: `Bearer ${support}` },
  });
  if (refused.status !== 403) {
    throw new Error(`SUPPORT got ${refused.status} from the PO board, wanted 403`);
  }

  // 5. The purchase-order board, and the totals that must be the filtered set.
  const pos = await asJson(pricing, '/api/ops/purchase-orders?per=25');
  if (pos.total === 0) throw new Error('no purchase orders to photograph');
  if (!pos.totals) throw new Error('the PO board has no totals — stale build');

  // 6. T34's two dead tiles now lead somewhere. A count that leads nowhere is
  //    the pattern this build keeps finding, and this run is what proves the
  //    dashboard and the boards agree.
  const dash = await asJson(pricing, '/api/ops/dashboard');
  const poTile = dash.metrics.find((m) => m.key === 'po-unacknowledged');
  if (poTile?.href !== '/procurement/pos?status=RAISED') {
    throw new Error(`the PO tile still points at ${poTile?.href} — stale API build`);
  }
  const raised = await asJson(pricing, '/api/ops/purchase-orders?status=RAISED');
  if (raised.total !== poTile.value) {
    throw new Error(
      `the dashboard says ${poTile.value} unacknowledged and the board it links to has ${raised.total}`,
    );
  }

  console.log(
    `build and data checked: ${board.total} orders, ${pos.total} purchase orders, ` +
      `${poTile.value} unacknowledged and the tile lands on ${raised.total}`,
  );
  return { support, pricing };
}

/** A real seal code off a real ordered machine, so the search frame is real. */
const SEAL_CODE = 'TG-TGD5963139B';

/* ---------------------------------------------------------------------- */

async function run(browser, theme) {
  const { page, context } = await openPage(browser, theme);

  // ---- SUPPORT: the order board and the record -------------------------
  await signIn(page, SUPPORT);
  await assertTheme(page, theme);

  // A LINK INSIDE THE BODY, not `table`: `DataBoard` renders its header and its
  // skeleton rows while it loads, so waiting for the table photographs the
  // loading state as if it were the loaded one — that frame was captured once
  // and looked entirely plausible. A skeleton row contains no anchor.
  await open(page, '/orders', 'tbody a', SUPPORT);
  await capture(page, `T39-orders-board-${theme}`);

  await open(
    page,
    `/orders?q=${encodeURIComponent(SEAL_CODE)}`,
    'text=matched on',
    SUPPORT,
  );
  await capture(page, `T39-orders-search-seal-${theme}`);

  await open(page, '/orders?approval=pending', 'tbody a', SUPPORT);
  await capture(page, `T39-orders-approval-pending-${theme}`);

  await open(page, '/orders?q=nothing-matches-this', 'text=Nothing matches', SUPPORT);
  await capture(page, `T39-orders-empty-${theme}`);

  await open(page, `/orders/${COVERED_ORDER}`, 'text=As a share', SUPPORT);
  await capture(page, `T39-order-record-margin-${theme}`);

  await open(page, `/orders/${UNCOVERED_ORDER}`, 'text=No PO line', SUPPORT);
  await capture(page, `T39-order-record-no-po-${theme}`);

  // The refusal, as the product produces it. SUPPORT has no rail entry for the
  // purchase orders; typing the address is the only way in and it is refused.
  await open(page, '/procurement/pos', 'text=You do not have access', SUPPORT);
  await capture(page, `T39-pos-refused-to-support-${theme}`);

  await delayedThen500(
    page,
    ORDERS,
    '/orders',
    'text=did not load',
    `T39-orders-board-${theme}`,
    SUPPORT,
  );
  await delayedThen500(
    page,
    ORDER_RECORD,
    `/orders/${COVERED_ORDER}`,
    'text=did not load',
    `T39-order-record-${theme}`,
    SUPPORT,
  );

  await context.close();

  // ---- PRICING_ADMIN: the purchase-order board -------------------------
  const second = await openPage(browser, theme);
  await signIn(second.page, PRICING);
  await assertTheme(second.page, theme);

  await open(second.page, '/procurement/pos', 'tbody a', PRICING);
  await capture(second.page, `T39-pos-board-${theme}`);

  await open(second.page, '/procurement/pos?status=RAISED', 'tbody a', PRICING);
  await capture(second.page, `T39-pos-board-unaccepted-${theme}`);

  await open(second.page, '/procurement/pos?q=no-such-thing', 'text=Nothing matches', PRICING);
  await capture(second.page, `T39-pos-empty-${theme}`);

  await open(second.page, '/orders', 'text=You do not have access', PRICING);
  await capture(second.page, `T39-orders-refused-to-pricing-${theme}`);

  await delayedThen500(
    second.page,
    POS,
    '/procurement/pos',
    'text=did not load',
    `T39-pos-board-${theme}`,
    PRICING,
  );

  // The ops dashboard, with the two tiles that now lead somewhere.
  // The tile itself, not the nav label 'Today' — which is present before the
  // dashboard has loaded anything.
  await open(second.page, '/overview', 'text=Purchase orders not acknowledged', PRICING);
  await capture(second.page, `T39-overview-tiles-${theme}`);

  await second.context.close();
}

await mkdir(OUT, { recursive: true });
await assertBuildAndData();
const browser = await chromium.launch();
try {
  for (const theme of ['dark', 'light']) await run(browser, theme);
} finally {
  await browser.close();
}
console.log('done');
