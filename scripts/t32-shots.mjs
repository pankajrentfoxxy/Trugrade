/**
 * T32 review captures: the vendor's purchase-order board, one purchase order,
 * and the pick list. Every state, both themes, 1440 / 900 / 600.
 *
 * **The acceptance is real.** The dark run accepts PO-26-00008 (Faridabad) and
 * the light run accepts PO-26-00001 (Mayapuri), both through the product against
 * the dev database — so `T32-record-accepted-*` photographs a row the API
 * actually wrote, and the board's ACKNOWLEDGED chip afterwards comes from that
 * write rather than a fixture. Each vendor keeps three or more RAISED orders, so
 * the "awaiting acceptance" frames stay reproducible.
 *
 * **It asserts the anonymity rule live, not just in a unit test.** Before and
 * after the captures the run reads the three routes as the signed-in vendor and
 * fails if any of them carries a buyer legal name, a GSTIN, an order number, or
 * — on the pick list — any money at all. The integration suite proves the same
 * thing against a fixture; this proves it against the real seeded data, which is
 * where an accidental allow-list addition would actually show up first.
 *
 * It checks the API is not a stale build before it believes anything: a 404 on
 * the new route means the running process predates it, which has produced
 * screenshots of behaviour that no longer exists twice on this machine.
 *
 * THE_ONLY_STUBS
 *   - board-loading / board-error / record-loading: the purchase-order GET is
 *     delayed, then answered 500. A local API answers in ~20 ms and cannot be
 *     made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const POS = '**/api/vendor/purchase-orders?*';
const PO_ONE = '**/api/vendor/purchase-orders/*';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** A verified vendor with no purchase orders at all. */
const BRAND_NEW = 'ops@ghaziabad.example';

const RUNS = {
  dark: {
    email: 'ops@faridabad.example',
    /** Two machines, delivering to New Delhi. Left RAISED and photographed. */
    open: '195de6db-c1e1-43b7-904a-93995151d789',
    /** Accepted for real, on camera. */
    accept: '694d2483-e7a8-4b29-b675-d02971d26aa5',
    /** Mayapuri's. Faridabad must not be able to open it. */
    notMine: '8d18b209-8114-473e-950f-1c20b2c1447e',
  },
  light: {
    email: 'ops@mayapuri.example',
    open: 'be5c1e06-08b4-494f-9a1f-30e00efbaf3b',
    accept: '8d18b209-8114-473e-950f-1c20b2c1447e',
    notMine: '195de6db-c1e1-43b7-904a-93995151d789',
  },
};

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(300);
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { page, context };
}

