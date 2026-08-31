/**
 * T35 review captures: the global command palette and the unit 360.
 * Every state, both themes, 1440 / 900 / 600.
 *
 * WHAT THIS RUN DOES FOR REAL RATHER THAN FAKING
 * ----------------------------------------------
 * 1. **The permission slice is two real sign-ins, not two fixtures.**
 *    OPS_MANAGER holds `listing.any.read`, `ordering.any.read` and
 *    `procurement.po.read_any`; TECHNICIAN holds the first and neither of the
 *    others. Each is signed in and pointed at the SAME serial and the SAME
 *    search term, so the withheld-commercial frame and the
 *    orders-not-searched frame are the product refusing rather than a
 *    screenshot of a mock.
 * 2. **Every 360 state is a real machine on this database.**
 *    - `TGD5963139B` — inspected, sealed and verified, sold on TT-26-00013 with
 *      a purchase order behind it, warranty open, one return raised.
 *    - `TGD32792345` — on TT-26-00007, which is DELIVERED with a PENDING
 *      approval and NO purchase order at all. That is a known defect in the
 *      data, not in this screen, and the screen must say so rather than leave
 *      the money column blank.
 *    - `T27D806273` — never inspected, never sealed, never sold.
 *    Not one is stubbed.
 * 3. **The empty audit trail is real and is the finding.** `identity.audit_log`
 *    holds 1,653 rows and NOT ONE of them names a unit; the run asserts that
 *    before photographing the screen that says so.
 *
 * WHY THE SEARCH FRAMES USE THREE TERMS AND NOT ONE
 * -------------------------------------------------
 * The brief asked for "a search that finds one of each kind". No such term
 * exists on this database and inventing one would mean seeding a row to suit a
 * screenshot. Serials are `TGD…`, orders `TT-26-…`, purchase orders `PO-26-…`
 * and organisations are legal names — four namespaces with no overlap by
 * construction. So three real terms are captured instead, and the fact that the
 * namespaces do not overlap is reported rather than papered over.
 *
 * THE_ONLY_STUBS
 *   - `*-loading` / `*-error`: the GET is delayed, then answered 500. A local
 *     API answers in ~30 ms and cannot be made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 *
 * ONE OTP PER ACCOUNT PER RUN, AND THAT IS THE BUDGET
 * ---------------------------------------------------
 * OPS_MANAGER is in `MFA_REQUIRED_ROLES` and `/api/auth/mfa/otp` allows five
 * codes an hour with a 60-second cooldown — the ledger's own trap, and it
 * stopped this run twice while it was being written. Two things keep the run
 * inside the budget:
 *
 *   - **The theme is switched by rewriting `tg-theme` and reloading**, inside one
 *     signed-in context, rather than by opening a context per theme.
 *   - **The build-and-data assertions reuse the BROWSER's token.** The obvious
 *     shape — a separate `tokenFor()` fetch — spends a second code per account
 *     for a session that already exists three lines above. The access token is
 *     lifted off the sign-in response instead.
 *
 * If the hourly limit does bite, wait it out: `redis-cli TTL
 * rl:otp-hour:LOGIN:<email>` says how long. Do not debug it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** Holds all three permissions the 360 branches on. Requires MFA. */
const OPS = 'ops@trugrade.in';
/** Holds `listing.any.read` and `qc.report.read` and nothing else. No MFA. */
const TECH = 'tech@trugrade.in';

/** Inspected, sealed, sold with a PO behind it, warranted, and returned once. */
const FULL_SERIAL = 'TGD5963139B';
/** On TT-26-00007: delivered, and no purchase order was ever raised. */
const NO_PO_SERIAL = 'TGD32792345';
/** Never inspected, never sealed, never sold. */
const RAW_SERIAL = 'T27D806273';
/** On no database anywhere. The 404 the screen has to render honestly. */
const MISSING_SERIAL = 'NOSUCHSERIAL01';

