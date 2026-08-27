/**
 * T4 review captures: customer registration, both themes, three widths.
 *
 * Drives the real API — a real OTP is issued and read back out of the response
 * (`devCode`, non-production only), a real account is created, and a real draft
 * is saved and resumed. Nothing here stubs the network.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';

const stamp = Date.now().toString().slice(-7);
const account = (theme) => ({
  email: `t4.${theme}.${stamp}@acme-industries.co.in`,
  mobile: `9${(8000000000 + Number(stamp) + (theme === 'dark' ? 0 : 7)).toString().slice(1)}`,
  password: 'Vermilion-Ledger-88!',
});

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function run(theme) {
  const who = account(theme);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });

  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  // The theme is seeded from a real page rather than with `addInitScript`: on
  // the very first navigation that write can land on the wrong origin, and the
  // pre-paint read then finds nothing.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.localStorage.setItem('tg-theme', t), theme);

  const codes = new Map();
  page.on('response', async (res) => {
    if (!res.url().includes('/auth/register/otp') || res.url().includes('verify')) return;
    const body = await res.json().catch(() => null);
    if (body?.devCode) codes.set(body.channel, body.devCode);
  });

  /* 1 — the shell while it is deciding whether this is a returning applicant. */
  let delayedOnce = false;
  await page.route('**/api/auth/session', async (route) => {
    if (!delayedOnce) {
      delayedOnce = true;
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue().catch(() => {});
  });
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="step-rail"]');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
  await shot(page, `T4-register-shell-loading-${theme}`);

  /* 2 — step 1, empty. */
  await page.waitForSelector('text=Create account and continue');
  await shot(page, `T4-register-step1-${theme}`);

  /* 3 — a validation error: continue with nothing verified. */
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await page.waitForSelector('text=Verify this address before you continue.');
  await shot(page, `T4-register-step1-errors-${theme}`);

  /* 4 — OTP sent. */
  await page.getByLabel('Your full name').fill('Ananya Raghavan');
  await page.getByLabel('Company legal name').fill('Acme Industries Private Limited');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForSelector('text=The code is good for');
  await shot(page, `T4-register-otp-sent-${theme}`);

  /* 5 — a wrong code burns an attempt. */
  const boxes = page.locator('input[inputmode="numeric"]');
  await boxes.first().fill('000000');
  await page.waitForSelector('[role="alert"]');
  await shot(page, `T4-register-otp-wrong-${theme}`);

  /* 6 — the real code, then the mobile. */
  await page.waitForTimeout(300);
  await boxes.first().fill(codes.get('EMAIL'));
  await page.waitForSelector('text=Verified. We sent a code to');

  await page.getByLabel('Mobile').fill(who.mobile);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('MOBILE'));
  await page.waitForSelector('text=Signed in', { timeout: 3000 }).catch(() => {});

  await page.getByLabel('Password').fill(who.password);
  await page.getByLabel('How did you hear about us?').selectOption('SEARCH');
  await shot(page, `T4-register-step1-ready-${theme}`);

  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await page.getByLabel('Year established').waitFor({ timeout: 20000 });
  await shot(page, `T4-register-step2-${theme}`);

  /* 7 — step 2 validation: a year that has not happened. */
  await page.getByLabel('Year established').fill('2099');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=That year has not happened yet.');
  await shot(page, `T4-register-step2-errors-${theme}`);

  /* 8 — save a partial draft, then resume it from a cold load. */
  await page.getByLabel('Year established').fill('2014');
  await page.getByLabel('Trade name').fill('Acme IT');
  await page.getByLabel('Constitution').selectOption('PVT_LTD');
  await page.getByLabel('Industry').selectOption('IT_SERVICES');
  await page.getByLabel('Employees').selectOption('51-200');
  await page.getByLabel('Website').fill('acme-industries.co.in');
  await page.getByLabel('Website').blur();
  await page.waitForTimeout(800);

  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Year established').waitFor({ timeout: 20000 });
  await shot(page, `T4-register-resumed-${theme}`);

  /* 9 — breakpoints. */
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(400);
    await shot(page, `T4-register-resumed-${width}-${theme}`);
  }

  /* 10 — a step that is not built yet, reached through the URL. */
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(`${BASE}/register?step=STATUTORY`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, `T4-register-step3-not-built-${theme}`);

  /* 11 — the homepage, for the chrome comparison. */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await shot(page, `T4-home-${theme}`);

  await browser.close();
}

await mkdir(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
for (const theme of themes) await run(theme);
console.log('done');