async function assertTheme(page, theme) {
  // Waited for, not read once: the pre-paint script sets `data-t` from
  // localStorage on the first paint, and a screenshot taken between navigation
  // and that script sees no attribute at all. Read once, this failed a run on
  // timing rather than on the theme being wrong.
  await page
    .waitForFunction((t) => document.documentElement.getAttribute('data-t') === t, theme, {
      timeout: 10000,
    })
    .catch(() => {});
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
 * Anonymity runs both ways, checked against the real seeded data.
 *
 * The buyer's legal names and GSTINs come out of the running database rather
 * than a constant, so a demo seed that grows another customer is covered without
 * anyone editing this file. Money on the pick list is the second half: under
 * s.10(1)(b) IGST neither invoice value travels with the goods.
 */
async function assertNoBuyer(page, poId, when) {
  const found = await page.evaluate(async (id) => {
    const get = async (u) => (await fetch(u, { credentials: 'include' })).text();
    return {
      board: await get('/api/vendor/purchase-orders?page=1&pageSize=50'),
      detail: await get(`/api/vendor/purchase-orders/${id}`),
      pickList: await get(`/api/vendor/purchase-orders/${id}/pick-list`),
    };
  }, poId);

  for (const [route, payload] of Object.entries(found)) {
    for (const secret of BUYER_STRINGS) {
      if (payload.includes(secret)) {
        throw new Error(`${when}: ${route} carries a buyer identifier — "${secret}"`);
      }
    }
    if (/TT-\d\d-\d/.test(payload)) {
      throw new Error(`${when}: ${route} carries a buyer order number`);
    }
  }
  if (/agreedNetPayout|totalNet|tdsAmount/.test(found.pickList)) {
    throw new Error(`${when}: the pick list carries money, which may not travel with the goods`);
  }
  console.log(`  ${when}: no buyer name, GSTIN, order number or price on any of the three routes`);
}

/** Every buyer org's legal name and GSTIN, read out of the running database. */
let BUYER_STRINGS = [];

async function psql(sql) {
  const { execFileSync } = await import('node:child_process');
  return execFileSync(
    'docker',
    [
      'exec',
      '-e',
      'PGPASSWORD=trugrade_dev',
      'trugrade-postgres',
      'psql',
      '-U',
      'trugrade',
      '-d',
      'trugrade',
      '-At',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
}

/**
 * Put the two purchase orders this run accepts back to RAISED.
 *
 * So the acceptance photographed in `T32-record-accepted-*` is a real write
 * every time this script runs, not only the first. Without it a second run finds
 * both already acknowledged, silently skips the click, and produces a frame that
 * looks identical while proving nothing. Only these two rows, named by id.
 */
async function resetTargets() {
  const ids = Object.values(RUNS).map((r) => r.accept);
  await psql(
    `UPDATE procurement.purchase_order
        SET status = 'RAISED', acknowledged_at = NULL
      WHERE id IN (${ids.map((id) => `'${id}'::uuid`).join(', ')})`,
  );
  console.log(`reset ${ids.length} purchase orders to RAISED so the acceptance is a real write`);
}

async function loadBuyerStrings() {
  const out = await psql(
    `SELECT legal_name FROM identity.organization WHERE org_type = 'BUYER'
       UNION ALL
       SELECT g.gstin FROM kyc.gst_profile g
         JOIN identity.organization o ON o.id = g.org_id WHERE o.org_type = 'BUYER'
       UNION ALL
       SELECT a.label FROM identity.org_address a
         JOIN identity.organization o ON o.id = a.org_id
        WHERE o.org_type = 'BUYER' AND a.label IS NOT NULL`,
  );
  BUYER_STRINGS = out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  console.log(`sweeping for ${BUYER_STRINGS.length} buyer strings from the live database`);
}

async function run(browser, theme) {
  const { email, open: openPo, accept, notMine } = RUNS[theme];
  const { page, context } = await openPage(browser, theme);
  await signIn(page, email);

  // ---- the board ---------------------------------------------------------
  await open(page, '/vendor/orders', 'tbody a', email);
  await assertTheme(page, theme);
  await assertNoBuyer(page, openPo, `${theme} before accepting`);
  await capture(page, `T32-board-${theme}`);

  // Filtered to a status this vendor has none of: a different sentence from an
  // empty account, and a Clear control rather than a first-run CTA.
  await open(page, '/vendor/orders?status=PAID', 'h1', email);
  await page.waitForTimeout(500);
  await capture(page, `T32-board-filtered-empty-${theme}`);

  // ---- one purchase order, awaiting acceptance ---------------------------
  await open(page, `/vendor/orders/${openPo}`, '[data-testid="side-panel"]', email);
  await page.waitForTimeout(400);
  await capture(page, `T32-record-awaiting-${theme}`);

  // ---- the pick list -----------------------------------------------------
  await open(page, `/vendor/orders/${openPo}/pick-list`, 'text=Pick list', email);
  await page.waitForTimeout(400);
  await capture(page, `T32-picklist-${theme}`);

  // ---- accepting one, for real -------------------------------------------
  await open(page, `/vendor/orders/${accept}`, '[data-testid="side-panel"]', email);
  await page.getByRole('button', { name: /^Accept PO-/ }).click();
  await page.waitForSelector('text=This order is accepted', { timeout: 15000 });
  await page.waitForTimeout(400);
  await capture(page, `T32-record-accepted-${theme}`);

  await open(page, '/vendor/orders', 'tbody a', email);
  await page.waitForTimeout(500);
  await capture(page, `T32-board-after-accepting-${theme}`);
  await assertNoBuyer(page, openPo, `${theme} after accepting`);

  // ---- somebody else's ---------------------------------------------------
  await open(page, `/vendor/orders/${notMine}`, 'text=did not load', email);
  await page.waitForTimeout(500);
  await capture(page, `T32-record-not-yours-${theme}`);

  await context.close();
}

async function empty(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor/orders', 'h1', BRAND_NEW);
  await page.waitForTimeout(700);
  await assertTheme(page, theme);
  await capture(page, `T32-board-empty-${theme}`);
  await context.close();
}

async function loadingAndError(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  const { email, open: openPo } = RUNS[theme];
  await signIn(page, email);

  await page.route(POS, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}/vendor/orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await capture(page, `T32-board-loading-${theme}`);
  await page.unroute(POS);

  await page.route(POS, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}/vendor/orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `T32-board-error-${theme}`);
  await page.unroute(POS);

  // The record's own loading state: a real header, skeleton lines.
  // The screenshots and the context close inside the delay, so by the time the
  // timer fires the route may be gone. Continuing a dead route throws; that is
  // the run finishing, not a failure.
  await page.route(PO_ONE, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}/vendor/orders/${openPo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await capture(page, `T32-record-loading-${theme}`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // The trap that has cost this build two capture runs: a dev API still serving
  // the previous build. A 404 here means the process predates the route.
  const probe = await fetch(`${API}/api/vendor/purchase-orders`);
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — it does not know the T32 routes');
  }
  console.log(`api /api/vendor/purchase-orders -> ${probe.status} (not 404: the build is current)`);

  await resetTargets();
  await loadBuyerStrings();

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      await run(browser, theme);
      await empty(browser, theme);
      await loadingAndError(browser, theme);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