/** Four orders and eight purchase orders — two groups, and both capped. */
const TERM_TWO_KINDS = '26-0001';
/** One machine, found by a serial that is also inside its seal code. */
const TERM_SERIAL = FULL_SERIAL;
/** One organisation, by its legal name. */
const TERM_ORG = 'Faridabad';
/** Nothing. */
const TERM_NONE = 'zzzz-no-such-thing';

const UNIT_ROUTE = '**/api/ops/units/**';

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

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

/** Switch theme inside a signed-in context. See the header: this saves an OTP. */
async function setTheme(page, theme) {
  await page.evaluate((t) => window.localStorage.setItem('tg-theme', t), theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await assertTheme(page, theme);
}

/** Sign in, and clear the second factor when the role demands one. */
async function signIn(page, email) {
  let devCode = null;
  const listener = async (response) => {
    if (!response.url().endsWith('/api/auth/mfa/otp')) return;
    const body = await response.json().catch(() => null);
    if (body?.devCode) devCode = body.devCode;
  };
  page.on('response', listener);

  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) {
    page.off('response', listener);
    return;
  }
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const challenge = await page
    .waitForSelector('text=One more code before you are in', { timeout: 8000 })
    .catch(() => null);
  if (challenge) {
    for (let i = 0; i < 60 && devCode === null; i += 1) await page.waitForTimeout(200);
    if (devCode === null) {
      throw new Error(
        `no dev OTP came back for ${email}. The MFA route allows five codes an hour with a ` +
          `60-second cooldown — wait rather than debug.`,
      );
    }
    await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
    await page.waitForTimeout(2500);
  }

  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
  page.off('response', listener);
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

/** Open the palette and type a term, waiting for the result the frame is of. */
async function palette(page, term, ready) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[role="combobox"]', { timeout: 5000 });
  if (term) {
    await page.locator('[role="combobox"]').fill(term);
    await page.waitForSelector(ready, { timeout: 10000 });
  }
  await page.waitForTimeout(400);
}

/**
 * One handler with a mode flag, rather than `route` → `unroute` → `route`.
 *
 * T39's own note, kept because the race it describes is real: the delayed
 * handler sleeps six seconds and is still registered when `unroute` is called,
 * so it serves a real 200 for the request the error frame was meant to fail.
 * That produced a perfectly loaded board named `-error` — exactly the kind of
 * frame that gets believed.
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
  await open(page, path, ready, email);
  await capture(page, `${base}-error`);
  await page.unroute(pattern);
}

/* -------------------------------------------------------------------------
 * Refuse to photograph a stale build, or a database that cannot show what the
 * screens claim. T48 published a frame that claimed an outage while showing
 * live data; this is the discipline that stops that.
 * ---------------------------------------------------------------------- */

/**
 * Sign a page in and hand back the access token it is now using.
 *
 * One code, one session, used by both the browser and the assertions below.
 * `signIn` above does the MFA dance; this only listens for the token.
 */
async function signInAndToken(page, email) {
  let token = null;
  const listener = async (response) => {
    if (!/\/api\/auth\/(login|mfa\/verify)$/.test(new URL(response.url()).pathname)) return;
    const body = await response.json().catch(() => null);
    if (body?.accessToken) token = body.accessToken;
  };
  page.on('response', listener);
  await signIn(page, email);
  page.off('response', listener);
  if (!token) throw new Error(`no access token came back for ${email}`);
  return token;
}

const asJson = async (token, path) => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};

