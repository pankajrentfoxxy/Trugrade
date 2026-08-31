/**
 * T42–T45 storefront audit harness.
 *
 * One run, one browser, one sign-in per account. Per route × theme × width it
 * records four things, and every one of them is a MEASUREMENT rather than a
 * judgement:
 *
 *   T44  `document.documentElement.scrollWidth` against `window.innerWidth`,
 *        AFTER scrolling right — the four page-width defects in this build all
 *        came from a child declaring an intrinsic width its container could not
 *        honour, and every one was invisible until something scrolled. When they
 *        differ the widest offending elements are named, so the finding is a
 *        selector and not "the page looks wide".
 *   T42  the applied `data-t`, asserted after the switch, because an
 *        unconditional `addInitScript` silently undid the light half of an
 *        earlier run and only the assertion caught it. The toggle itself is
 *        exercised separately — a value that is only right on first paint is a
 *        bug and a static render cannot see it.
 *   T45  axe-core, both themes.
 *   T42  literal-hex and colour-only signals are grepped statically elsewhere;
 *        here we collect the computed colours axe flags.
 *
 * Sign-in is one POST through the storefront's own `/api` rewrite rather than
 * the UI, so the session cookie is first-party and the auth rate limiter is
 * charged once per account for the whole run.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';


// axe-core is a transitive dependency (jest-axe), so it is only in the pnpm
// store and not resolvable from here. Found by path rather than added as a
// direct dependency: this is an audit harness, not a shipped one.
const AXE = 'node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js';
const SITE = 'http://localhost:3000';
const PASSWORD = 'Trugrade!Demo2026';
const OUT = 'docs/review/t42-t45';

/* Real identifiers, all live on this database — see the run log for the checks. */
const SKU = '892eb914-2fcb-48d9-b800-4ff13c6e36e4'; // Latitude 5420, 3 supply points
const ORDER = 'TT-26-00013'; // DELIVERED, paid, one machine, one return, one claim
const SERIAL = 'TGD5963139B';
const CERT = 'F2R8CX064PKTEQ';
const RETURN = 'TT-RET-2608-4654C495';
const CLAIM = 'TT-CLM-2608-6169DCBE';
const APPROVAL = '4e60659e-5bc4-44d1-9d1f-0aa9db1a668a';

/** Public: no session. */
const PUBLIC_ROUTES = [
  ['home', '/'],
  ['search', '/search'],
  ['search-filtered', '/search?grade=A&brand=dell'],
  ['search-nothing', '/search?q=zzzznosuchthing'],
  ['laptop', `/laptops/${SKU}`],
  ['laptop-missing', '/laptops/00000000-0000-0000-0000-000000000000'],
  ['sign-in', '/sign-in'],
  ['forgot-password', '/forgot-password'],
  ['register', '/register'],
  ['sell-register', '/sell/register'],
  ['legal', '/legal'],
  ['legal-grading', '/legal/grading'],
  ['legal-terms', '/legal/terms'],
  ['legal-privacy', '/legal/privacy'],
  ['qc-verify', `/qc/verify/${CERT}`],
  ['qc-verify-unknown', '/qc/verify/ZZZZZZZZZZZZZZ'],
  ['qc-verify-malformed', '/qc/verify/nope'],
  ['unit', `/unit/${SERIAL}`],
  ['unit-missing', '/unit/NOSUCHSERIAL01'],
  ['bulk', '/bulk'],
  ['cart', '/cart'],
];

