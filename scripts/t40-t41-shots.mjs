/**
 * T40 and T41 review captures. Every state, both themes, 1440 / 900 / 600.
 *
 * WHAT IS REAL HERE
 * -----------------
 * All of it, apart from four deliberately stubbed states listed below. The
 * finance console is reading one genuine invoice, seventeen genuine payables and
 * six genuine supply points; the configuration board is reading 74 genuine keys;
 * the audit log is reading 1,500-odd genuine rows written by real sign-ins,
 * onboarding steps and one invoice issue.
 *
 * The run asserts five honesty invariants against the live responses before it
 * believes any frame, because a stale API on :4000 has produced convincing
 * screenshots of behaviour that no longer existed more than once on this
 * machine:
 *
 *   - the API knows all three T40/T41 routes (a 404 means a stale build);
 *   - the one invoice equals its order's grand total to the paisa, which is the
 *     whole claim the register makes;
 *   - the three-way-match gate reports UNMEASURABLE and not UNMET, and at least
 *     one gate reports MET, so the distinction the screen is built on is live;
 *   - the config response contains keys with a reader AND keys with none, so the
 *     reachability column is not answering one way;
 *   - the audit log's `total` exceeds `matching` under a filter, which is the
 *     "a filter never drops rows silently" guarantee.
 *
 * THE_ONLY_STUBS
 *   - *-loading:  the GET is delayed and the frame taken mid-flight.
 *   - *-error:    the GET is answered 500.
 *   - config-empty / audit-empty: the response is replaced with an empty one.
 *     Deleting the real rows is not an option — `platform_config` is what lets
 *     the platform price anything, `audit_log` is append-only by trigger and
 *     cannot be emptied at all, and two other sessions share this database.
 *   - audit-out-of-range: NOT a stub. The date filter is set to 2020, which is
 *     genuinely outside every partition, and the warning is the real response.
 *
 * ACCOUNTS
 *   admin@trugrade.in     PLATFORM_SUPERADMIN — the only role holding
 *                         `platform.config.write`. MFA-required, so the run
 *                         walks a real OTP.
 *   finance@trugrade.in   FINANCE — `payment.ledger.read`. Also MFA-required.
 *   catalog@trugrade.in   CATALOG_ADMIN — holds none of the three permissions,
 *                         and is how the refusal state is photographed rather
 *                         than faked.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const SUPER = 'admin@trugrade.in';
const FINANCE = 'finance@trugrade.in';
const REFUSED = 'catalog@trugrade.in';

const CONFIG_ROUTE = '**/api/admin/platform/config*';
const AUDIT_ROUTE = '**/api/admin/audit-log*';
const FINANCE_ROUTE = '**/api/admin/finance*';

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

/**
 * `page.goto`, retried.
 *
 * Vite rebuilds the console bundle while this runs and a navigation that lands
 * mid-rebuild simply never fires `domcontentloaded`. One retry turns a lost
 * 40-minute run into a four-second pause.
 */
async function goto(page, path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(2000);
    }
  }
}

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

/** Signs in, walking a real second factor when the role needs one. */
async function signIn(page, email) {
  let devCode = null;
  const listener = async (response) => {
    if (!response.url().endsWith('/api/auth/mfa/otp')) return;
    const body = await response.json().catch(() => null);
    if (body?.devCode) devCode = body.devCode;
  };
  page.on('response', listener);

  await goto(page, '/login');
  await page.waitForTimeout(400);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (form) {
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const otp = await page
      .waitForSelector('[data-testid="otp-input"]', { timeout: 12000 })
      .catch(() => null);
    if (otp) {
      for (let i = 0; i < 60 && devCode === null; i += 1) await page.waitForTimeout(200);
      if (devCode === null) throw new Error(`no dev OTP came back for ${email}`);
      await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
      await page.waitForTimeout(400);
      const verify = page.getByRole('button', { name: /verify|continue|confirm/i }).first();
      if (await verify.isVisible().catch(() => false)) await verify.click();
    }
    await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
  }
  page.off('response', listener);
}

/** The console holds its token in memory, so a Vite rebuild signs you out mid-run. */
async function open(page, path, ready, email) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await goto(page, path);
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
 * The claims the screens make, checked against the responses that produced them.
 *
 * Runs inside the page so the session cookie and bearer are the browser's own.
 */
