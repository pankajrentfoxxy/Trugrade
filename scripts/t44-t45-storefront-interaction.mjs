/**
 * T45 keyboard and form behaviour, and the T44 states a static page load cannot
 * reach — the filter sheet at 600px, an open dialog, a submitted form.
 *
 * Three things measured rather than judged:
 *   1. Tab traversal: every stop, its accessible name, and whether the browser
 *      actually paints a focus ring on it (outline width, or a box-shadow that
 *      appears only on focus). "Focus ring never removed" is a rule and this is
 *      the only way to know it holds.
 *   2. Empty submit on each long form: does an error appear, is it associated
 *      with its input via aria-describedby, and does focus move to the first
 *      bad field. An error a screen reader never announces is an error nobody
 *      can fix.
 *   3. Page width with the mobile filter sheet OPEN — defect class 3 in the
 *      ledger lived in exactly this kind of state.
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const SITE = 'http://localhost:3000';
const PASSWORD = 'Trugrade!Demo2026';
const OUT = 'docs/review/t42-t45';
const findings = [];
const rec = (o) => {
  findings.push(o);
  console.log(`${o.task} ${o.route} ${o.kind} :: ${o.detail}`);
};

const FOCUS_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const ring =
    (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') ||
    (cs.boxShadow && cs.boxShadow !== 'none');
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 60),
    cls: (el.getAttribute('class') || '').slice(0, 50),
    ring,
    outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor,
    hidden: el.getBoundingClientRect().width === 0,
  };
})()`;

async function tabThrough(page, route, limit = 70) {
  await page.evaluate(() => document.body.focus());
  const stops = [];
  const noRing = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(FOCUS_PROBE);
    if (!s) break;
    stops.push(s);
    if (!s.ring && s.tag !== 'nextjs-portal') noRing.push(s);
    if (s.hidden && s.tag !== 'nextjs-portal') {
      rec({ task: 'T45', route, kind: 'focus-on-zero-size-element', detail: `${s.tag}.${s.cls} "${s.name}"` });
    }
  }
  if (noRing.length) {
    const uniq = [...new Map(noRing.map((s) => [s.tag + s.cls, s])).values()].slice(0, 6);
    rec({
      task: 'T45',
      route,
      kind: 'no-visible-focus-ring',
      detail: `${noRing.length}/${stops.length} stops paint no ring: ` +
        uniq.map((s) => `${s.tag}.${s.cls || '-'}(${s.outline})`).join(' | '),
    });
  }
  return stops;
}

/** Submit with nothing filled in and read what the form said, and to whom. */
async function submitEmpty(page, route, buttonName) {
  await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const btn = page.getByRole('button', { name: buttonName }).first();
  if ((await btn.count()) === 0) {
    rec({ task: 'T45', route, kind: 'submit-button-not-found', detail: String(buttonName) });
    return;
  }
  await btn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const invalid = [...document.querySelectorAll('[aria-invalid="true"]')].map((e) => ({
      id: e.id,
      described: e.getAttribute('aria-describedby') || '',
      describedResolves: (e.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .every((id) => document.getElementById(id) !== null),
    }));
    const a = document.activeElement;
    return {
      alerts,
      invalid,
      focused: a ? `${a.tagName.toLowerCase()}#${a.id || ''}` : 'none',
      focusedIsInvalid: a ? a.getAttribute('aria-invalid') === 'true' : false,
    };
  });
  if (state.alerts.length === 0) {
    rec({ task: 'T45', route, kind: 'empty-submit-announces-nothing', detail: 'no role="alert" appeared after submitting an empty form' });
  }
  if (state.invalid.length === 0) {
    rec({ task: 'T45', route, kind: 'empty-submit-marks-nothing-invalid', detail: 'no input carries aria-invalid after an empty submit' });
  }
  for (const inv of state.invalid) {
    if (!inv.described) {
      rec({ task: 'T45', route, kind: 'invalid-input-not-described', detail: `#${inv.id} has aria-invalid but no aria-describedby` });
    } else if (!inv.describedResolves) {
      rec({ task: 'T45', route, kind: 'aria-describedby-dangles', detail: `#${inv.id} -> ${inv.described} (no such element)` });
    }
  }
  if (state.invalid.length > 0 && !state.focusedIsInvalid) {
    rec({ task: 'T45', route, kind: 'focus-not-moved-to-first-error', detail: `focus stayed on ${state.focused}` });
  }
  rec({ task: 'T45-observed', route, kind: 'empty-submit', detail: `${state.alerts.length} alerts, ${state.invalid.length} invalid, focus ${state.focused}; first alert: ${state.alerts[0] || '(none)'}` });
}

const WIDTH_PROBE = `(() => { window.scrollTo(document.documentElement.scrollWidth,0);
  const de=document.documentElement, vw=window.innerWidth, over=[];
  if (de.scrollWidth>vw+1) for (const el of document.querySelectorAll('body *')) {
    const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
    const right=r.right+window.scrollX;
    if (right>vw+1) over.push({tag:el.tagName.toLowerCase(),cls:(el.getAttribute('class')||'').slice(0,70),w:Math.round(r.width),right:Math.round(right)}); }
  over.sort((a,b)=>b.right-a.right);
  return {scrollWidth:de.scrollWidth, innerWidth:vw, offenders:over.slice(0,5)}; })()`;

