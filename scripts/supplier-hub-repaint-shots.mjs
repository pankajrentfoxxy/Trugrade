/**
 * Stage 10 — the supplier hub repaint.
 *
 * Captures every vendor route at 1900 / 1440 / 600 into
 * docs/review/supplier-hub/1b-*.png, and asserts the five things the repaint
 * claims, because a screenshot of a wrong screen still looks like a screenshot:
 *
 *   1. `data-surface` is `hub` on a /vendor route and absent on an admin one.
 *   2. A hard reload on /vendor/payables paints a white bar, with no dark frame
 *      before hydration — checked against the pre-paint DOM, not the settled one.
 *   3. No serif renders anywhere on the vendor surface.
 *   4. Nothing that draws a box draws it with a square corner.
 *   5. At 1900 the right gutter is under 40px.
 *
 * Two sign-ins: the vendor owner for the surface, a platform admin for the
 * negative case. Both clear a real second factor.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'docs/review/supplier-hub';
const CONSOLE = 'http://localhost:5173';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const VENDOR = 'owner@northgate.example';
const ADMIN = 'admin@trugrade.in';

const ROUTES = [
  ['home', '/vendor'],
  ['listings', '/vendor/listings'],
  ['listing-new', '/vendor/listings/new'],
  ['sku-request', '/vendor/sku-request'],
  ['visits', '/vendor/qc/visits'],
  ['corrections', '/vendor/corrections'],
  ['orders', '/vendor/orders'],
  ['dispatch', '/vendor/dispatch'],
  ['payables', '/vendor/payables'],
  ['payouts', '/vendor/payouts'],
  ['team', '/vendor/team'],
  ['facilities', '/vendor/facilities'],
  ['documents', '/vendor/documents'],
  ['profile', '/vendor/profile'],
];

const failures = [];
function check(ok, message) {
  if (ok) console.log(`  ok   ${message}`);
  else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

async function signIn(page, email) {
  let devCode = null;
  const listener = async (response) => {
    if (!response.url().endsWith('/api/auth/mfa/otp')) return;
    const body = await response.json().catch(() => null);
    if (body?.devCode) devCode = body.devCode;
  };
  page.on('response', listener);

  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 10000 })
    .catch(() => null);
  if (!form) {
    page.off('response', listener);
    return;
  }
  // By name, not by label: the show/hide toggle also carries a "Password" label.
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const challenge = await page
    .waitForSelector('text=One more code before you are in', { timeout: 10000 })
    .catch(() => null);
  if (challenge) {
    for (let i = 0; i < 50 && devCode === null; i += 1) await page.waitForTimeout(200);
    if (devCode === null) throw new Error(`no dev OTP came back for ${email}`);
    await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
    await page.waitForTimeout(2500);
  }
  page.off('response', listener);

  // Sitting on /login means the sign-in was refused. Surfacing the reason beats
  // watching every later check fail with a misleading "data-surface is null" —
  // a lockout from repeated runs reads exactly like a broken surface otherwise.
  if (new URL(page.url()).pathname.startsWith('/login')) {
    const reason = await page
      .locator('[role="alert"], .text-fail')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`sign-in refused for ${email}: ${reason?.trim() ?? 'no message on screen'}`);
  }
}

/** Every font actually used on the page, resolved through getComputedStyle. */
const fontsInUse = () =>
  [...new Set([...document.querySelectorAll('body *')].map((el) => getComputedStyle(el).fontFamily))];

/** Anything that draws a box — border or filled background — with a 0 radius. */
const squareBoxes = () => {
  /** A row inside a rounded, clipping panel already has the panel's corners. */
  const clippedByRoundedAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflow !== 'visible' && parseFloat(s.borderTopLeftRadius) > 0) return true;
    }
    return false;
  };

  return [...document.querySelectorAll('.vendor-hub *')]
    .filter((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 12) return false;
      const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      const bordered = parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0;
      if (!filled && !bordered) return false;
      // A band running off the edge of the viewport has no visible corner to
      // round — the masthead and footer span the width, the rail hangs from the
      // masthead down past the fold.
      if (r.width >= window.innerWidth - 1) return false;
      if (r.left <= 1 && r.bottom >= window.innerHeight - 1) return false;
      if (clippedByRoundedAncestor(el)) return false;
      return ['borderTopLeftRadius', 'borderTopRightRadius'].every((k) => parseFloat(s[k]) === 0);
    })
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 90))
    .slice(0, 10);
};

/**
 * The no-flash guarantee has to be read off the shipped artefact, not the dev
 * server: Vite dev injects CSS through JS, so there is no stylesheet to order
 * the pre-paint script against. Run `pnpm --filter @trugrade/console build`
 * first.
 */
