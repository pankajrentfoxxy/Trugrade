/**
 * T13 review captures: `/unit/[serial]`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed. Every screen below is the real route reading
 * `GET /api/unit/:serial` against the real seeded database — 239 current
 * reports, 2,686 area results, 1,434 photographs, 219 wipe certificates.
 *
 * Three states need the environment moved rather than a URL:
 *
 * **Loading** is photographed inside the real streaming window. The route is
 * `force-dynamic` with a `loading.tsx`, so Next flushes the shell — chrome,
 * record skeleton, both panels — before the server's read of `/api/unit/:serial`
 * returns, and the capture happens between the commit and the body arriving.
 * Nothing is stubbed and no request is held open: this is exactly what a reader
 * on a slow connection sees.
 *
 * **Error** is reached by stopping the API, so the page renders its own panel
 * because `getUnitPassport` could not reach it at all. The API is started again
 * afterwards.
 *
 * **Rate limited** is reached by spending the miss bucket — ten 404s in an hour
 * is the real budget and a for-loop is what it exists to stop.
 *
 * And one thing this script has to do that the earlier ones did not: **clear the
 * passport rate-limit buckets between states**. Eighty-odd captures against one
 * IP would otherwise spend a 60-per-5-minutes budget halfway through the run and
 * photograph the 429 instead of the page.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/** All twelve areas measured, hardware, seal, wipe, six photographs. */
const FULL = 'TGD467F6A90';
/** Four NOT_MEASURED areas beside eight measured ones. No hardware row. */
const PARTIAL = 'TGD000E733';
/** One of the roughly one-in-twelve units with no wipe certificate. */
const NO_WIPE = 'TGDC4476507';
/** One of the 48 reports with no detected-hardware row. */
const NO_HARDWARE = 'TGD002318E';
/** Never inspected, and shaped like a serial so it reaches the lookup. */
const UNKNOWN = 'TGD99999999';
/** Refused by the serial schema before any lookup happens. */
const MALFORMED = '0000000000';
/**
 * Genuinely past its validity in the seed — `valid_until` is the inspection date
 * itself on two of the 239 reports, so it is expired today and stays expired.
 * Nothing is written to the database to reach this state, which matters: a
 * capture script that moves a column and puts it back is one crash away from
 * leaving the dev data wrong.
 */
const EXPIRED = 'TGD90EA172A';

const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();

/**
 * Both buckets, for every subject.
 *
 * `req.ip` from the Next server is a loopback address whose exact form depends
 * on how the stack resolved localhost, so the pattern is deleted rather than one
 * guessed key — a script that clears `rl:qc-passport:::1` and misses
 * `::ffff:127.0.0.1` fails silently and photographs a 429.
 */
const clearLimits = () =>
  execFileSync(
    'docker',
    [
      'exec',
      'trugrade-redis',
      'sh',
      '-c',
      "redis-cli --scan --pattern 'rl:qc-passport*' | xargs -r redis-cli del",
    ],
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
  clearLimits();
  await page.goto(`${SHOP}${path}`, { waitUntil: 'networkidle' });
};

/* ------------------------------------------------------------------ the run */