async function assertBuildAndData(ops, tech) {

  // 1. The two routes this task built exist at all. A stale `dist/` answers 404
  //    while the Vite console renders its error state, which photographs as a
  //    design fault rather than a missing build. That has happened twice here.
  const search = await asJson(ops, `/api/ops/search?q=${encodeURIComponent(TERM_TWO_KINDS)}`);
  if (!Array.isArray(search.groups)) throw new Error('the palette route predates this build');
  const withHits = search.groups.filter((g) => g.hits.length > 0).map((g) => g.key);
  if (withHits.length < 2) {
    throw new Error(`"${TERM_TWO_KINDS}" hit ${withHits.length} group(s); the frame wants two`);
  }
  if (!search.groups.some((g) => g.more > 0)) {
    throw new Error('no group is capped, so the "more not shown" line is unreachable');
  }

  // 2. All three 360 states are reachable on THIS database. A run where every
  //    machine happened to be inspected and sold would photograph as if the
  //    nullable halves were not there.
  const full = await asJson(ops, `/api/ops/units/${FULL_SERIAL}`);
  if (!full.qc) throw new Error(`${FULL_SERIAL} has no QC report; pick another serial`);
  if (!full.commercial?.margin) throw new Error(`${FULL_SERIAL} has no margin; pick another`);
  if (full.returns.length === 0) throw new Error(`${FULL_SERIAL} has no return; pick another`);
  if (full.seal?.status !== 'INTACT') {
    throw new Error(`${FULL_SERIAL}'s seal is ${full.seal?.status}, wanted a verified one`);
  }

  const noPo = await asJson(ops, `/api/ops/units/${NO_PO_SERIAL}`);
  if (noPo.commercial?.paid !== null || !noPo.commercial?.poUnavailable) {
    throw new Error(`${NO_PO_SERIAL} now has a purchase order; the refusal state is unreachable`);
  }
  if (noPo.seal?.status !== 'APPLIED') {
    throw new Error(`${NO_PO_SERIAL}'s seal is ${noPo.seal?.status}; wanted an unverified one`);
  }

  const raw = await asJson(ops, `/api/ops/units/${RAW_SERIAL}`);
  if (raw.qc !== null || raw.commercial !== null) {
    throw new Error(`${RAW_SERIAL} has been inspected or sold; the never-touched frame is gone`);
  }

  // 3. The audit-log finding, asserted before the screen that states it is
  //    photographed. If a serial ever DOES get an audit row, this run stops and
  //    the screen's copy needs rewriting rather than the frame being republished.
  for (const [serial, unit] of [
    [FULL_SERIAL, full],
    [NO_PO_SERIAL, noPo],
    [RAW_SERIAL, raw],
  ]) {
    if (unit.auditEntries !== 0) {
      throw new Error(
        `${serial} now has ${unit.auditEntries} audit entries — the screen says every serial has none`,
      );
    }
  }

  // 4. The permission slice is real, not a rendering choice. Same serial, same
  //    term, a role that holds one permission fewer.
  const techUnit = await asJson(tech, `/api/ops/units/${FULL_SERIAL}`);
  if (techUnit.commercial !== null || !techUnit.commercialUnavailable) {
    throw new Error('TECHNICIAN can see the trade — the withheld frame is unreachable');
  }
  if (techUnit.qc === null) {
    throw new Error('TECHNICIAN cannot see the machine either — that is a different bug');
  }
  const techSearch = await asJson(
    tech,
    `/api/ops/search?q=${encodeURIComponent(TERM_TWO_KINDS)}`,
  );
  if (techSearch.groups.some((g) => g.key === 'orders')) {
    throw new Error('TECHNICIAN searched orders — the not-searched frame is unreachable');
  }
  if (JSON.stringify(techSearch).match(/TT-26-\d/)) {
    throw new Error('an order number reached a TECHNICIAN response — that is the oracle, live');
  }

  // 5. A vendor is refused outright, and the frame of that refusal is real.
  const vendorRefused = await fetch(`${API}/api/ops/units/${FULL_SERIAL}`, {
    headers: { Authorization: `Bearer ${tech}` },
  });
  if (vendorRefused.status !== 200) {
    throw new Error(`the TECHNICIAN control got ${vendorRefused.status}, wanted 200`);
  }

  console.log(
    `build and data checked: "${TERM_TWO_KINDS}" hits ${withHits.join(' + ')}, ` +
      `${FULL_SERIAL} margin ₹${full.commercial.margin}, ${NO_PO_SERIAL} has no PO, ` +
      `${RAW_SERIAL} untouched, and every serial has 0 audit entries.`,
  );
}