async function checkBuiltHead() {
  const html = await readFile('apps/console/dist/index.html', 'utf8').catch(() => null);
  if (html === null) {
    check(false, 'apps/console/dist/index.html exists — build the console before this runs');
    return;
  }
  const script = html.indexOf("setAttribute('data-surface','hub')");
  const appCss = html.search(/<link rel="stylesheet"[^>]*href="\/assets\//);
  check(script !== -1, 'the built head sets data-surface to hub');
  check(
    script !== -1 && appCss !== -1 && script < appCss,
    'the pre-paint script runs before the app stylesheet, so nothing flashes',
  );
  const fonts = html.match(/fonts\.googleapis\.com\/css2\?[^"]+/)?.[0] ?? '';
  const dropped = ['Newsreader', 'Public+Sans', 'JetBrains'].filter((f) => fonts.includes(f));
  check(dropped.length === 0, `no serif or spare font family is requested (found ${dropped})`);
}

async function run() {
  await mkdir(OUT, { recursive: true });
  await checkBuiltHead();
  const browser = await chromium.launch();

  // ---- the negative case: admin must carry no surface attribute ------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await signIn(admin, ADMIN);
  await admin.goto(`${CONSOLE}/overview`, { waitUntil: 'domcontentloaded' });
  await admin.waitForTimeout(1200);
  const adminSurface = await admin.evaluate(() =>
    document.documentElement.getAttribute('data-surface'),
  );
  check(adminSurface === null, `admin /overview data-surface is null (got ${adminSurface})`);
  await adminCtx.close();

  // ---- the vendor surface --------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, VENDOR);

  // Pre-paint. The attribute is read at commit, before React hydrates. The
  // colour cannot be — no stylesheet has parsed yet — so the no-flash guarantee
  // is structural instead: the script that sets the attribute must sit ahead of
  // every stylesheet in <head>, which is what makes the first paint white.
  await page.goto(`${CONSOLE}/vendor/payables`, { waitUntil: 'commit' });
  const surfaceAtCommit = await page.evaluate(() =>
    document.documentElement.getAttribute('data-surface'),
  );
  check(surfaceAtCommit === 'hub', `data-surface is hub at commit (got ${surfaceAtCommit})`);

  await page.waitForSelector('.hub-mast', { timeout: 30000 });
  const chrome = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim(),
  );
  check(chrome === '#ffffff', `--chrome is white, so the masthead is never dark (got "${chrome}")`);

  await page.goto(`${CONSOLE}/vendor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hub-mast', { timeout: 20000 });
  await page.waitForTimeout(1200);

  const surface = await page.evaluate(() => document.documentElement.getAttribute('data-surface'));
  check(surface === 'hub', `/vendor data-surface is hub (got ${surface})`);

  const fonts = await page.evaluate(fontsInUse);
  const serif = fonts.filter((f) => /Newsreader|Georgia|Times|(^|[^-])\bserif\b/i.test(f));
  check(serif.length === 0, `no serif on the vendor surface (found ${JSON.stringify(serif)})`);

  const squares = await page.evaluate(squareBoxes);
  check(squares.length === 0, `no square-cornered box (found ${JSON.stringify(squares)})`);

  const gutter = await page.evaluate(() => {
    const main = document.querySelector('.hub-main');
    return Math.round(window.innerWidth - main.getBoundingClientRect().right);
  });
  check(gutter < 40, `right gutter at 1900 is under 40px (got ${gutter}px)`);

  // ---- captures ------------------------------------------------------------
  for (const [width, suffix] of [
    [1900, '1900'],
    [1440, '1440'],
    [600, '600'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path] of ROUTES) {
      const file = `${OUT}/1b-${name}-${suffix}.png`;
      let shot = null;

      // A capture is only worth keeping if the shell actually rendered. Without
      // this gate a crashed route writes a blank PNG that reviews as "fine".
      for (let attempt = 0; attempt < 3 && shot === null; attempt += 1) {
        await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
        const rendered = await page
          .waitForSelector('.hub-mast', { timeout: 15000 })
          .catch(() => null);
        if (rendered === null) continue;
        await page.waitForTimeout(1100);
        shot = await page.screenshot({ fullPage: true }).catch(() => null);
      }

      if (shot === null) {
        check(false, `captured ${name} at ${suffix} — the route never rendered`);
        continue;
      }
      await writeFile(file, shot);
      console.log('captured', `1b-${name}-${suffix}`);
    }
  }

  await ctx.close();
  await browser.close();

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
  for (const f of failures) console.log(` - ${f}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await run();
