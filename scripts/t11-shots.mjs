/**
 * T11 review captures: `/search`, every state, both themes, 1440 / 900 / 600.
 *
 * Nothing is stubbed or painted on. Every screen below is the real route
 * reading the real API against the real database — 48 sellable units across six
 * (model, grade) offers, which is what makes the "page 2" and "filtered to
 * zero" shots reachable at all.
 *
 * Two states need the environment moved rather than a URL:
 *
 * **Loading** is reached by delaying the RSC fetch of a client-side navigation
 * by four seconds and screenshotting `loading.tsx` while it is on screen. A
 * first load renders on the server, so there is no moment at which the browser
 * has the skeleton — clicking a facet is the only way a real reader sees it.
 *
 * **Error** is reached by stopping the API and loading the page. The page then
 * renders its own error panel because `getSearch` returned null; nothing is
 * mocked, and the API is started again afterwards.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();

const stopApi = () =>
  ps(
    'Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |' +
      ' ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; "stopped"',
  );

function startApi() {
  spawn('node', ['dist/main.js'], {
    cwd: 'apps/api',
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function waitFor(url, want) {
  for (let i = 0; i < 60; i += 1) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok === want) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} never became ${want ? 'up' : 'down'}`);
}

/* --------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

/** 1440 first, then the two breakpoints the design system names. */
async function capture(page, name) {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(350);
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1500 });
    await page.waitForTimeout(350);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(250);
}

async function open(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  // The dev-server badge is not part of the design. Hidden for the capture
  // only; nothing about the page itself changes.
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { context, page };
}

const go = async (page, path) => {
  await page.goto(`${SHOP}${path}`, { waitUntil: 'networkidle' });
};

/* ------------------------------------------------------------------ the run */

async function states(page, theme) {
  // 1 — unfiltered. The whole rail, the whole grid.
  await go(page, '/search');
  await capture(page, `T11-unfiltered-${theme}`);

  // 2 — the rail alone, so the disabled zero-count options are legible. Apple,
  // Asus, Dell, HP, Lenovo, Microsoft and MSI are all at 0 and all still there.
  await page.locator('#filter-rail').screenshot({
    path: `${OUT}/T11-zero-count-disabled-${theme}.png`,
  });
  console.log('captured', `T11-zero-count-disabled-${theme}`);

  // 3 — three facets applied, ticked by clicking rather than by URL, so the
  // shot proves the controls write the URL and not just that the URL reads.
  await go(page, '/search');
  for (const [name, expected] of [
    [/^Acer/, /brand=acer/],
    [/^16 GB/, /ram=16/],
    [/^A · excellent/, /grade=A(&|$)/],
  ]) {
    await page.getByRole('checkbox', { name }).click();
    await page.waitForURL(expected);
    await page.waitForTimeout(700);
  }
  await capture(page, `T11-three-facets-${theme}`);

  // 4 — filtered to zero, reached by ticking a fourth real option.
  await go(page, '/search?brand=acer&ram=16&grade=A_PLUS');
  await capture(page, `T11-zero-results-${theme}`);

  // 5 — list view.
  await go(page, '/search?view=list');
  await capture(page, `T11-list-${theme}`);

  // 6 — grid view, explicitly, with a sort applied.
  await go(page, '/search?view=grid&sort=score');
  await capture(page, `T11-grid-sorted-${theme}`);

  // 7 — page 2. Six offers, four to a page.
  await go(page, '/search?per=4&page=2');
  await capture(page, `T11-page-2-${theme}`);

  // 8 — the 900px sheet, open.
  await page.setViewportSize({ width: 900, height: 1200 });
  await go(page, '/search?brand=acer&ram=16');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.waitForTimeout(400);
  await shot(page, `T11-sheet-open-${theme}-900`);
  await page.setViewportSize({ width: 600, height: 1200 });
  await page.waitForTimeout(400);
  await shot(page, `T11-sheet-open-${theme}-600`);
  await page.setViewportSize({ width: 1440, height: 1500 });

  // 9 — loading. Delay the RSC fetch a client navigation makes, click a facet,
  // and photograph `loading.tsx` while it is genuinely on screen.
  await go(page, '/search');
  let stall = true;
  // A predicate, not a glob: Playwright's glob treats `?` as a single-character
  // wildcard, so a pattern meant to catch `...?brand=acer&_rsc=1cmil` silently
  // matched nothing and the capture came back showing the loaded page.
  await page.route(
    (url) => url.searchParams.has('_rsc'),
    async (route) => {
      if (stall) await new Promise((r) => setTimeout(r, 5000));
      // The handler outlives the navigation it delayed, so a continue that has
      // already been answered is expected rather than a failure.
      await route.continue().catch(() => {});
    },
  );
  await page.getByRole('checkbox', { name: /^Acer/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, `T11-loading-${theme}`);
  stall = false;
  await page.waitForTimeout(6000);
}

/**
 * A FILTERED url on purpose.
 *
 * The unfiltered board is revalidated, so with the API stopped Next happily
 * serves the last good render and the capture would show a working page over a
 * dead API — which is the cache doing its job, and a screenshot proving nothing.
 * Every filtered url is `no-store`, so this one genuinely has to reach the API
 * and genuinely fails.
 */
async function errorState(page, theme) {
  await go(page, '/search?brand=acer&ram=16');
  await capture(page, `T11-error-${theme}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitFor(`${API}/health`, true);

  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    const { context, page } = await open(browser, theme);
    await states(page, theme);
    await context.close();
  }

  // The error state, for real: the API is stopped, so `getSearch` returns null
  // and the page renders the panel it renders in production when the catalogue
  // does not answer.
  console.log(stopApi());
  await waitFor(`${API}/health`, false);
  for (const theme of ['dark', 'light']) {
    const { context, page } = await open(browser, theme);
    await errorState(page, theme);
    await context.close();
  }
  startApi();
  await waitFor(`${API}/health`, true);

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  startApi();
  process.exit(1);
});