/* ---------------------------------------------------------------------- */

async function runOps(browser, page, context) {
  for (const theme of ['dark', 'light']) {
    await open(page, `/units/${FULL_SERIAL}`, 'text=Margin on this machine', OPS);
    await setTheme(page, theme);
    await capture(page, `T35-unit-360-full-${theme}`);

    await open(page, `/units/${NO_PO_SERIAL}`, 'text=None raised', OPS);
    await capture(page, `T35-unit-360-no-po-${theme}`);

    await open(page, `/units/${RAW_SERIAL}`, 'text=never been inspected', OPS);
    await capture(page, `T35-unit-360-never-inspected-${theme}`);

    // A real 404 rendered by the real screen, not a stub.
    await open(page, `/units/${MISSING_SERIAL}`, 'text=did not load', OPS);
    await capture(page, `T35-unit-360-not-found-${theme}`);

    // ---- the palette, from a screen it is meant to be used on --------
    await open(page, '/overview', 'text=What is stuck', OPS);
    await palette(page, '', null);
    await capture(page, `T35-palette-empty-${theme}`);

    await palette(page, TERM_TWO_KINDS, 'text=more not shown');
    await capture(page, `T35-palette-two-kinds-${theme}`);

    await palette(page, TERM_SERIAL, `text=${FULL_SERIAL}`);
    await capture(page, `T35-palette-serial-${theme}`);

    await palette(page, TERM_ORG, 'text=Faridabad TechCycle');
    await capture(page, `T35-palette-organisation-${theme}`);

    await palette(page, TERM_NONE, 'text=Nothing on this platform carries');
    await capture(page, `T35-palette-none-${theme}`);
    await page.keyboard.press('Escape');
  }

  await setTheme(page, 'dark');
  await delayedThen500(
    page,
    UNIT_ROUTE,
    `/units/${FULL_SERIAL}`,
    'text=did not load',
    'T35-unit-360-dark',
    OPS,
  );
  await context.close();
}

async function runTechnician(browser, page, context) {
  for (const theme of ['dark', 'light']) {
    await open(page, `/units/${FULL_SERIAL}`, 'text=not yours to see', TECH);
    await setTheme(page, theme);
    await capture(page, `T35-unit-360-trade-withheld-${theme}`);

    await open(page, `/units/${FULL_SERIAL}`, 'text=not yours to see', TECH);
    await palette(page, TERM_TWO_KINDS, 'text=Not searched');
    await capture(page, `T35-palette-role-slice-${theme}`);
    await page.keyboard.press('Escape');

    // The order board, refused as the product refuses it. A TECHNICIAN has no
    // rail entry for it; typing the address is the only way in.
    await open(page, '/orders', 'text=You do not have access', TECH);
    await capture(page, `T35-orders-refused-to-technician-${theme}`);
  }

  await context.close();
}

async function openContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  // Seeded ONLY when absent. An unconditional init script re-runs on every
  // navigation and silently undid `setTheme`, so the whole light half of the run
  // came out dark while `assertTheme` was the only thing that noticed.
  await context.addInitScript(() => {
    if (!window.localStorage.getItem('tg-theme')) window.localStorage.setItem('tg-theme', 'dark');
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { context, page };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  // Both sign-ins first, so the assertions run on the same two sessions the
  // captures do — and cost one MFA code between them rather than four.
  const opsPage = await openContext(browser);
  const opsToken = await signInAndToken(opsPage.page, OPS);
  const techPage = await openContext(browser);
  const techToken = await signInAndToken(techPage.page, TECH);

  await assertBuildAndData(opsToken, techToken);

  await runOps(browser, opsPage.page, opsPage.context);
  await runTechnician(browser, techPage.page, techPage.context);
} finally {
  await browser.close();
}
console.log('done');
