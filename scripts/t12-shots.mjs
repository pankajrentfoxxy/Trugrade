/**
 * T12 review captures: `/laptops/[slug]`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed or painted on. Every screen below is the real route reading
 * the real API against the real database — the Dell Latitude 5420 at Grade A,
 * held by ten supply points including the two different vendors that are both
 * labelled `F`, one in Noida and one in Faridabad.
 *
 * Three states need the environment moved rather than a URL:
 *
 * **Expiring soon** needs a certificate inside the 14-day window and the seed
 * has none — every unit expires on 22 Nov 2026. One unit's `qc_valid_until` is
 * moved to ten days out, captured, and moved back. It is a real column on a real
 * row going through the real endpoint; nothing is mocked.
 *
 * **Loading** is reached by delaying the RSC fetch of a client-side navigation
 * and photographing `loading.tsx` while it is genuinely on screen.
 *
 * **Error** is reached by stopping the API. The page renders its own error panel
 * because `getOfferBoard` returned null, and the API is started again after.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/** The hero SKU: Dell Latitude 5420, 105 sellable units, ten supply points. */
const SKU = '892eb914-2fcb-48d9-b800-4ff13c6e36e4';
/** An Acer with A+ stock only — asking it for Grade B is the empty board. */
const SKU_ONE_GRADE = '37da7971-e79f-4b8b-8e6a-b807c749944e';

const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();

const sql = (statement) =>
  execFileSync(
    'docker',
    ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-c', statement],
    { encoding: 'utf8' },
  ).trim();

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

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(250);
}

async function open(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  // The dev-server badge is not part of the design. Hidden for the capture only.
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);
    else hide();
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
  // 1 — the landing state. No pincode has been given, so nothing is priced and
  // the board says which of "not asked" and "cannot deliver" is true.
  await go(page, `/laptops/${SKU}`);
  await capture(page, `T12-no-pincode-${theme}`);

  // 2 — the board, ten supply points, landed to 110001.
  await go(page, `/laptops/${SKU}?pin=110001&grade=A`);
  await capture(page, `T12-board-110001-${theme}`);

  // 3 — the same board to two other serviceable pincodes. 250001 is an ODA
  // pincode and its freight is double, so the landed prices differ.
  await go(page, `/laptops/${SKU}?pin=201001&grade=A`);
  await capture(page, `T12-board-201001-${theme}`, []);
  await go(page, `/laptops/${SKU}?pin=250001&grade=A`);
  await capture(page, `T12-board-250001-${theme}`, []);

  // 4 — an unserviceable destination. The serviceable:false arm, with a
  // sentence a buyer can act on.
  await go(page, `/laptops/${SKU}?pin=560001&grade=A`);
  await capture(page, `T12-unserviceable-560001-${theme}`, [600]);

  // 5 — the price break-up, open. Never progressive: the whole break-up is
  // behind one disclosure, and no part of it is revealed later.
  await go(page, `/laptops/${SKU}?pin=110001&grade=A`);
  await page.getByText('Price break-up').first().click();
  await page.waitForTimeout(400);
  await shot(page, `T12-breakup-open-${theme}`);
  await page
    .locator('.obrd table tbody tr')
    .first()
    .screenshot({ path: `${OUT}/T12-breakup-row-${theme}.png` });
  console.log('captured', `T12-breakup-row-${theme}`);

  // 6 — the MARGIN pool, with its ITC label. A separate grid from the REGULAR
  // rows because the credit differs and the rupees are not comparable.
  await page
    .locator('[data-pool="MARGIN"]')
    .screenshot({ path: `${OUT}/T12-margin-pool-${theme}.png` });
  console.log('captured', `T12-margin-pool-${theme}`);

  // 7 — the "New supplier" row. Palwal has three inspected units, below the
  // threshold of ten, so it shows the count instead of a percentage.
  await page
    .locator('.obrd table tbody tr', { hasText: 'Supply Point B · Palwal' })
    .screenshot({ path: `${OUT}/T12-new-supplier-row-${theme}.png` });
  console.log('captured', `T12-new-supplier-row-${theme}`);

  // 8 — the two supply points both labelled F, in one shot: one Noida, one
  // Faridabad, different prices, different scores, different stock.
  await page
    .locator('.obrd table')
    .first()
    .screenshot({ path: `${OUT}/T12-two-F-supply-points-${theme}.png` });
  console.log('captured', `T12-two-F-supply-points-${theme}`);

  // 9 — the serial list for Supply Point J · Noida, which holds two units with
  // no battery reading. They read "Not measured", never 0%.
  await go(page, `/laptops/${SKU}?pin=110001&grade=A&sp=J&city=Noida`);
  await capture(page, `T12-units-J-noida-${theme}`, [600]);
  await page
    .locator('.lview')
    .screenshot({ path: `${OUT}/T12-battery-not-measured-${theme}.png` });
  console.log('captured', `T12-battery-not-measured-${theme}`);

  // 10 — the other F. Same letter, different city, different machines.
  await go(page, `/laptops/${SKU}?pin=110001&grade=A&sp=F&city=Faridabad`);
  await capture(page, `T12-units-F-faridabad-${theme}`, []);

  // 11 — the grade selector, clicked rather than typed, so the shot proves the
  // control writes the URL and not just that the URL reads.
  await go(page, `/laptops/${SKU}?pin=110001&grade=A`);
  // Scoped to the grade selector: the category strip at the top of every page
  // has its own "Grade A+" link into `/search`, and an unscoped role query
  // matches both.
  const selector = page.locator('.gsel').first();
  await selector.getByRole('link', { name: /^Grade B/ }).click();
  await page.waitForURL(/grade=B/);
  await page.waitForTimeout(700);
  await capture(page, `T12-grade-B-${theme}`, []);
  await page.locator('.gsel').first().getByRole('link', { name: /^Grade A\+/ }).click();
  await page.waitForURL(/grade=A_PLUS/);
  await page.waitForTimeout(700);
  await capture(page, `T12-grade-A-plus-${theme}`, []);

  // 12 — an empty board: a machine catalogued at one grade only, asked for a
  // grade nobody holds.
  await go(page, `/laptops/${SKU_ONE_GRADE}?pin=110001&grade=B`);
  await capture(page, `T12-empty-grade-${theme}`, []);

  // 13 — loading. `loading.tsx` is streamed as the first chunk of the document
  // and replaced by the content as the second, so on a fast localhost it is on
  // screen for a few milliseconds. The connection is throttled to 60 kB/s —
  // roughly a bad 3G — and the shot is taken while the skeleton is genuinely
  // the page. Nothing is stubbed: this is what a buyer on a slow connection
  // sees, which is who the state exists for.
  //
  // Delaying the RSC fetch instead (the T11 technique) does not work here: the
  // grade chips change search params inside the SAME route segment, so the
  // router re-renders without re-mounting the Suspense boundary and the old
  // board stays on screen rather than the skeleton.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 200,
    downloadThroughput: 60 * 1024,
    uploadThroughput: 60 * 1024,
  });
  page.goto(`${SHOP}/laptops/${SKU}?pin=110001&grade=B`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, `T12-loading-${theme}`);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.waitForTimeout(2000);
}