/** Requires owner@acme.example. */
const OWNER_ROUTES = [
  ['account', '/account'],
  ['account-orders', '/account/orders'],
  ['account-orders-filtered', '/account/orders?status=DELIVERED'],
  ['account-order', `/account/orders/${ORDER}`],
  ['account-order-units', `/account/orders/${ORDER}/units`],
  ['account-order-documents', `/account/orders/${ORDER}/documents`],
  ['account-order-delivery', `/account/orders/${ORDER}/delivery`],
  ['account-returns', '/account/returns'],
  ['account-return', `/account/returns/${RETURN}`],
  ['account-returns-new', '/account/returns/new'],
  ['account-warranty', '/account/warranty'],
  ['account-claim', `/account/warranty/claims/${CLAIM}`],
  ['account-claims-new', '/account/warranty/claims/new'],
  ['account-approvals', '/account/approvals'],
  ['account-addresses', '/account/addresses'],
  ['account-team', '/account/team'],
  ['checkout', '/checkout'],
];

/** Requires approver@acme.example — the inbox is empty for the owner. */
const APPROVER_ROUTES = [
  ['approver-approvals', '/account/approvals'],
  ['approver-approval-record', `/account/approvals/${APPROVAL}`],
];

const findings = [];
const record = (o) => {
  findings.push(o);
  return o;
};

