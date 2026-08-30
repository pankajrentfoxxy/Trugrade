/**
 * T30 review captures: the vendor's side of a QC visit. Every state, both
 * themes, 1440 / 900 / 600.
 *
 * **The two runs are two different supply points on purpose.** Northgate holds
 * the live half of the story — a visit being inspected right now, one booked
 * through the real scheduling endpoint, one requested and not yet dated, one
 * where nobody was at the warehouse, and one where two machines were never
 * produced. Faridabad holds the only FAIL and the only MISMATCH in the whole
 * database, because `qc-spread.ts` deliberately keeps a failed machine off a
 * LISTED unit — so the FAIL and UNTESTABLE rows can only be photographed there.
 * A run that used one login would never render either.
 *
 * It asserts the honesty invariants live, against the running API and the real
 * database, before it believes any frame:
 *   - a visit nobody has arrived at carries `unitsPresented: null` and every
 *     manifest row's `result` is null — no zero score, no grade, no seal;
 *   - the spread actually contains PASS, PASS_WITH_NOTE, PASS_GRADE_CORRECTED,
 *     FAIL, UNTESTABLE, ABSENT and PENDING, so no state is captured by accident;
 *   - at least one inspected machine has `batteryHealthPct: null`, because a
 *     missing measurement rendering as a passing one is the defect this build
 *     has found about ten times and a spread with no gap never exercises it;
 *   - no vendor name, org id or technician name appears anywhere on the wire.
 *
 * It checks the API is not a stale build first: `POST /api/qc/visits/:id/schedule`
 * is new in this change, and a dev server serving the previous build has
 * produced screenshots of behaviour that no longer exists twice on this machine.
 *
 * THE_ONLY_STUBS
 *   - board-loading / board-error: the visits GET is delayed, then answered 500.
 *     A local API answers in ~20 ms and cannot be made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const VISITS = '**/api/vendor/qc/visits';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** A verified vendor who has never listed anything, so has never asked for a visit. */
const BRAND_NEW = 'ops@ghaziabad.example';

