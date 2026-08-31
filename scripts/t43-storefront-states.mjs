/**
 * T43: the loading and error states of every storefront screen that fetches in
 * the BROWSER, captured as text rather than judged from the source.
 *
 * `page.route` only reaches the browser's own requests. `/`, `/search`,
 * `/laptops/**`, `/unit/**`, `/qc/verify/**` and `/legal/**` fetch on the
 * server, so a stub here would be answered by a live API and the frame would
 * show real data under an "error" label — the exact defect T48 shipped. Those
 * routes are NOT in this list; their unavailable branches are read from source
 * instead, and that is said plainly rather than photographed dishonestly.
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const SITE = 'http://localhost:3000';
const PASSWORD = 'Trugrade!Demo2026';
const OUT = 'docs/review/t42-t45';
const ORDER = 'TT-26-00013';
const RETURN = 'TT-RET-2608-4654C495';
const CLAIM = 'TT-CLM-2608-6169DCBE';

const ROUTES = [
  ['cart', '/cart', false],
  ['bulk', '/bulk', false],
  ['register', '/register', false],
  ['sell-register', '/sell/register', false],
  ['account', '/account', true],
  ['account-orders', '/account/orders', true],
  ['account-order', `/account/orders/${ORDER}`, true],
  ['account-order-units', `/account/orders/${ORDER}/units`, true],
  ['account-order-documents', `/account/orders/${ORDER}/documents`, true],
  ['account-order-delivery', `/account/orders/${ORDER}/delivery`, true],
  ['account-returns', '/account/returns', true],
  ['account-return', `/account/returns/${RETURN}`, true],
  ['account-returns-new', '/account/returns/new', true],
  ['account-warranty', '/account/warranty', true],
  ['account-claim', `/account/warranty/claims/${CLAIM}`, true],
  ['account-claims-new', '/account/warranty/claims/new', true],
  ['account-approvals', '/account/approvals', true],
  ['account-addresses', '/account/addresses', true],
  ['account-team', '/account/team', true],
  ['checkout', '/checkout', true],
];

const squash = (s) => s.replace(/\s+/g, ' ').trim();

async function capture(page, path, mode) {
  let phase = mode;
  const pattern = '**/api/**';
  await page.route(pattern, async (route) => {
    if (phase === 'slow') {
      await new Promise((r) => setTimeout(r, 9000));
      await route.continue().catch(() => {});
      return;
    }
    await route
      .fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' })
      .catch(() => {});
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(mode === 'slow' ? 1800 : 3500);
  const text = squash(await page.evaluate(() => document.body.innerText || ''));
  await page.unroute(pattern);
  return text;
}

const report = [];
const browser = await chromium.launch();
try {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const anonPage = await anon.newPage();

  const owner = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const res = await owner.request.post(`${SITE}/api/auth/login`, {
    data: { email: 'owner@acme.example', password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`sign-in answered ${res.status()}`);
  const ownerPage = await owner.newPage();

  for (const [name, path, needsAuth] of ROUTES) {
    const page = needsAuth ? ownerPage : anonPage;
    const success = await (async () => {
      await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      return squash(await page.evaluate(() => document.body.innerText || ''));
    })();
    const loading = await capture(page, path, 'slow');
    const error = await capture(page, path, 'fail');
    report.push({ name, path, success, loading, error });
    console.log(`\n########## ${name}  ${path}`);
    console.log(`-- LOADING: ${loading.slice(0, 700)}`);
    console.log(`-- ERROR:   ${error.slice(0, 900)}`);
  }

  await anon.close();
  await owner.close();
} finally {
  await browser.close();
}
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/states.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.length} routes -> ${OUT}/states.json`);
