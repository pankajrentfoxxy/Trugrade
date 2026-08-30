/**
 * T31 review captures: the vendor's grade-correction board and the screen where
 * one is answered. Every state, both themes, 1440 / 900 / 600.
 *
 * **The two answers are real.** The dark run accepts a correction and the light
 * run withdraws a machine, both through the product, against the dev database —
 * so `T31-record-settled-*` photographs a row the API actually wrote, and the
 * "already settled" tab afterwards is populated by that write rather than by a
 * fixture. Udyog Vihar has three open corrections, which is why it is the vendor
 * used: two answers still leave the board with something on it.
 *
 * **It asserts the thing this task was warned about, live and twice.** The
 * dashboard's correction queue and the listings board's `?corrected=1` filter
 * answer the same question, and they agreed before T31 only because nothing
 * could answer a correction. Both numbers are read from the API before the
 * answers and again after them, and the run fails if they disagree either time.
 *
 * It also checks the API is not a stale build before it believes anything: a
 * `404` on the new route means the running process predates it, which has
 * produced screenshots of behaviour that no longer exists twice on this machine.
 *
 * THE_ONLY_STUBS
 *   - board-loading / board-error: the corrections GET is delayed, then answered
 *     500. A local API answers in ~20ms and cannot be made to fail on demand.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const CORRECTIONS = '**/api/vendor/grade-corrections';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** Three open corrections, all ~77 hours into a 48-hour window. */
const UDYOG = 'ops@udyog.example';
/** A verified vendor with no stock, and therefore no corrections. */
const BRAND_NEW = 'newvendor@ridgeline.example';

/** Udyog's three, read out of the dev database. */
const ACCEPT_ME = '4b3730d1-f34f-4856-81d6-061f66967c58';
const LEAVE_OPEN = '42b904a2-2e19-422a-a47e-cd3b63fb6e96';
const WITHDRAW_ME = '8358aba2-16f6-48bf-8917-45dba24bf92f';
/** Northgate's. Udyog must not be able to open it. */
const SOMEBODY_ELSES = '7ee1b5b3-c832-4daf-9163-b44aa27323f9';

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
 * The queue, the listings filter and the vendor's own board are one predicate.
 *
 * Read in one pass from the live API as the signed-in vendor. The board's row
 * count is LISTINGS and the queue's is CORRECTIONS, so they are not required to
 * be equal — but a queue promising work over an empty board, or a board carrying
 * listings the queue never counted, is the defect.
 */
async function assertOneQuestion(page, when) {
  const r = await page.evaluate(async () => {
    const get = async (u) => (await fetch(u, { credentials: 'include' })).json();
    const dash = await get('/api/vendor/dashboard');
    const board = await get('/api/vendor/listings?page=1&pageSize=50&corrected=1');
    const mine = await get('/api/vendor/grade-corrections');
    return {
      queue: dash.queues.gradeCorrections.count,
      rows: board.total,
      open: mine.filter((c) => c.vendorResponse === null && c.autoAppliedAt === null).length,
    };
  });
  if (r.queue !== r.open)
    throw new Error(`${when}: dashboard counts ${r.queue} open, the corrections board sees ${r.open}`);
  if (r.queue > 0 && r.rows === 0)
    throw new Error(`${when}: queue says ${r.queue} but ?corrected=1 is empty`);
  if (r.queue === 0 && r.rows > 0)
    throw new Error(`${when}: queue says nothing to do but ?corrected=1 shows ${r.rows}`);
  if (r.rows > r.queue)
    throw new Error(`${when}: ?corrected=1 shows ${r.rows} listings for ${r.queue} corrections`);
  console.log(`  ${when}: queue ${r.queue} = board ${r.open}, over ${r.rows} listings — agrees`);
}

async function pick(page, label) {
  await page.getByRole('radio', { name: new RegExp(label) }).first().check();
  await page.waitForTimeout(250);
}

async function run(browser, theme, answer) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, UDYOG);

  // ---- the board ---------------------------------------------------------
  await open(page, '/vendor/corrections', 'tbody a', UDYOG);
  await assertTheme(page, theme);
  await assertOneQuestion(page, `${theme} before answering`);
  await capture(page, `T31-board-${theme}`);

  await open(page, '/vendor/corrections?show=answered', 'h1', UDYOG);
  await page.waitForTimeout(400);
  await capture(page, `T31-board-answered-${theme}`);

  // ---- one correction, unanswered ----------------------------------------
  await open(page, `/vendor/corrections/${answer.id}`, '[data-testid="side-panel"]', UDYOG);
  await capture(page, `T31-record-${theme}`);

  // Disputing is one click from where accepting is, which is the point of the
  // layout. Photographed selected, with the note field it opens.
  await pick(page, 'Dispute the correction');
  await page.getByLabel('What did we get wrong?').fill('That scuff is on the palm rest, not the lid, and it is inside A+ tolerance.');
  await page.waitForTimeout(250);
  await capture(page, `T31-record-dispute-${theme}`);

  // The reprice field, refused and then accepted. The message names what is
  // wrong and how to fix it, and the button stays reachable so it can say why.
  await pick(page, 'Accept it, at a new price');
  await page.getByLabel('What you want for this machine').fill('thirty four thousand');
  await page.waitForTimeout(250);
  await capture(page, `T31-record-reprice-invalid-${theme}`);
  await page.getByLabel('What you want for this machine').fill('34000');
  await page.waitForTimeout(250);
  await capture(page, `T31-record-reprice-valid-${theme}`);

  // ---- the real answer ---------------------------------------------------
  await pick(page, answer.label);
  await page.getByRole('button', { name: 'Send your answer' }).click();
  await page.waitForSelector('text=settled', { timeout: 15000 });
  await capture(page, `T31-record-settled-${theme}`);

  await open(page, '/vendor/corrections?show=answered', 'h1', UDYOG);
  await page.waitForTimeout(500);
  await capture(page, `T31-board-answered-after-${theme}`);

  await assertOneQuestion(page, `${theme} after answering`);

  // ---- somebody else's ---------------------------------------------------
  await open(page, `/vendor/corrections/${SOMEBODY_ELSES}`, 'text=did not load', UDYOG);
  await page.waitForTimeout(500);
  await capture(page, `T31-record-not-yours-${theme}`);

  await context.close();
}

async function empty(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor/corrections', 'h1', BRAND_NEW);
  await page.waitForTimeout(600);
  await assertTheme(page, theme);
  await capture(page, `T31-board-empty-${theme}`);
  await context.close();
}

async function loadingAndError(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, UDYOG);

  await page.route(CORRECTIONS, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await page.goto(`${CONSOLE}/vendor/corrections`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await capture(page, `T31-board-loading-${theme}`);
  await page.unroute(CORRECTIONS);

  await page.route(CORRECTIONS, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}/vendor/corrections`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `T31-board-error-${theme}`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // The trap that has cost this build two capture runs: a dev API still serving
  // the previous build. A 404 here means the process predates the route.
  const probe = await fetch(`${API}/api/vendor/grade-corrections`);
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — it does not know the T31 route');
  }
  console.log(`api /api/vendor/grade-corrections -> ${probe.status} (not 404: the build is current)`);

  const browser = await chromium.launch();
  try {
    await run(browser, 'dark', { id: ACCEPT_ME, label: 'Accept the corrected grade' });
    await run(browser, 'light', { id: WITHDRAW_ME, label: 'Take the machine back' });
    for (const theme of ['dark', 'light']) {
      await empty(browser, theme);
      await loadingAndError(browser, theme);
    }
    console.log(`\n${LEAVE_OPEN} deliberately left open, so the board still has a row.`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
