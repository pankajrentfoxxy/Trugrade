/**
 * T42–T45, second pass: the detail routes the first pass could not discover.
 *
 * The first pass scraped hrefs off a board, which found `/vendor/listings/new`
 * before it found a listing id and measured three routes that do not exist. This
 * one asks the API for the ids instead, inside the signed-in page so the cookie
 * is the browser's own. Two logins.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const CONSOLE = 'http://localhost:5173';
const PASSWORD = 'Trugrade!Demo2026';
const AXE = readFileSync(process.env.AXE_PATH, 'utf8');
const OUT = process.env.AUDIT_OUT ?? 'pass2.json';
const WIDTHS = [1440, 900, 600];

const MEASURE = () => {
  window.scrollTo(document.documentElement.scrollWidth, 0);
  const scrolledTo = window.scrollX;
  window.scrollTo(0, 0);
  const vw = window.innerWidth;
  const over = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
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
      cls: (el.getAttribute('class') ?? '').slice(0, 160),
      right: Math.round(r.right),
      w: Math.round(r.width),
      overflowX: getComputedStyle(el).overflowX,
    });
  }
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: vw,
    pageScrolledBy: scrolledTo,
    offenders: over.slice(0, 8),
  };
};

async function signIn(page, email) {
  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 });
}

const get = (page, url) =>
  page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    return r.ok ? r.json() : { __status: r.status };
  }, url);

async function sweep(page, routes, results, label) {
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => localStorage.setItem('tg-theme', t), theme);
    for (const route of routes) {
      const rec = { label, route, theme, widths: {} };
      await page.goto(`${CONSOLE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      rec.dataT = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
      rec.h1 = await page
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
          sample: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 180)),
        }));
      });
      results.push(rec);
      const bad = WIDTHS.filter((w) => rec.widths[w].scrollWidth > rec.widths[w].innerWidth + 1);
      console.log(
        `  ${theme} ${route} [${rec.h1?.slice(0, 40)}]` +
          (bad.length
            ? `  OVERFLOW@${bad.map((w) => `${w}:${rec.widths[w].scrollWidth}`).join(',')}`
            : '') +
          (rec.axe.length ? `  axe:${rec.axe.map((v) => v.id).join('|')}` : ''),
      );
    }
  }
}

async function main() {
  const results = [];
  const browser = await chromium.launch();

  // ---- vendor ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await signIn(page, process.env.VENDOR ?? 'ops@northgate.example');
    const listings = await get(page, '/api/vendor/listings');
    const pos = await get(page, '/api/vendor/purchase-orders');
    const visits = await get(page, '/api/vendor/qc/visits');
    const corrections = await get(page, '/api/vendor/grade-corrections');
    const lid = (listings.rows ?? listings.listings ?? listings)?.[0]?.id;
    const po = (pos.rows ?? pos)?.[0];
    const vid = (visits.rows ?? visits)?.[0]?.id;
    const cid = (corrections.rows ?? corrections)?.[0]?.id;
    console.log({ lid, po: po?.poId, vid, cid, listingKeys: Object.keys(listings).slice(0, 6) });
    const routes = [];
    if (lid)
      routes.push(
        `/vendor/listings/${lid}`,
        `/vendor/listings/${lid}/reprice`,
        `/vendor/listings/${lid}/bulk-upload`,
      );
    if (po?.poId) routes.push(`/vendor/orders/${po.poId}`, `/vendor/orders/${po.poId}/pick-list`);
    if (vid) routes.push(`/vendor/qc/visits/${vid}`, `/vendor/qc/visits/${vid}/results`);
    if (cid) routes.push(`/vendor/corrections/${cid}`);
    await sweep(page, routes, results, 'vendor');
    await context.close();
  }

  // ---- a serial, for the unit 360 ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await signIn(page, 'pricing@trugrade.in');
    const pos = await get(page, '/api/ops/purchase-orders');
    const first = (pos.rows ?? pos)?.[0];
    let serial = null;
    if (first?.poId) {
      const po = await get(page, `/api/ops/purchase-orders/${first.poId}`);
      serial = (po.lines ?? po.units ?? [])[0]?.serial ?? null;
    }
    if (!serial) {
      const s = await get(page, '/api/ops/search?q=TT');
      serial = s.groups?.flatMap((g) => g.hits)?.find((h) => h.href?.startsWith('/units/'))?.id;
    }
    console.log({ serial });
    const routes = ['/procurement/pos'];
    if (serial) routes.push(`/units/${encodeURIComponent(serial)}`);
    // A route this account cannot open: the refusal, now that it is inside the shell.
    routes.push('/platform/config');
    await sweep(page, routes, results, 'platform');
    await context.close();
  }

  // ---- the order record: PRICING_ADMIN has no `ordering.any.read` ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await signIn(page, 'support@trugrade.in');
    const orders = await get(page, '/api/ops/orders');
    const on = (orders.rows ?? orders)?.[0]?.orderNumber;
    console.log({ orderNumber: on });
    if (on) await sweep(page, [`/orders/${on}`], results, 'orders');
    await context.close();
  }

  await browser.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
