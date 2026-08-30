/**
 * T28 review captures: the vendor listings board and the repricing screen, every
 * state, both themes, 1440 / 900 / 600.
 *
 * **Almost nothing here is stubbed.** The statuses on the board are real rows —
 * the DRAFT and AWAITING_QC listings are what T27's capture run actually created
 * through the wizard, and the PAUSED row is produced by pressing Pause and then
 * put back by pressing Resume, so the bulk bar is photographed doing its job
 * rather than mocked into position. The repricing screen is pointed at Mayapuri
 * IT Exchange, whose stock the demo orders were placed against: 9 of the 12
 * machines on one listing carry a `purchase_price` and genuinely cannot be
 * repriced.
 *
 * It also **asserts the thing T26 got wrong once already**: the dashboard's
 * grade-correction queue links to `?corrected=1`, and the count it prints and
 * the rows the board returns are read in the same run and compared. A filter
 * that silently returns everything, or nothing, is the same class of defect as a
 * queue that links to a route that does not exist.
 *
 * THE_ONLY_STUBS
 *   - board-loading / board-error: the listings GET is delayed, then answered
 *     500. A local API answers in ~30ms and cannot be made to fail on demand.
 *   - reprice-all-committed: the units GET is answered with every machine
 *     flagged `payoutLocked`. This is a real product state — a buyer takes the
 *     whole listing — but no seeded listing is fully committed and reaching it
 *     for real means placing an order through `ordering`, which this task does
 *     not own. The component renders the response exactly as it would a real one.
 *   Every stub intercepts the network and lets the real screen render the result.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const LISTINGS = '**/api/vendor/listings?*';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** Stock in several statuses, and the one open grade correction. */
const NORTHGATE = 'ops@northgate.example';
/** Nine of twelve machines on one listing are committed to a purchase order. */
const COMMITTED = 'ops@mayapuri.example';
/** A verified vendor with no stock at all. */
const BRAND_NEW = 'newvendor@ridgeline.example';

/** Mayapuri's listings, read out of the dev database. */
const LISTING_WITH_COMMITTED = 'b6e12109-34d1-49be-a047-e5062289b0aa';
const LISTING_ALL_OPEN = '4e8a5857-b5f8-487e-b1c4-dbdbd6303747';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1500 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(300);
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
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
 * The queue and the board it links to must be answering the same question.
 *
 * Read in one run, from the live API, as the signed-in vendor. T26 shipped this
 * link with a predicate that matched zero rows; T28 found the successor
 * predicate matched too many. Neither was visible by reading either file.
 */
async function assertQueueAgreesWithBoard(page) {
  const result = await page.evaluate(async () => {
    const get = async (u) => (await fetch(u, { credentials: 'include' })).json();
    const dash = await get('/api/vendor/dashboard');
    const board = await get('/api/vendor/listings?page=1&pageSize=50&corrected=1');
    return { queue: dash.queues.gradeCorrections.count, rows: board.total };
  });
  // Not equality: one listing can carry several corrections, so the board's row
  // count is the number of LISTINGS and the queue's is the number of
  // CORRECTIONS. What must never happen is a queue that promises work and a
  // board with nothing on it, or a board carrying listings the queue never
  // counted.
  if (result.queue > 0 && result.rows === 0)
    throw new Error(`queue says ${result.queue} but the board it links to is empty`);
  if (result.queue === 0 && result.rows > 0)
    throw new Error(`queue says nothing to do but the board shows ${result.rows} listings`);
  if (result.rows > result.queue)
    throw new Error(`board shows ${result.rows} listings for ${result.queue} corrections`);
  console.log(`  queue ${result.queue} corrections -> board ${result.rows} listings: agrees`);
}