async function states(page, theme) {
  // 1 — the whole passport. Twelve measured areas, detected hardware, a seal
  // with its barcode, a wipe certificate and six photographs.
  await go(page, `/unit/${FULL}`);
  await capture(page, `T13-passport-${theme}`);

  // 2 — the unmeasured areas beside the measured ones, which is the single
  // thing this screen exists not to get wrong.
  await go(page, `/unit/${PARTIAL}`);
  await capture(page, `T13-not-measured-${theme}`);
  // The section on its own: four unmeasured areas listed among eight measured
  // ones, with no score, no bar and no tick against any of the four.
  await page.locator('#areas').screenshot({ path: `${OUT}/T13-areas-${theme}.png` });
  console.log('captured', `T13-areas-${theme}`);

  // 3 — no wipe certificate. Roughly one unit in twelve, deliberately.
  //
  // Captured from the top of the page, not scrolled to the panel: the side
  // panel is `position: sticky`, and a full-page screenshot taken while the
  // window is scrolled renders it halfway down the record. That is a capture
  // artefact rather than a layout, and a reviewer cannot tell the two apart.
  // The panel itself gets its own element shot below.
  await go(page, `/unit/${NO_WIPE}`);
  await capture(page, `T13-no-wipe-${theme}`);
  await page.locator('#wipe').screenshot({ path: `${OUT}/T13-wipe-absent-${theme}.png` });
  console.log('captured', `T13-wipe-absent-${theme}`);

  // 4 — no detected-hardware row. 48 of the 239 reports.
  await go(page, `/unit/${NO_HARDWARE}`);
  await capture(page, `T13-no-hardware-${theme}`);
  await page.locator('#hardware').screenshot({ path: `${OUT}/T13-hardware-absent-${theme}.png` });
  console.log('captured', `T13-hardware-absent-${theme}`);

  // 5 — the photographs, framed and each carrying the real serial.
  await go(page, `/unit/${FULL}`);
  await page.locator('#photos').screenshot({ path: `${OUT}/T13-photographs-${theme}.png` });
  console.log('captured', `T13-photographs-${theme}`);

  // 6 — the seal record, with the strip beside the code it encodes.
  await page.locator('#seal').screenshot({ path: `${OUT}/T13-seal-${theme}.png` });
  console.log('captured', `T13-seal-${theme}`);

  // 6b — the one amber control on the page, and where it goes. The link is
  // followed from inside the browser so what is recorded is the response the
  // reader's own click produces, not a curl from a shell with different headers.
  await page.locator('[data-testid="record-header"]').screenshot({
    path: `${OUT}/T13-report-link-${theme}.png`,
  });
  console.log('captured', `T13-report-link-${theme}`);
  const pdf = await page.evaluate(async (s) => {
    const r = await fetch(`/api/unit/${s}/report.pdf`);
    const b = await r.blob();
    return { status: r.status, type: r.headers.get('content-type'), bytes: b.size };
  }, FULL);
  console.log(`  printed report: ${pdf.status} ${pdf.type} ${pdf.bytes} bytes`);

  // 7 — signed out. A brand new context with no cookies and no storage at all,
  // which is the state this page must work in: it is the r.7(2) defence and a
  // defence behind a login is not one.
  const anon = await page.context().browser().newContext({ viewport: { width: 1440, height: 1600 } });
  await anon.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const anonPage = await anon.newPage();
  clearLimits();
  await anonPage.goto(`${SHOP}/unit/${FULL}`, { waitUntil: 'networkidle' });
  console.log(
    `  signed out: cookies=${(await anon.cookies()).length}`,
    `session=${await anonPage.evaluate(() => document.cookie)}`.trim(),
  );
  await shot(anonPage, `T13-signed-out-${theme}`);
  await anon.close();

  // 8 — a serial we hold no inspection for.
  await go(page, `/unit/${UNKNOWN}`);
  await capture(page, `T13-unknown-serial-${theme}`);

  // 9 — something that is not a serial at all. The API's own sentence.
  await go(page, `/unit/${MALFORMED}`);
  await capture(page, `T13-malformed-serial-${theme}`);

  // 10 — the miss bucket spent. Ten 404s in an hour is the real budget.
  for (let i = 0; i < 12; i += 1) {
    await fetch(`${API}/api/unit/TGD1111111${i % 10}`).catch(() => {});
  }
  await page.goto(`${SHOP}/unit/${UNKNOWN}`, { waitUntil: 'networkidle' });
  await capture(page, `T13-rate-limited-${theme}`);
  clearLimits();

  // 11 — an inspection past its validity. A seeded row, not a moved one.
  await go(page, `/unit/${EXPIRED}`);
  await capture(page, `T13-expired-${theme}`);

  // 12 — loading. `loading.tsx` inside the real streaming window: the shell is
  // flushed before the server's passport read returns, and the shot is taken
  // between the two. `waitUntil: 'commit'` is what makes that reachable — a
  // `networkidle` goto has already replaced it by the time it resolves.
  clearLimits();
  {
    const nav = page.goto(`${SHOP}/unit/${FULL}`, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(250);
    await shot(page, `T13-loading-${theme}`);
    await nav;
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  // 13 — the API stopped. Not a 404: the machine exists and we could not reach
  // our own record of it, and the page says which of those two it is.
  stopApi();
  await waitFor(`${API}/health`, false);
  await page.goto(`${SHOP}/unit/${FULL}`, { waitUntil: 'networkidle' });
  await capture(page, `T13-error-${theme}`);
  startApi();
  await waitFor(`${API}/health`, true);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    const { context, page } = await open(browser, theme);
    await states(page, theme);
    await context.close();
  }
  await browser.close();
  clearLimits();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
