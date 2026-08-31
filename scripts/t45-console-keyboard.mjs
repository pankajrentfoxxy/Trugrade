/**
 * T45, the half axe cannot answer: the command palette and keyboard traversal.
 *
 * One account, one login. Everything is measured in the page rather than judged
 * from a screenshot — "is the active option visible" is a rectangle comparison,
 * not an opinion.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const CONSOLE = 'http://localhost:5173';
const PASSWORD = 'Trugrade!Demo2026';
const EMAIL = process.env.EMAIL ?? 'ops@trugrade.in';
const ROUTE = process.env.ROUTE ?? '/orders';
const AXE = readFileSync(process.env.AXE_PATH, 'utf8');
const OUT = process.env.AUDIT_OUT ?? 'keyboard.json';

const active = () =>
  ({
    tag: document.activeElement?.tagName.toLowerCase() ?? null,
    id: document.activeElement?.id || null,
    text: (document.activeElement?.textContent ?? '').trim().slice(0, 40),
    role: document.activeElement?.getAttribute('role') ?? null,
    outline: document.activeElement ? getComputedStyle(document.activeElement).outlineWidth : null,
  });

async function main() {
  const out = {};
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: Number(process.env.VH ?? 900) } });
  const page = await context.newPage();

  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 });

  await page.goto(`${CONSOLE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // ---- 1. the skip link is the first tab stop and is visible when focused ----
  await page.keyboard.press('Tab');
  out.firstTabStop = await page.evaluate(active);
  out.skipLinkVisible = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
  });

  // ---- 2. focus order and focus visibility over the first 30 stops ----
  const order = [];
  for (let i = 0; i < 30; i += 1) {
    order.push(await page.evaluate(active));
    await page.keyboard.press('Tab');
  }
  out.focusOrder = order;
  out.noOutline = order.filter((o) => o.outline === '0px' || o.outline === null);

  // ---- 3. the command palette ----
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  out.paletteOpen = await page.evaluate(() => ({
    dialogOpen: document.querySelector('dialog')?.open ?? null,
    focused: document.activeElement?.id ?? null,
    activedescendant: document
      .querySelector('#tg-palette-input')
      ?.getAttribute('aria-activedescendant'),
    expanded: document.querySelector('#tg-palette-input')?.getAttribute('aria-expanded'),
  }));

  await page.addScriptTag({ content: AXE });
  out.paletteAxe = await page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector('dialog'), {
      resultTypes: ['violations'],
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      sample: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 180)),
    }));
  });

  // ---- 4. does the active option stay inside the scrolling list? ----
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  out.activeOptionVisible = await page.evaluate(() => {
    const input = document.querySelector('#tg-palette-input');
    const id = input?.getAttribute('aria-activedescendant');
    const opt = id ? document.getElementById(id) : null;
    const list = document.querySelector('#tg-palette-list');
    if (!opt || !list) return { id, found: false };
    const o = opt.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return {
      id,
      found: true,
      optionTop: Math.round(o.top),
      optionBottom: Math.round(o.bottom),
      listTop: Math.round(l.top),
      listBottom: Math.round(l.bottom),
      listScrollTop: list.scrollTop,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      insideView: o.top >= l.top - 1 && o.bottom <= l.bottom + 1,
    };
  });

  // ---- 4b. the same, on a list long enough to actually scroll ----
  await page.fill('#tg-palette-input', process.env.QUERY ?? 'TT');
  await page.waitForTimeout(2500);
  out.longList = { rows: await page.locator('#tg-palette-list li[role="option"]').count() };
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
  }
  out.longList.after = await page.evaluate(() => {
    const id = document.querySelector('#tg-palette-input')?.getAttribute('aria-activedescendant');
    const opt = id ? document.getElementById(id) : null;
    const list = document.querySelector('#tg-palette-list');
    if (!opt || !list) return { id, found: false };
    const o = opt.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return {
      id,
      scrolls: list.scrollHeight > list.clientHeight,
      listScrollTop: list.scrollTop,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      insideView: o.top >= l.top - 1 && o.bottom <= l.bottom + 1,
    };
  });
  console.log('longList', JSON.stringify(out.longList));

  // ---- 5. Escape closes and returns focus to the invoker ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  out.afterEscape = await page.evaluate(() => ({
    dialogOpen: document.querySelector('dialog')?.open ?? null,
    focusedTag: document.activeElement?.tagName.toLowerCase() ?? null,
    focusedText: (document.activeElement?.textContent ?? '').trim().slice(0, 40),
  }));

  // ---- 6. the horizontal scroll wrapper on a narrow viewport ----
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForTimeout(800);
  out.scrollWrappers = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.overflow-x-auto')) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      out.push({
        cls: el.getAttribute('class')?.slice(0, 80),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        tabindex: el.getAttribute('tabindex'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
      });
    }
    return out;
  });

  // ---- 7. the two T44 fixes, re-measured, and the refusal photographed ----
  const remeasure = process.env.REMEASURE ? process.env.REMEASURE.split(',') : [];
  out.remeasured = [];
  for (const route of [...remeasure, '/platform/config']) {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${CONSOLE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const rec = { route, widths: {} };
    rec.h1 = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => null);
    // Does the chrome exist? A refusal used to render with neither.
    rec.chrome = await page.evaluate(() => ({
      header: !!document.querySelector('header'),
      footer: !!document.querySelector('footer'),
      rail: !!document.querySelector('#section-rail'),
      skipLink: !!document.querySelector('a[href="#main"]'),
    }));
    for (const w of [1440, 900, 600]) {
      await page.setViewportSize({ width: w, height: 1200 });
      await page.waitForTimeout(500);
      rec.widths[w] = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
    }
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `docs/review/T43-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`,
      fullPage: true,
    });
    out.remeasured.push(rec);
    console.log(route, JSON.stringify(rec));
  }

  await browser.close();
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