async function measure(page, route, label) {
  const r = await page.evaluate(WIDTH_PROBE);
  if (r.scrollWidth > r.innerWidth + 1) {
    rec({ task: 'T44', route, kind: 'page-scrolls-sideways', detail: `${label}: ${r.scrollWidth} vs ${r.innerWidth} — ${r.offenders.map((o) => `${o.tag}.${o.cls}@${o.right}`).join(' | ')}` });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return r;
}

const browser = await chromium.launch();
try {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await anon.newPage();

  /* ---- keyboard traversal, public ---- */
  for (const route of ['/', '/search', '/legal/grading', '/sign-in', '/cart']) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const stops = await tabThrough(page, route);
    rec({ task: 'T45-observed', route, kind: 'tab-stops', detail: `${stops.length} stops; first: ${stops.slice(0, 4).map((s) => s.name || s.tag).join(' > ')}` });
    // A "skip to content" link is the first stop on a page with 30+ chrome links.
    if (stops.length && !/skip/i.test(stops[0].name)) {
      rec({ task: 'T45', route, kind: 'no-skip-link', detail: `first tab stop is "${stops[0].name || stops[0].tag}"; a keyboard user crosses the whole chrome before reaching content` });
    }
  }

  /* ---- the mobile filter sheet, and the search board at 600 ---- */
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.goto(`${SITE}/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await measure(page, '/search', 'sheet closed @600');
  const filterBtn = page.getByRole('button', { name: /filter/i }).first();
  if ((await filterBtn.count()) > 0) {
    await filterBtn.click().catch(() => {});
    await page.waitForTimeout(900);
    await measure(page, '/search', 'filter sheet OPEN @600');
    const trap = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}.${(a.getAttribute('class') || '').slice(0, 40)}` : 'body';
    });
    rec({ task: 'T45-observed', route: '/search', kind: 'filter-sheet-focus', detail: `on open, focus is ${trap}` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const closed = await page.evaluate(() => !document.querySelector('.railsheet.open, [data-open="true"]'));
    rec({ task: 'T45-observed', route: '/search', kind: 'filter-sheet-escape', detail: `Escape closed it: ${closed}` });
  } else {
    rec({ task: 'T44', route: '/search', kind: 'no-filter-button-at-600', detail: '09_FRONTEND_LOCKED §6 requires the rail to become a sheet behind a "Filters (N)" button under 900px' });
  }
  await page.setViewportSize({ width: 1440, height: 1200 });

  /* ---- long forms, submitted empty ---- */
  await submitEmpty(page, '/register', /continue|next|save/i);
  await submitEmpty(page, '/sell/register', /continue|next|save/i);
  await submitEmpty(page, '/bulk', /Check these lines/i);
  await submitEmpty(page, '/sign-in', /Email me a sign-in code/i);
  await anon.close();

  /* ---- signed-in boards ---- */
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const r = await owner.request.post(`${SITE}/api/auth/login`, { data: { email: 'owner@acme.example', password: PASSWORD } });
  if (!r.ok()) throw new Error(`sign-in answered ${r.status()}`);
  const op = await owner.newPage();
  for (const route of ['/account/orders', '/account/orders/TT-26-00013/delivery', '/account/addresses']) {
    await op.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await op.waitForTimeout(3000);
    const stops = await tabThrough(op, route, 90);
    rec({ task: 'T45-observed', route, kind: 'tab-stops', detail: `${stops.length} stops` });
  }
  // A real dialog: the address book's edit sheet.
  await op.goto(`${SITE}/account/addresses`, { waitUntil: 'domcontentloaded' });
  await op.waitForTimeout(3000);
  const edit = op.getByRole('button', { name: /edit/i }).first();
  if ((await edit.count()) > 0) {
    await edit.click().catch(() => {});
    await op.waitForTimeout(900);
    const dlg = await op.evaluate(() => {
      const d = document.querySelector('[role="dialog"], dialog');
      const a = document.activeElement;
      return {
        exists: Boolean(d),
        modal: d ? d.getAttribute('aria-modal') : null,
        labelled: d ? Boolean(d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')) : null,
        focusInside: d && a ? d.contains(a) : false,
        focused: a ? a.tagName.toLowerCase() : 'none',
      };
    });
    if (!dlg.exists) {
      rec({ task: 'T45', route: '/account/addresses', kind: 'edit-panel-is-not-a-dialog', detail: 'no [role="dialog"] — nothing traps focus and Escape has no defined meaning' });
    } else {
      if (dlg.modal !== 'true') rec({ task: 'T45', route: '/account/addresses', kind: 'dialog-not-modal', detail: `aria-modal=${dlg.modal}` });
      if (!dlg.labelled) rec({ task: 'T45', route: '/account/addresses', kind: 'dialog-unlabelled', detail: 'no aria-label or aria-labelledby' });
      if (!dlg.focusInside) rec({ task: 'T45', route: '/account/addresses', kind: 'dialog-focus-not-moved', detail: `focus is on ${dlg.focused}` });
    }
    rec({ task: 'T45-observed', route: '/account/addresses', kind: 'edit-panel', detail: JSON.stringify(dlg) });
  }
  await owner.close();
} finally {
  await browser.close();
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/interaction.json`, JSON.stringify(findings, null, 2));
console.log(`\n${findings.filter((f) => !f.task.endsWith('-observed')).length} findings -> ${OUT}/interaction.json`);