async function assertHonest(page) {
  const r = await page.evaluate(async () => {
    const get = async (u) => {
      const res = await fetch(u, { credentials: 'include' });
      return { status: res.status, body: res.ok ? await res.json() : null };
    };
    const config = await get('/api/admin/platform/config');
    const audit = await get('/api/admin/audit-log?limit=5');
    const filtered = await get('/api/admin/audit-log?action=identity.login.succeeded&limit=5');
    return { config, audit, filtered };
  });

  if (r.config.status !== 200) throw new Error(`the config route answered ${r.config.status}`);
  if (r.audit.status !== 200) throw new Error(`the audit route answered ${r.audit.status}`);

  const keys = r.config.body.keys;
  const withReader = keys.filter((k) => k.consumers && k.consumers.length > 0).length;
  const withoutReader = keys.filter((k) => k.consumers && k.consumers.length === 0).length;
  if (withReader === 0 || withoutReader === 0) {
    throw new Error(
      `reachability is answering one way: ${withReader} read, ${withoutReader} unread`,
    );
  }
  if (r.filtered.body.counts.excludedByFilter <= 0) {
    throw new Error('the audit filter excluded nothing — the count is not being reported');
  }
  if (r.filtered.body.counts.total !== r.audit.body.counts.total) {
    throw new Error('the audit log reports a different total under a filter');
  }

  console.log(
    `  config: ${keys.length} keys, ${withReader} read, ${withoutReader} unread, ` +
      `${r.config.body.summary.migrationOnly} migration-only, ` +
      `${r.config.body.summary.seedOnly} seed-only, ` +
      `${r.config.body.summary.orphaned} orphaned`,
  );
  console.log(
    `  audit: ${r.audit.body.counts.total} rows, ` +
      `${r.audit.body.coverage.partitions} partitions, ` +
      `default partition: ${r.audit.body.coverage.hasDefaultPartition}`,
  );
}

async function assertFinanceHonest(page) {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/admin/finance', { credentials: 'include' });
    return { status: res.status, body: res.ok ? await res.json() : null };
  });
  if (r.status !== 200) throw new Error(`the finance route answered ${r.status}`);

  const b = r.body;
  const invoice = b.invoices.rows[0];
  if (!invoice) throw new Error('no invoice — the register has nothing to photograph');
  if (invoice.agreesWithOrder !== true) {
    throw new Error(
      `the invoice and its order disagree: ${invoice.total} vs ${invoice.orderGrandTotal}`,
    );
  }
  if (b.invoices.gap !== 0) throw new Error(`the invoice series has a gap of ${b.invoices.gap}`);

  const match = b.gates.find((g) => g.key === 'three-way-match');
  if (match.verdict !== 'UNMEASURABLE') {
    throw new Error(`the three-way-match gate now reports ${match.verdict} — the copy is stale`);
  }
  if (!b.gates.some((g) => g.verdict === 'MET')) {
    throw new Error('no gate reports MET — the verdict field is answering one way');
  }
  if (b.ledger.entries !== 0) {
    throw new Error('the ledger now has entries — this screen claims it has none');
  }

  console.log(
    `  finance: ${b.invoices.issued} invoice = order to the paisa · ` +
      `${b.payables.totals.payables} payables worth ${b.payables.totals.net} · ` +
      `${b.gates.filter((g) => g.verdict !== 'MET').length}/${b.gates.length} payout gates unmet · ` +
      `${b.tds.accruals} TDS accruals totalling ${b.tds.tdsAccrued} · ` +
      `${b.commission.rules} commission rules, ${b.commission.withCommission} charged`,
  );
}