/**
 * A certificate inside the 14-day warning window.
 *
 * The seeded units all expire on 22 Nov 2026, which is 87 days out, so the flag
 * this screen is required to raise is unreachable without moving one. The unit
 * is a real one at Supply Point J · Noida; the column is the real column, the
 * endpoint recomputes the day count against the clock, and the value is put back
 * afterwards whatever happens.
 */
async function expiringSoon(page, theme) {
  await go(page, `/laptops/${SKU}?pin=110001&grade=A&sp=J&city=Noida`);
  await capture(page, `T12-expiring-soon-${theme}`, [600]);
  await page
    .locator('.obrd table tbody tr', { hasText: 'Supply Point J · Noida' })
    .screenshot({ path: `${OUT}/T12-expiring-soon-row-${theme}.png` });
  console.log('captured', `T12-expiring-soon-row-${theme}`);
}

async function errorState(page, theme) {
  await go(page, `/laptops/${SKU}?pin=110001&grade=A`);
  await capture(page, `T12-error-${theme}`, [600]);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitFor(`${API}/health`, true);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      const { context, page } = await open(browser, theme);
      await states(page, theme);
      await context.close();
    }

    // --- the expiring certificate, both themes, then put back ---------------
    console.log(
      sql(
        `UPDATE listing.unit SET qc_valid_until = (now() + interval '10 days')::date
           WHERE serial_number = 'TGD0D88DB7A'`,
      ),
    );
    try {
      for (const theme of ['dark', 'light']) {
        const { context, page } = await open(browser, theme);
        await expiringSoon(page, theme);
        await context.close();
      }
    } finally {
      console.log(
        sql(
          `UPDATE listing.unit SET qc_valid_until = DATE '2026-11-22'
             WHERE serial_number = 'TGD0D88DB7A'`,
        ),
      );
    }

    // --- the error state ----------------------------------------------------
    console.log(stopApi());
    await waitFor(`${API}/health`, false);
    try {
      for (const theme of ['dark', 'light']) {
        const { context, page } = await open(browser, theme);
        await errorState(page, theme);
        await context.close();
      }
    } finally {
      startApi();
      await waitFor(`${API}/health`, true);
    }
  } finally {
    await browser.close();
  }
}

await main();