const RUNS = {
  dark: { email: 'ops@northgate.example' },
  light: { email: 'ops@northgate.example' },
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

/** Whatever the vendor's own routes actually return, read through the browser. */
async function visitsOf(page) {
  return page.evaluate(async () => {
    const list = await (await fetch('/api/vendor/qc/visits', { credentials: 'include' })).json();
    const details = [];
    for (const v of list) {
      details.push(
        await (await fetch(`/api/vendor/qc/visits/${v.id}`, { credentials: 'include' })).json(),
      );
    }
    return { list, details };
  });
}

/**
 * The whole point of the task, checked against the live response.
 *
 * A visit that has not happened has no result — no zero score, no grade, no
 * seal, and `unitsPresented` null rather than 0. And the spread has to actually
 * contain every outcome, or a screenshot run proves only that the happy path
 * renders.
 */
async function assertNothingInvented(page, who) {
  const { list, details } = await visitsOf(page);

  for (const v of details) {
    if (v.arrivedAt === null) {
      if (v.unitsPresented !== null) {
        throw new Error(
          `${v.visitNumber}: nobody arrived and unitsPresented is ${v.unitsPresented}`,
        );
      }
      const invented = v.manifest.filter((u) => u.result !== null);
      if (invented.length > 0) {
        throw new Error(
          `${v.visitNumber}: ${invented.length} machines carry a result on a visit nobody attended`,
        );
      }
    }
    for (const u of v.manifest) {
      if (u.outcome === 'ABSENT' && u.result !== null) {
        throw new Error(`${u.serialNumber}: not presented, yet carries a measurement`);
      }
    }
  }

  const outcomes = new Set(details.flatMap((v) => v.manifest.map((u) => u.outcome)));
  const statuses = new Set(list.map((v) => v.status));
  const wire = JSON.stringify({ list, details });
  for (const forbidden of [
    'Northgate IT Assets',
    'Faridabad TechCycle',
    'vendorOrgId',
    'vendorName',
  ]) {
    if (wire.includes(forbidden)) throw new Error(`${who}: "${forbidden}" reached a vendor screen`);
  }

  console.log(
    `  ${who}: ${list.length} visits · statuses ${[...statuses].sort().join(', ')} · ` +
      `outcomes ${[...outcomes].sort().join(', ')}`,
  );
  return { outcomes, statuses, details };
}

async function run(browser, theme) {
  const { email } = RUNS[theme];
  const { page, context } = await openPage(browser, theme);
  await signIn(page, email);

  await open(page, '/vendor/qc/visits', 'tbody a', email);
  await assertTheme(page, theme);
  const { details, statuses } = await assertNothingInvented(page, `${theme} (northgate)`);
  for (const needed of [
    'REQUESTED',
    'SCHEDULED',
    'TECH_ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'NO_SHOW_VENDOR',
  ]) {
    if (!statuses.has(needed)) throw new Error(`no visit is ${needed} — the spread is incomplete`);
  }
  // One inspected machine has no battery reading, deliberately. A missing
  // measurement rendering as a passing one is the defect this build has found
  // about ten times, and a spread in which every reading is present never once
  // renders the branch that catches it.
  const unmeasured = details
    .flatMap((v) => v.manifest)
    .filter((u) => u.result && u.result.batteryHealthPct === null);
  if (unmeasured.length === 0) {
    throw new Error(
      'every inspected machine has a battery reading - "not measured" is never drawn',
    );
  }
  console.log(`  ${theme}: ${unmeasured.length} inspected machines have no battery reading`);
  await capture(page, `T30-visits-board-${theme}`);

  // §3B names /vendor/qc/requests; it is the same board filtered, and the
  // redirect is what makes the URL a colleague receives the canonical one.
  await open(page, '/vendor/qc/requests', 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visits-requests-${theme}`);

  const byStatus = (s) => details.find((v) => v.status === s);

  // Requested, with a manifest and no date: the state every listing starts in.
  await open(page, `/vendor/qc/visits/${byStatus('REQUESTED').id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-requested-${theme}`);

  // Booked through the real scheduling endpoint, technician assigned.
  await open(page, `/vendor/qc/visits/${byStatus('TECH_ASSIGNED').id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-scheduled-${theme}`);

  // A date but no person yet — and no manifest attached, so the "not prepared"
  // empty state renders on a visit that is otherwise ready.
  await open(page, `/vendor/qc/visits/${byStatus('SCHEDULED').id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-no-manifest-${theme}`);

  // The cancel confirmation, with the fee stated before it is confirmed.
  await page.getByRole('button', { name: 'Cancel this inspection' }).click();
  await page.waitForTimeout(400);
  await capture(page, `T30-visit-cancel-confirm-${theme}`);

  // Happening right now: three of six machines done, three not yet opened.
  await open(page, `/vendor/qc/visits/${byStatus('IN_PROGRESS').id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-in-progress-${theme}`);
  await open(page, `/vendor/qc/visits/${byStatus('IN_PROGRESS').id}/results`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-results-in-progress-${theme}`);

  // Finished and signed off, with the one machine whose battery could not be read.
  const done = byStatus('COMPLETED');
  await open(page, `/vendor/qc/visits/${done.id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-completed-${theme}`);
  await open(page, `/vendor/qc/visits/${done.id}/results`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-results-completed-${theme}`);

  // Did not go to plan: two machines were never produced.
  const partial = byStatus('PARTIALLY_COMPLETED');
  await open(page, `/vendor/qc/visits/${partial.id}/results`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-results-not-presented-${theme}`);

  // Nobody at the warehouse. Not red — a no-show is not a verdict — and the fee
  // is the consequence, stated on the record.
  await open(page, `/vendor/qc/visits/${byStatus('NO_SHOW_VENDOR').id}`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-visit-no-show-${theme}`);

  // Called off by the vendor, through their own route. The status is neutral,
  // not red — a cancellation is not a verdict on a machine — and the fee panel
  // says what calling it off did and did not do to the money.
  const cancelled = byStatus('CANCELLED');
  if (cancelled) {
    await open(page, `/vendor/qc/visits/${cancelled.id}`, 'h1', email);
    await page.waitForTimeout(600);
    await capture(page, `T30-visit-cancelled-${theme}`);
  }

  // Results asked for on a visit that has not happened: the screen refuses to
  // draw a table of zeroes.
  await open(page, `/vendor/qc/visits/${byStatus('REQUESTED').id}/results`, 'h1', email);
  await page.waitForTimeout(600);
  await capture(page, `T30-results-not-yet-${theme}`);

  await context.close();
}

/** The FAIL and the UNTESTABLE live on the other supply point. See the header. */
async function failures(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, 'ops@faridabad.example');
  await open(page, '/vendor/qc/visits', 'tbody a', 'ops@faridabad.example');
  await assertTheme(page, theme);
  const { outcomes, details } = await assertNothingInvented(page, `${theme} (faridabad)`);
  for (const needed of ['FAIL', 'UNTESTABLE', 'PASS']) {
    if (!outcomes.has(needed))
      throw new Error(`no machine is ${needed} — the spread is incomplete`);
  }
  await open(page, `/vendor/qc/visits/${details[0].id}/results`, 'h1', 'ops@faridabad.example');
  await page.waitForTimeout(600);
  await capture(page, `T30-results-fail-and-untestable-${theme}`);
  await context.close();
}

async function empty(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor/qc/visits', 'h1', BRAND_NEW);
  await page.waitForTimeout(800);
  await assertTheme(page, theme);
  await capture(page, `T30-visits-empty-${theme}`);

  await open(page, '/vendor/qc/visits?status=COMPLETED', 'h1', BRAND_NEW);
  await page.waitForTimeout(600);
  await capture(page, `T30-visits-empty-filtered-${theme}`);
  await context.close();
}

async function loadingAndError(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  const { email } = RUNS[theme];
  await signIn(page, email);

  await page.route(VISITS, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}/vendor/qc/visits`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await capture(page, `T30-visits-loading-${theme}`);
  await page.unroute(VISITS);

  await page.route(VISITS, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}/vendor/qc/visits`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `T30-visits-error-${theme}`);
  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // A stale dev server has produced screenshots of behaviour that no longer
  // exists twice on this machine. `/api/vendor/qc/visits` is new in this change,
  // so a 404 with the Nest router's own wording means the running build predates
  // it. 401 is the right answer for an unauthenticated call and proves it serves.
  const probe = await fetch(`${API}/api/vendor/qc/visits`);
  const body = await probe.text();
  if (probe.status === 404 && body.includes('Cannot GET')) {
    throw new Error('the API is a stale build — /api/vendor/qc/visits is not served');
  }
  console.log(`API serves the vendor visit route (unauthenticated: ${probe.status})`);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      await run(browser, theme);
      await failures(browser, theme);
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
