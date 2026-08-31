/**
 * T42–T45 console audit harness. Measures rather than judges.
 *
 * One navigation per route per theme; the viewport is then resized in place and
 * re-measured, because a navigation is the expensive part and a resize is not.
 *
 * WHAT IT MEASURES
 *   T44  document.scrollWidth against innerWidth at 1440 / 900 / 600, AFTER
 *        scrolling the document right — a page that scrolls sideways under a
 *        fixed-width header does not always report it before it is scrolled.
 *        Every element whose right edge is past the viewport is named.
 *   T42  the applied `data-t`, and the computed background of the header and the
 *        footer in BOTH themes — they must not flip.
 *   T45  axe-core (injected from a local copy, no dependency added), both themes.
 *
 * ONE LOGIN PER ACCOUNT. `login-ip` allows 20 in 15 minutes and is NOT reset on
 * success, so the run switches theme in place inside a signed-in context rather
 * than opening a context per theme. Nine accounts, nine logins.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const PASSWORD = 'Trugrade!Demo2026';
const AXE = readFileSync(process.env.AXE_PATH, 'utf8');
const OUT = process.env.AUDIT_OUT ?? 'audit.json';
const WIDTHS = [1440, 900, 600];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

/** Board → the href prefix whose first match is a real detail route. */
const PLAN = [
  {
    email: 'catalog@trugrade.in',
    routes: ['/catalog', '/catalog/condition-images', '/catalog/sku-requests'],
    discover: [{ from: '/catalog', prefix: '/catalog/skus/' }],
  },
  {
    email: 'kyc@trugrade.in',
    routes: ['/kyc', '/platform/audit-log'],
    discover: [{ from: '/kyc', prefix: '/kyc/' }],
  },
  {
    email: 'qc@trugrade.in',
    routes: [
      '/qc/visits',
      '/qc/schedule',
      '/qc/grade-corrections',
      '/qc/audit',
      '/qc/sampling-rules',
      '/qc/tool-providers',
    ],
    discover: [
      { from: '/qc/visits', prefix: '/qc/visits/' },
      { from: '/qc/visits', prefix: '/qc/visits/', suffix: '/inspect' },
    ],
  },
  { email: 'pricing@trugrade.in', routes: ['/pricing/rules'] },
  {
    email: 'support@trugrade.in',
    routes: ['/orders'],
    discover: [{ from: '/orders', prefix: '/orders/' }],
  },
  {
    email: 'ops@trugrade.in',
    routes: ['/overview', '/procurement/pos'],
    discover: [{ from: '/procurement/pos', prefix: '/units/' }],
  },
  {
    email: 'ops@northgate.example',
    routes: [
      '/vendor',
      '/vendor/listings',
      '/vendor/listings/new',
      '/vendor/corrections',
      '/vendor/qc/visits',
      '/vendor/orders',
      '/vendor/sku-request',
    ],
    discover: [
      { from: '/vendor/listings', prefix: '/vendor/listings/' },
      { from: '/vendor/listings', prefix: '/vendor/listings/', suffix: '/reprice' },
      { from: '/vendor/listings', prefix: '/vendor/listings/', suffix: '/bulk-upload' },
      { from: '/vendor/corrections', prefix: '/vendor/corrections/' },
      { from: '/vendor/qc/visits', prefix: '/vendor/qc/visits/' },
      { from: '/vendor/orders', prefix: '/vendor/orders/' },
      { from: '/vendor/orders', prefix: '/vendor/orders/', suffix: '/pick-list' },
    ],
  },
  { email: 'finance@faridabad.example', routes: ['/vendor/payables'] },
  {
    email: 'admin@trugrade.in',
    routes: ['/finance', '/platform/config', '/platform/flags'],
  },
];

async function goto(page, path) {
  for (let a = 0; a < 3; a += 1) {
    try {
      await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return;
    } catch (e) {
      if (a === 2) throw e;
      await page.waitForTimeout(1500);
    }
  }
}

