/**
 * T33 review captures: what we owe a vendor, the deduction stack, and the parts
 * with no data behind them. Every state, both themes, 1440 / 900 / 600.
 *
 * **The two runs are two different vendors on purpose.** Mayapuri is not an
 * MSME and carries a payable delivered in July 2025 that is past our own payment
 * terms and still unpaid — the honest worst case, and it is real seeded data
 * rather than a fixture. Faridabad holds a Udyam registration, so the same
 * screen shows the MSMED Act s.15 clock instead of the purchase order's terms.
 * Neither vendor has a payout bank account on record, which is the one blocker
 * on the page a vendor can clear themselves.
 *
 * **It asserts the honesty invariants live**, against the running API and the
 * real database, before it believes any frame:
 *   - `eligibleAt` is null on every row (nothing writes it) and no field on the
 *     payload promises a payment date derived from a cycle;
 *   - `payoutsEver` is 0, because nothing writes `procurement.payout_run`;
 *   - the string `T_PLUS_2` — the configured cycle, and the tempting thing to
 *     turn into an "expected on" — appears nowhere in the response.
 *
 * It checks the API is not a stale build first: a 404 on the new route means the
 * running process predates it, which has produced screenshots of behaviour that
 * no longer exists twice on this machine.
 *
 * THE_ONLY_STUBS
 *   - board-loading / board-error: the payables GET is delayed, then answered
 *     500. A local API answers in ~20 ms and cannot be made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const PAYABLES = '**/api/vendor/payables*';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** A verified vendor with no purchase orders and therefore nothing payable. */
const BRAND_NEW = 'ops@ghaziabad.example';

const RUNS = {
  // Not an MSME. Four payables: two undelivered, one delivered inside the
  // window, and one delivered in July 2025 that we are past our own terms on.
  dark: { email: 'ops@mayapuri.example' },
  // MSME — `vendor_profile.msme_udyam_no` is set, so the 45-day statutory clock
  // applies instead of the purchase order's 15-day terms.
  light: { email: 'ops@faridabad.example' },
};

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
 * The whole point of the task, checked against the live response.
 *
 * A date derived from `procurement.default_payout_cycle` is one a vendor plans
 * cash against and we would have invented. The screen must carry no such field
 * and no such string, and it must report the two things nothing writes as null
 * and zero rather than as an answer.
 */
async function assertNothingInvented(page, when) {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/vendor/payables', { credentials: 'include' });
    const text = await res.text();
    const json = JSON.parse(text);
    return {
      text,
      payoutsEver: json.payoutsEver,
      rows: json.rows.length,
      eligibleSet: json.rows.filter((x) => x.eligibleAt !== null).length,
      keys: [...new Set(json.rows.flatMap((x) => Object.keys(x)))],
      msme: json.msme,
    };
  });

  if (r.payoutsEver !== 0) throw new Error(`${when}: payoutsEver is ${r.payoutsEver}, not 0`);
  if (r.eligibleSet !== 0)
    throw new Error(`${when}: ${r.eligibleSet} rows carry an eligible_at nothing writes`);
  for (const invented of ['expectedPaymentOn', 'expectedOn', 'payoutDate', 'payoutOn']) {
    if (r.keys.includes(invented)) throw new Error(`${when}: the payload carries ${invented}`);
  }
  if (r.text.includes('T_PLUS_2'))
    throw new Error(`${when}: the configured payout cycle reached the vendor's screen`);

  console.log(
    `  ${when}: ${r.rows} payables · no payout run · no eligible date recorded · ` +
      `MSME ${r.msme.registered ? r.msme.udyamNumber : 'not registered'}`,
  );
}

async function run(browser, theme) {
  const { email } = RUNS[theme];
  const { page, context } = await openPage(browser, theme);
  await signIn(page, email);

  await open(page, '/vendor/payables', 'tbody a', email);
  await assertTheme(page, theme);
  await assertNothingInvented(page, `${theme} (${email.split('@')[1]})`);
  await capture(page, `T33-payables-${theme}`);

  // Filtered to a status this vendor has none of: a different sentence from an
  // empty account, and a Clear control rather than a first-run CTA.
  await open(page, '/vendor/payables?status=PAID', 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T33-payables-filtered-empty-${theme}`);

  await context.close();
}

async function empty(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor/payables', 'h1', BRAND_NEW);
  await page.waitForTimeout(800);
  await assertTheme(page, theme);
  await capture(page, `T33-payables-empty-${theme}`);
  await context.close();
}

async function loadingAndError(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  const { email } = RUNS[theme];
  await signIn(page, email);

  // The screenshots and the context close inside the delay, so by the time the
  // timer fires the route may be gone. Continuing a dead route throws; that is
  // the run finishing, not a failure.
  await page.route(PAYABLES, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}/vendor/payables`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await capture(page, `T33-payables-loading-${theme}`);
  await page.unroute(PAYABLES);

  await page.route(PAYABLES, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}/vendor/payables`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `T33-payables-error-${theme}`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const probe = await fetch(`${API}/api/vendor/payables`);
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — it does not know the T33 route');
  }
  console.log(`api /api/vendor/payables -> ${probe.status} (not 404: the build is current)`);

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
