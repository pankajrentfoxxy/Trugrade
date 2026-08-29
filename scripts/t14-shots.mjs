/**
 * T14 review captures: `/qc/verify/[code]`, every state, both themes.
 *
 * **600 first, then 900, then 1440.** That order is not cosmetic: this is the
 * one screen in the product whose primary viewport is a phone held next to an
 * open laptop, and the widths are captured in the order the design was written
 * in so a reviewer sees the real target before the adaptation.
 *
 * Nothing is stubbed. Every screen below is the real route reading
 * `GET /api/qc/verify/:code` against the real seeded database.
 *
 * Three states need the environment moved rather than a URL:
 *
 * **Loading** is photographed inside the real streaming window. The route is
 * `force-dynamic` with a `loading.tsx`, so Next flushes the shell before the
 * server's read returns, and the capture happens between the two.
 *
 * **Rate limited** is reached by spending the miss bucket — ten misses in an
 * hour is the real budget and a for-loop is what it exists to stop.
 *
 * **Error** is reached by stopping the API, so the page renders its own panel
 * because `getVerification` could not reach it at all. The API is started again
 * afterwards.
 *
 * And the thing that cost T13 an hour and is stated here so it does not cost
 * another: **clear the passport rate-limit buckets between states**, by pattern,
 * because `req.ip` from the Next server is a loopback address whose exact form
 * depends on how the stack resolved localhost.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/** Twelve areas measured, detected hardware, a seal, six photographs. */
const VERIFIED = 'DMZENSTV2J78V3';
/** `valid_until` is genuinely in the past on this seeded row. Nothing is moved. */
const EXPIRED = 'RE5CPW10CG7CTB';
/** The one unit in the seed whose seal is BROKEN. */
const BROKEN_SEAL = 'HV21S6Q72045KZ';
/** The right shape, and a code we have never issued. Costs one miss. */
const UNKNOWN = '00000000000000';
/** Refused by `verificationCodeSchema` before any lookup — costs no miss. */
const MALFORMED = 'NOTACODE1234';

const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();

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

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, ...opts });
  console.log('captured', name);
}

/** 600 is the design viewport, so it is the unsuffixed shot. */
async function capture(page, name, widths = [900, 1440]) {
  await page.setViewportSize({ width: 600, height: 1400 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 600, height: 1400 });
  await page.waitForTimeout(250);
}

async function open(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 600, height: 1400 } });
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
  // 1 — the whole answer. PASS, the seal code, the readings, six photographs.
  await go(page, `/qc/verify/${VERIFIED}`);
  await capture(page, `T14-verified-${theme}`);
  await page.locator('[data-testid="verdict"]').screenshot({
    path: `${OUT}/T14-verdict-${theme}.png`,
  });
  console.log('captured', `T14-verdict-${theme}`);
  await page.locator('.vseal').screenshot({ path: `${OUT}/T14-seal-${theme}.png` });
  console.log('captured', `T14-seal-${theme}`);
  await page.locator('.vshare').screenshot({ path: `${OUT}/T14-qr-${theme}.png` });
  console.log('captured', `T14-qr-${theme}`);

  // 1b — the zoom. A viewport shot, not fullPage: a `<dialog>` lives in the top
  // layer and a full-page capture stitches the scrolled document underneath it.
  await page.locator('.vshot').first().click();
  await page.waitForTimeout(500);
  await shot(page, `T14-zoom-fit-${theme}`, { fullPage: false });
  await page.locator('.vzoombody img').click();
  await page.waitForTimeout(400);
  await shot(page, `T14-zoom-1to1-${theme}`, { fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // 2 — signed out. A brand new context with no cookies and no storage at all,
  // which is the state this page must work in: nobody scanning a QR on a
  // delivery note has an account.
  const anon = await page.context().browser().newContext({ viewport: { width: 600, height: 1400 } });
  await anon.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const anonPage = await anon.newPage();
  clearLimits();
  await anonPage.goto(`${SHOP}/qc/verify/${VERIFIED}`, { waitUntil: 'networkidle' });
  console.log(
    `  signed out: cookies=${(await anon.cookies()).length}`,
    `document.cookie="${await anonPage.evaluate(() => document.cookie)}"`,
  );
  await shot(anonPage, `T14-signed-out-${theme}`);
  await anon.close();

  // 3 — real, and out of date. Not a failure and not painted as one.
  await go(page, `/qc/verify/${EXPIRED}`);
  await capture(page, `T14-expired-${theme}`);
  await page.locator('[data-testid="verdict"]').screenshot({
    path: `${OUT}/T14-expired-verdict-${theme}.png`,
  });
  console.log('captured', `T14-expired-verdict-${theme}`);

  // 4 — the seal broken. The one thing on this screen that stops a signature.
  await go(page, `/qc/verify/${BROKEN_SEAL}`);
  await capture(page, `T14-seal-broken-${theme}`, []);
  await page.locator('.vseal').screenshot({ path: `${OUT}/T14-seal-broken-panel-${theme}.png` });
  console.log('captured', `T14-seal-broken-panel-${theme}`);
  // The band that outranks the PASS above it.
  await page.locator('[data-testid="verdict"]').screenshot({
    path: `${OUT}/T14-seal-broken-verdict-${theme}.png`,
  });
  console.log('captured', `T14-seal-broken-verdict-${theme}`);

  // 5 — a code we have not issued. Costs one miss out of ten per hour, which is
  // why the bucket is cleared before each width rather than after the state.
  await go(page, `/qc/verify/${UNKNOWN}`);
  await capture(page, `T14-unknown-${theme}`);

  // 6 — not the shape of a code at all. Refused by the schema, so no miss.
  await go(page, `/qc/verify/${MALFORMED}`);
  await capture(page, `T14-malformed-${theme}`);

  // 7 — the miss bucket spent, and the server's own remaining seconds ticking.
  for (let i = 0; i < 12; i += 1) {
    await fetch(`${API}/api/qc/verify/0000000000000${i % 10}`).catch(() => {});
  }
  await page.goto(`${SHOP}/qc/verify/${UNKNOWN}`, { waitUntil: 'networkidle' });
  await capture(page, `T14-rate-limited-${theme}`);
  // The countdown a second later, to show it is a real clock and not a label.
  await page.waitForTimeout(2200);
  await page.locator('[data-testid="rate-limit-notice"]').screenshot({
    path: `${OUT}/T14-rate-limited-tick-${theme}.png`,
  });
  console.log('captured', `T14-rate-limited-tick-${theme}`);
  clearLimits();

  // 8 — loading. `loading.tsx` inside the real streaming window: the shell is
  // flushed before the server's read returns, and the shot is taken between the
  // two. `waitUntil: 'commit'` is what makes that reachable.
  clearLimits();
  {
    const nav = page.goto(`${SHOP}/qc/verify/${VERIFIED}`, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(220);
    await shot(page, `T14-loading-${theme}`);
    await nav;
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  // 9 — the API unreachable. Not a 404: the certificate exists and we could not
  // reach our own record of it, and the page says which of those two it is.
  stopApi();
  await waitFor(`${API}/health`, false);
  await page.goto(`${SHOP}/qc/verify/${VERIFIED}`, { waitUntil: 'networkidle' });
  await capture(page, `T14-error-${theme}`);
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