async function signIn(page, email) {
  let devCode = null;
  const listener = async (r) => {
    if (!r.url().endsWith('/api/auth/mfa/otp')) return;
    const b = await r.json().catch(() => null);
    if (b?.devCode) devCode = b.devCode;
  };
  page.on('response', listener);
  await goto(page, '/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const otp = await page
    .waitForSelector('[data-testid="otp-input"]', { timeout: 10000 })
    .catch(() => null);
  if (otp) {
    for (let i = 0; i < 80 && devCode === null; i += 1) await page.waitForTimeout(200);
    if (devCode === null) throw new Error(`no dev OTP for ${email}`);
    await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
    await page.waitForTimeout(500);
    const v = page.getByRole('button', { name: /verify|continue|confirm/i }).first();
    if (await v.isVisible().catch(() => false)) await v.click();
  }
  await page.waitForSelector('nav', { timeout: 30000 });
  page.off('response', listener);
}

/** Everything T44 needs, taken after the document has been scrolled right. */
const MEASURE = () => {
  // Scroll right and back: a fixed-width header can hide the fact that the
  // DOCUMENT scrolls, and scrollWidth alone has been read before the layout
  // that produced it settled.
  window.scrollTo(document.documentElement.scrollWidth, 0);
  const scrolledTo = window.scrollX;
  window.scrollTo(0, 0);
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const over = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    // Only the outermost offender in a chain is interesting; a table inside an
    // overflowing div is a symptom of the div, not a second defect.
    let p = el.parentElement;
    let nested = false;
    while (p && p !== document.body) {
      if (seen.has(p)) nested = true;
      p = p.parentElement;
    }
    seen.add(el);
    if (nested) continue;
    over.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') ?? '').slice(0, 140),
      right: Math.round(r.right),
      w: Math.round(r.width),
      overflowX: getComputedStyle(el).overflowX,
    });
  }
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: vw,
    pageScrolledBy: scrolledTo,
    bodyScrollWidth: document.body.scrollWidth,
    offenders: over.slice(0, 8),
  };
};

const CHROME = () => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  };
  return {
    dataT: document.documentElement.getAttribute('data-t'),
    density: document.querySelector('[data-density]')?.getAttribute('data-density') ?? null,
    header: g('header'),
    footer: g('footer'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
};

async function run() {
  mkdirSync('docs/review', { recursive: true });
  const probe = await fetch(`${API}/api/auth/session`);
  console.log(`api /api/auth/session -> ${probe.status} (not 404 = build is current)`);

  const results = [];
  const browser = await chromium.launch();
  for (const acct of PLAN) {
    if (ONLY && !ONLY.includes(acct.email)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await signIn(page, acct.email);
      console.log(`\n=== ${acct.email} ===`);

      const routes = [...acct.routes];
      for (const d of acct.discover ?? []) {
        await goto(page, d.from);
        await page.waitForTimeout(2500);
        const href = await page.evaluate(
          ({ prefix, from }) => {
            for (const a of document.querySelectorAll('a[href]')) {
              const h = a.getAttribute('href');
              if (h && h.startsWith(prefix) && h !== from && h.split('/').length > prefix.split('/').length - 1)
                return h;
            }
            return null;
          },
          { prefix: d.prefix, from: d.from },
        );
        if (!href) {
          console.log(`  ! no ${d.prefix}* link on ${d.from}`);
          continue;
        }
        routes.push(d.suffix ? `${href.split('?')[0]}${d.suffix}` : href);
      }

      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => localStorage.setItem('tg-theme', t), theme);
        for (const route of routes) {
          const rec = { email: acct.email, route, theme, widths: {}, axe: null, chrome: null };
          await goto(page, route);
          await page.waitForTimeout(2600);
          rec.chrome = await page.evaluate(CHROME);
          if (rec.chrome.dataT !== theme) {
            rec.themeFailed = `wanted ${theme}, got ${rec.chrome.dataT}`;
          }
          rec.title = await page
            .locator('h1')
            .first()
            .innerText()
            .catch(() => null);
          for (const w of WIDTHS) {
            await page.setViewportSize({ width: w, height: 1000 });
            await page.waitForTimeout(500);
            rec.widths[w] = await page.evaluate(MEASURE);
          }
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.waitForTimeout(300);
          await page.addScriptTag({ content: AXE });
          rec.axe = await page.evaluate(async () => {
            const r = await window.axe.run(document, {
              resultTypes: ['violations'],
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
            });
            return r.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              n: v.nodes.length,
              sample: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 160)),
            }));
          });
          results.push(rec);
          const bad = WIDTHS.filter((w) => rec.widths[w].scrollWidth > rec.widths[w].innerWidth + 1);
          console.log(
            `  ${theme} ${route}` +
              (bad.length ? `  OVERFLOW@${bad.map((w) => `${w}:${rec.widths[w].scrollWidth}`).join(',')}` : '') +
              (rec.axe.length ? `  axe:${rec.axe.map((v) => v.id).join('|')}` : '') +
              (rec.themeFailed ? `  THEME:${rec.themeFailed}` : ''),
          );
        }
      }
    } catch (e) {
      console.log(`  !! ${acct.email}: ${e.message}`);
      results.push({ email: acct.email, fatal: e.message });
    }
    if (errors.length) results.push({ email: acct.email, pageErrors: [...new Set(errors)] });
    await context.close();
  }
  await browser.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${OUT}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