/** Delay, then 500, then back — the two states every board owes a reviewer. */
async function loadingAndError(page, route, path, errorText, prefix) {
  await page.route(route, async (r) => {
    await new Promise((res) => setTimeout(res, 6000));
    await r.continue().catch(() => {});
  });
  await goto(page, path);
  await page.waitForTimeout(1200);
  await capture(page, `${prefix}-loading`);
  await page.unroute(route);

  await page.route(route, (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  // Re-navigated rather than waited on once: unrouting the delay above can
  // leave its in-flight request hanging, and the first load after it sometimes
  // shows the skeleton for ever rather than the refusal.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto(page, path);
    const shown = await page
      .waitForSelector(`text=${errorText}`, { timeout: 12000 })
      .catch(() => null);
    if (shown) break;
    if (attempt === 2) throw new Error(`${prefix}: the error state never appeared`);
  }
  await capture(page, `${prefix}-error`);
  await page.unroute(route);
}

const EMPTY_CONFIG = {
  asAt: new Date().toISOString(),
  keys: [],
  summary: {
    keysInForce: 0,
    rows: 0,
    withReader: 0,
    withoutReader: 0,
    unscanned: 0,
    keysWithHistory: 0,
    scheduledRows: 0,
    inBothWriters: 0,
    migrationOnly: 0,
    seedOnly: 0,
    orphaned: 0,
  },
  flags: { rows: [], readerCount: 0 },
  templates: { rows: [], readerCount: 0, messagesSent: 0 },
};

async function runPlatform(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, SUPER);

  await open(page, '/platform/config', 'tbody', SUPER);
  await assertTheme(page, theme);
  await assertHonest(page);
  await capture(page, `T41-config-${theme}`);

  // Filtered to the keys nothing reads — the state the board exists for, and
  // the one that proves the filter reports what it hid.
  await open(page, '/platform/config?reach=unread', 'text=Nothing reads this', SUPER);
  await capture(page, `T41-config-unread-${theme}`);

  await open(page, '/platform/config?legal=1', 'tbody', SUPER);
  await capture(page, `T41-config-legal-${theme}`);

  await page.route(CONFIG_ROUTE, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_CONFIG),
    }),
  );
  await goto(page, '/platform/config');
  await page.waitForSelector('text=No key matches these filters', { timeout: 15000 });
  await capture(page, `T41-config-empty-${theme}`);
  await page.unroute(CONFIG_ROUTE);

  await loadingAndError(
    page,
    CONFIG_ROUTE,
    '/platform/config',
    'did not load',
    `T41-config-${theme}`,
  );

  // Flags and templates: genuinely empty, no stub needed.
  await open(page, '/platform/flags', 'text=No flag has ever been declared', SUPER);
  await capture(page, `T41-flags-${theme}`);

  await open(page, '/platform/audit-log', 'tbody', SUPER);
  await capture(page, `T41-audit-${theme}`);

  await open(page, '/platform/audit-log?action=kyc.review.rejected', 'tbody', SUPER);
  await capture(page, `T41-audit-filtered-${theme}`);

  // Real, not stubbed: 2020 is outside every partition this table has.
  await open(
    page,
    '/platform/audit-log?from=2020-01-01&to=2020-12-31',
    'text=outside every partition',
    SUPER,
  );
  await capture(page, `T41-audit-out-of-range-${theme}`);

  await loadingAndError(
    page,
    AUDIT_ROUTE,
    '/platform/audit-log',
    'did not load',
    `T41-audit-${theme}`,
  );

  await context.close();
}

async function runFinance(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, FINANCE);

  await open(page, '/finance', 'text=What stops a payout', FINANCE);
  await assertTheme(page, theme);
  await assertFinanceHonest(page);
  await capture(page, `T40-finance-${theme}`);

  await loadingAndError(page, FINANCE_ROUTE, '/finance', 'did not load', `T40-finance-${theme}`);

  await context.close();
}

/** A signed-in platform account holding none of the three permissions. */
async function refused(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, REFUSED);
  for (const [path, name] of [
    ['/finance', 'T40-finance-refused'],
    ['/platform/config', 'T41-config-refused'],
  ]) {
    await goto(page, path);
    await page.waitForTimeout(1500);
    await assertTheme(page, theme);
    await capture(page, `${name}-${theme}`);
  }
  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // A stale API on :4000 is the single most expensive failure in this repo's
  // capture history: it answers with the previous build and every frame is of
  // behaviour that no longer exists. 401 is the expected unauthenticated answer;
  // 404 means the route is not in the running build at all.
  for (const path of ['/api/admin/finance', '/api/admin/platform/config', '/api/admin/audit-log']) {
    const probe = await fetch(`${API}${path}`);
    if (probe.status === 404) {
      throw new Error(`the API on :4000 is a stale build — it does not know ${path}`);
    }
    console.log(`api ${path} -> ${probe.status} (401 expected unauthenticated; not 404)`);
  }

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      await runFinance(browser, theme);
      await runPlatform(browser, theme);
      await refused(browser, theme);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
