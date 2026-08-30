/**
 * T48 review captures: the ten `/legal/**` documents and the index, in both
 * themes, at 1440 / 900 / 600.
 *
 * THE BUILD-FRESHNESS ASSERTION
 * -----------------------------
 * The API dev server has served a stale build during a capture run more than
 * once on this machine, and the frames then show behaviour that no longer
 * exists. This run refuses to photograph anything until BOTH endpoints these
 * pages read prove they are the current build:
 *
 *   - `/api/public/legal-terms` must exist at all — it is new in this task, and
 *     a pre-T48 build answers 404;
 *   - `/api/public/grades` must carry `maxCycleCount`, which is also new. A
 *     pre-T48 build answers the same 200 with only `minBatteryHealthPct`, and
 *     `/legal/grading` would then render two of its three floors as "Not set" —
 *     a frame that looks like a data problem and is a stale-server problem.
 *
 * THE OTHER ASSERTION THAT MATTERS
 * --------------------------------
 * After each document is loaded, the rendered figure is compared against the
 * live endpoint. `/legal/returns-and-refunds` must show the hours config holds,
 * and `/legal/grading` must show every floor on the grade rows. A screenshot of
 * a page that has drifted from its enforcement is exactly the artefact this
 * task exists to prevent, so the run fails rather than saving it.
 *
 * THE_ONLY_STUBS
 *   None. Every frame here is the real page rendering the real configuration.
 *
 *   The unavailable state -- a term that cannot be read -- is NOT captured here,
 *   and the first attempt to do so produced a false frame worth recording. These
 *   pages fetch on the SERVER, so a Playwright page.route() 500 never reaches the
 *   code under test: the browser makes no such request, Next served its cached
 *   render, and the "unavailable" screenshot showed 48 hours in full. It is
 *   captured for real by `t48-unavailable-shots.mjs`, with the API stopped and
 *   Next's fetch cache cleared, and that script asserts that no live value
 *   survived before it saves anything.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const STOREFRONT = 'http://localhost:3000';
const API = 'http://localhost:4000';

const SLUGS = [
  'terms',
  'privacy',
  'grievance',
  'returns-and-refunds',
  'warranty',
  'grading',
  'wipe-standard',
  'shipping',
  'cancellation',
  'pricing-and-taxes',
];

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

/* ------------------------------------------------- the build-freshness gate */

async function currentBuild() {
  const termsRes = await fetch(`${API}/api/public/legal-terms`);
  if (!termsRes.ok) {
    throw new Error(
      `/api/public/legal-terms answered ${termsRes.status}. The API is a pre-T48 build — ` +
        'restart it by port before capturing.',
    );
  }
  const terms = await termsRes.json();
  if (typeof terms.inspectionWindowHours !== 'number') {
    throw new Error('inspectionWindowHours is not configured; the frames would show no window.');
  }

  const grades = await (await fetch(`${API}/api/public/grades`)).json();
  if (!grades.length || grades.some((g) => typeof g.maxCycleCount !== 'number')) {
    throw new Error(
      'The grades endpoint has no maxCycleCount. That field is new in T48, so this is a ' +
        'stale API build and /legal/grading would photograph two empty columns.',
    );
  }
  console.log(
    `build is current — window ${terms.inspectionWindowHours}h, ` +
      `warranty ${terms.warrantyTopUpMonths}+/${terms.warrantyMinTotalMonths} floor, ` +
      `grievance ${terms.grievanceAckHours}h/${terms.grievanceRedressDays}d, ` +
      `${grades.length} grade rows`,
  );
  return { terms, grades };
}

/** The page must state what the enforcement holds. Text, from the rendered DOM. */
async function assertAgrees(page, enforced) {
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  for (const want of enforced) {
    if (!text.includes(want)) {
      throw new Error(`the page does not state "${want}" — it has drifted from the enforcement`);
    }
  }
}

/* --------------------------------------------------------------------- run */

async function run(browser, theme, live) {
  const { page, context } = await openPage(browser, theme);
  const { terms, grades } = live;

  await page.goto(`${STOREFRONT}/legal`, { waitUntil: 'networkidle' });
  await assertTheme(page, theme);
  await capture(page, `legal-index-${theme}`);

  for (const slug of SLUGS) {
    await page.goto(`${STOREFRONT}/legal/${slug}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1', { timeout: 20000 });

    if (slug === 'returns-and-refunds') {
      await assertAgrees(page, [`${terms.inspectionWindowHours} hours`]);
    }
    if (slug === 'warranty') {
      await assertAgrees(page, [
        `${terms.warrantyTopUpMonths} months`,
        `${terms.warrantyMinTotalMonths} months`,
      ]);
    }
    if (slug === 'grievance') {
      await assertAgrees(page, [
        `${terms.grievanceAckHours} hours`,
        `${terms.grievanceRedressDays} days`,
      ]);
    }
    if (slug === 'grading') {
      await assertAgrees(
        page,
        grades.flatMap((g) => [
          `${g.minBatteryHealthPct} %`,
          `${g.maxCycleCount} cycles`,
          `${g.minCosmeticScore} / 100`,
        ]),
      );
    }

    await capture(page, `legal-${slug}-${theme}`);
  }

  // The footer is the r.4(2) block and it is on every page. Photographed on the
  // homepage, which is where a first-time visitor meets it.
  await page.goto(`${STOREFRONT}/`, { waitUntil: 'networkidle' });
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.locator('footer').screenshot({ path: `${OUT}/legal-footer-${theme}.png` });
  console.log('captured', `legal-footer-${theme}`);

  await context.close();
}

const live = await currentBuild();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) await run(browser, theme, live);
await browser.close();
console.log('done');