async function board(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, NORTHGATE);

  await open(page, '/vendor/listings', 'tbody a', NORTHGATE);
  await assertTheme(page, theme);
  await assertQueueAgreesWithBoard(page);
  await capture(page, `T28-board-${theme}`);

  // The bulk bar refusing itself, with the reason on the control. The first row
  // is a DRAFT — nothing to pause — and the button says exactly that rather than
  // going grey and silent.
  const rows = page.locator('tbody tr');
  await rows.first().locator('input[type="checkbox"]').check();
  await page.waitForSelector('text=1 selected', { timeout: 10000 });
  await capture(page, `T28-board-selection-refused-${theme}`);
  await rows.first().locator('input[type="checkbox"]').uncheck();

  // A real pause, through the real bulk bar, and put back afterwards. PAUSED and
  // ACTIVE are two of the four tones this pass changed, so both are worth having
  // as rows rather than as a story about rows.
  const live = page.locator('tbody tr').filter({ has: page.getByText('ACTIVE', { exact: true }) });
  await live.first().locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // Scoped to the table body: `text=PAUSED` also matches the hidden <option> in
  // the status filter, which is present before the row ever changes.
  const paused = page.locator('tbody tr').filter({ has: page.getByText('PAUSED', { exact: true }) });
  await paused.first().waitFor({ timeout: 20000 });
  await capture(page, `T28-board-paused-${theme}`);

  await paused.first().locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(2000);

  // Where the dashboard's correction queue lands.
  await open(page, '/vendor/listings?corrected=1', 'tbody a', NORTHGATE);
  await capture(page, `T28-board-corrected-${theme}`);

  await open(page, '/vendor/listings?status=REJECTED', 'text=Nothing matches this filter', NORTHGATE);
  await capture(page, `T28-board-filtered-empty-${theme}`);

  await context.close();
}

async function boardEmpty(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor/listings', 'text=No stock listed yet', BRAND_NEW);
  await assertTheme(page, theme);
  await capture(page, `T28-board-empty-${theme}`);
  await context.close();
}

async function boardStates(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, NORTHGATE);

  await page.route(LISTINGS, async (route) => {
    await new Promise((r) => setTimeout(r, 20000));
    await route.continue();
  });
  await page.goto(`${CONSOLE}/vendor/listings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Loading your listings', { timeout: 20000 });
  await assertTheme(page, theme);
  await capture(page, `T28-board-loading-${theme}`);
  await page.unroute(LISTINGS);

  await page.route(LISTINGS, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }),
    }),
  );
  await page.goto(`${CONSOLE}/vendor/listings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Your listings did not load', { timeout: 30000 });
  await capture(page, `T28-board-error-${theme}`);
  await context.close();
}

async function reprice(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, COMMITTED);

  // Nothing typed yet, and nine machines that will not move whatever is typed.
  await open(
    page,
    `/vendor/listings/${LISTING_WITH_COMMITTED}/reprice`,
    'text=What will not change',
    COMMITTED,
  );
  await assertTheme(page, theme);
  await capture(page, `T28-reprice-committed-${theme}`);

  // An amount, no reason yet: the primary action is refused and says why.
  await page.getByLabel('New net payout per machine').fill('47500');
  await page.waitForSelector('[data-testid="reprice-net"]', { timeout: 20000 });
  await capture(page, `T28-reprice-no-reason-${theme}`);

  await page.getByLabel('Why').fill('Competitor dropped on this configuration');
  await page.waitForTimeout(400);
  await capture(page, `T28-reprice-ready-${theme}`);

  // A listing with nothing committed: the panel says so rather than showing a
  // heading over an empty list.
  await open(
    page,
    `/vendor/listings/${LISTING_ALL_OPEN}/reprice`,
    'text=What will not change',
    COMMITTED,
  );
  await capture(page, `T28-reprice-all-open-${theme}`);

  // STUB — every machine committed. A real product state nothing seeded reaches.
  await page.route(`**/api/vendor/listings/${LISTING_WITH_COMMITTED}/units`, async (route) => {
    const res = await route.fetch();
    const units = await res.json();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(units.map((u) => ({ ...u, payoutLocked: true }))),
    });
  });
  await open(
    page,
    `/vendor/listings/${LISTING_WITH_COMMITTED}/reprice`,
    'text=nothing to preview',
    COMMITTED,
  );
  await capture(page, `T28-reprice-nothing-movable-${theme}`);
  await page.unroute(`**/api/vendor/listings/${LISTING_WITH_COMMITTED}/units`);

  await context.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of process.env.THEME ? [process.env.THEME] : ['dark', 'light']) {
  console.log(`--- ${theme} ---`);
  await board(browser, theme);
  await boardEmpty(browser, theme);
  await boardStates(browser, theme);
  await reprice(browser, theme);
}
await browser.close();
console.log('done');