async function signIn(context, email) {
  const res = await context.request.post(`${SITE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`sign-in for ${email} answered ${res.status()}`);
  const session = await context.request.get(`${SITE}/api/auth/session`);
  if (!session.ok()) throw new Error(`session for ${email} answered ${session.status()}`);
  console.log(`signed in ${email}`);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => window.localStorage.setItem('tg-theme', t), theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

/**
 * The T44 measurement. Scroll right first: a horizontal overflow that nothing
 * has scrolled into is still an overflow, and `scrollWidth` is the only witness.
 */
const OVERFLOW_PROBE = `(() => {
  window.scrollTo(document.documentElement.scrollWidth, 0);
  const de = document.documentElement;
  const vw = window.innerWidth;
  const over = [];
  if (de.scrollWidth > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const right = r.right + window.scrollX;
      if (right > vw + 1) {
        over.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') || '').slice(0, 90),
          w: Math.round(r.width),
          right: Math.round(right),
        });
      }
    }
  }
  over.sort((a, b) => b.right - a.right);
  return {
    scrollWidth: de.scrollWidth,
    innerWidth: vw,
    bodyScrollWidth: document.body.scrollWidth,
    offenders: over.slice(0, 6),
  };
})()`;

async function measureWidth(page, name, theme, width) {
  await page.setViewportSize({ width, height: 1400 });
  await page.waitForTimeout(450);
  const r = await page.evaluate(OVERFLOW_PROBE);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (r.scrollWidth > r.innerWidth + 1) {
    record({
      task: 'T44',
      route: name,
      theme,
      width,
      kind: 'page-scrolls-sideways',
      detail: `scrollWidth ${r.scrollWidth} vs viewport ${r.innerWidth}`,
      offenders: r.offenders,
    });
    console.log(`  ! T44 ${name} ${theme} ${width}: ${r.scrollWidth} > ${r.innerWidth}`);
  }
  return r;
}

async function runAxe(page, name, theme, width) {
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 3).map((n) => ({
        target: n.target.join(' '),
        summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220),
      })),
    }));
  });
  for (const v of result) {
    record({ task: 'T45', route: name, theme, width, kind: `axe:${v.id}`, detail: v.help, impact: v.impact, count: v.count, nodes: v.nodes });
  }
  if (result.length) {
    console.log(`  ! T45 ${name} ${theme}: ${result.map((v) => `${v.id}×${v.count}`).join(', ')}`);
  }
  return result;
}

async function auditRoute(page, name, path) {
  console.log(`route ${name} ${path}`);
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await setTheme(page, theme);
    await page.waitForTimeout(600);

    // T42: header and footer must stay dark chrome in BOTH themes.
    const chrome = await page.evaluate(() => {
      const bg = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return {
        header: bg('header'),
        footer: bg('footer'),
        body: getComputedStyle(document.body).backgroundColor,
        dataT: document.documentElement.getAttribute('data-t'),
      };
    });
    record({ task: 'T42-observed', route: name, theme, kind: 'chrome', detail: JSON.stringify(chrome) });

    await runAxe(page, name, theme, 1440);
    await measureWidth(page, name, theme, 1440);
    await measureWidth(page, name, theme, 900);
    await measureWidth(page, name, theme, 600);
    await runAxe(page, name, theme, 600);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
}

/** The toggle, not the static render. Click it and prove it flips and persists. */
async function auditToggle(page, path) {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  const btn = page.getByRole('button', { name: /Switch to (light|dark) theme/ }).first();
  const count = await btn.count();
  if (count === 0) {
    record({ task: 'T42', route: path, kind: 'no-theme-toggle', detail: 'no theme toggle control found on this route' });
    return;
  }
  await btn.click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    dataT: document.documentElement.getAttribute('data-t'),
    stored: window.localStorage.getItem('tg-theme'),
  }));
  if (after.dataT === before) {
    record({ task: 'T42', route: path, kind: 'toggle-did-not-flip', detail: `stayed ${before}` });
  }
  if (after.stored !== after.dataT) {
    record({ task: 'T42', route: path, kind: 'toggle-not-persisted', detail: `data-t ${after.dataT}, tg-theme ${after.stored}` });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (afterReload !== after.dataT) {
    record({ task: 'T42', route: path, kind: 'theme-not-restored-on-reload', detail: `${after.dataT} -> ${afterReload}` });
  }
  record({ task: 'T42-observed', route: path, kind: 'toggle', detail: `${before} -> ${after.dataT} (stored ${after.stored}, after reload ${afterReload})` });
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  // Seeded ONLY when absent: an unconditional init script re-runs on every
  // navigation and undoes a mid-run theme switch. That is in the ledger.
  await context.addInitScript(() => {
    if (!window.localStorage.getItem('tg-theme')) window.localStorage.setItem('tg-theme', 'dark');
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  return { context, page, consoleErrors };
}

const only = process.argv[2];
const pick = (list) => (only ? list.filter(([n]) => n.includes(only)) : list);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const pub = await newContext(browser);
  for (const [name, path] of pick(PUBLIC_ROUTES)) await auditRoute(pub.page, name, path);
  await auditToggle(pub.page, '/');
  await auditToggle(pub.page, '/search');
  await auditToggle(pub.page, '/sign-in');
  await auditToggle(pub.page, '/legal/grading');
  if (pub.consoleErrors.length) {
    record({ task: 'T43', route: 'public', kind: 'console-errors', detail: [...new Set(pub.consoleErrors)].slice(0, 10).join(' | ') });
  }
  await pub.context.close();

  const owner = await newContext(browser);
  await signIn(owner.context, 'owner@acme.example');
  for (const [name, path] of pick(OWNER_ROUTES)) await auditRoute(owner.page, name, path);
  await auditToggle(owner.page, '/account/orders');
  if (owner.consoleErrors.length) {
    record({ task: 'T43', route: 'owner', kind: 'console-errors', detail: [...new Set(owner.consoleErrors)].slice(0, 10).join(' | ') });
  }
  await owner.context.close();

  const approver = await newContext(browser);
  await signIn(approver.context, 'approver@acme.example');
  for (const [name, path] of pick(APPROVER_ROUTES)) await auditRoute(approver.page, name, path);
  if (approver.consoleErrors.length) {
    record({ task: 'T43', route: 'approver', kind: 'console-errors', detail: [...new Set(approver.consoleErrors)].slice(0, 10).join(' | ') });
  }
  await approver.context.close();
} finally {
  await browser.close();
}

await writeFile(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
const real = findings.filter((f) => !f.task.endsWith('-observed'));
console.log(`\n${real.length} findings, ${findings.length} records -> ${OUT}/findings.json`);
for (const f of real) console.log(`${f.task} ${f.route} ${f.theme ?? ''} ${f.width ?? ''} ${f.kind} :: ${f.detail ?? ''}`);
