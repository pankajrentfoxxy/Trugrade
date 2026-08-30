/**
 * T26 review captures: the vendor workspace at `/vendor`, every state, both
 * themes, 1440 / 900 / 600.
 *
 * **Nothing on the success screen is stubbed.** The 73 live machines, the
 * inspection queue at 31 hours and the grade correction 69 hours into a 48-hour
 * window are all rows the API read out of the dev database, and the breach is
 * genuinely a breach — the auto-apply job has not run against a seed written
 * three days ago. `THE_ONLY_STUBS` below lists the two that are, and why.
 *
 * The first-run capture is a real vendor too, not an intercepted zero: an
 * organisation with a verified status, a VENDOR_OPS user and no stock. That is
 * the state the route branches on (`unitsEverListed === 0`), so it is worth
 * having a row for it rather than a mock of one.
 *
 * THE_ONLY_STUBS
 *   - loading: the dashboard GET is delayed, because a local API answers in 20ms
 *     and the skeleton is otherwise unphotographable.
 *   - error:   the dashboard GET is answered 500. There is no way to make the
 *              real endpoint fail on demand that does not involve breaking it.
 *   Both intercept the network and let the real component render the result.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const DASHBOARD = '**/api/vendor/dashboard';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** VENDOR_OPS: holds both dashboard permissions and is not in MFA_REQUIRED_ROLES. */
const STOCKED = 'ops@northgate.example';
/** A verified vendor org with no stock at all. The first-run branch. */
const BRAND_NEW = 'newvendor@ridgeline.example';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

/** 1440 is the design width; 900 and 600 are the two breakpoints that move. */
async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(300);
}

/** Theme pinned before first paint, exactly as the pre-paint read in `<head>` does. */
async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
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
  // Already signed in? /login redirects into the app and there is no form to
  // fill. The retry path below calls this speculatively, so this is the normal
  // case and not an error.
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) return;
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 });
}

/**
 * Navigate, and sign in again if we were bounced back to the login screen.
 *
 * The console holds its access token in memory (deliberately — an XSS cannot
 * read a header it never sees), so a full page reload signs you out. Vite issues
 * one whenever a workspace package rebuilds, which during a parallel build
 * happens several times a minute and dropped a capture run halfway through.
 */
async function open(page, path, ready, email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(ready, { timeout: 20000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await signIn(page, email);
    }
  }
}

/** The screen with stock, both queues and a breached SLA. */
async function workspace(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, STOCKED);
  await open(page, '/vendor', '[data-testid="queue-list"]', STOCKED);
  await assertTheme(page, theme);
  await capture(page, `T26-vendor-workspace-${theme}`);

  // The corrections queue's destination. A queue that links nowhere real is the
  // defect this pass was fixing, so the landing board is part of the evidence.
  await open(page, '/vendor/listings?corrected=1', 'table', STOCKED);
  // `DataBoard` renders its skeleton inside a real <table>, so the element
  // arriving is not the data arriving. A row action only exists on a real row.
  await page.waitForSelector('tbody button', { timeout: 20000 });
  await capture(page, `T26-vendor-corrections-board-${theme}`);
  await context.close();
}

/** A verified vendor who has never listed anything. */
async function firstRun(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, BRAND_NEW);
  await open(page, '/vendor', 'text=List your first stock', BRAND_NEW);
  await assertTheme(page, theme);
  await capture(page, `T26-vendor-first-run-${theme}`);
  await context.close();
}

async function loading(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, STOCKED);
  await page.route(DASHBOARD, async (route) => {
    await new Promise((r) => setTimeout(r, 20000));
    await route.continue();
  });
  await page.goto(`${CONSOLE}/vendor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Loading what needs you', { timeout: 15000 });
  await assertTheme(page, theme);
  await capture(page, `T26-vendor-loading-${theme}`);
  await context.close();
}

async function failed(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, STOCKED);
  await page.route(DASHBOARD, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }),
    }),
  );
  await page.goto(`${CONSOLE}/vendor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Your dashboard did not load', { timeout: 30000 });
  await assertTheme(page, theme);
  await capture(page, `T26-vendor-error-${theme}`);
  await context.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of process.env.THEME ? [process.env.THEME] : ['dark', 'light']) {
  console.log(`--- ${theme} ---`);
  await workspace(browser, theme);
  await firstRun(browser, theme);
  await loading(browser, theme);
  await failed(browser, theme);
}
await browser.close();
console.log('done');
