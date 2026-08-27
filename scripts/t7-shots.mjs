/**
 * T7 review captures: vendor registration steps 1 to 3. Both themes.
 *
 * Drives the real API. Nothing below is stubbed — the OTPs are real codes read
 * off the dev response, the registrations create real VENDOR organisations, and
 * every verification outcome is the fake GST adapter answering on the *check
 * digit* of a genuine 15-character GSTIN (`kyc.fakes.ts`, `gstin.slice(-2)`):
 *
 *   …Z1  PASS            …Z2  MISMATCH        …Z3  cancelled registration
 *   …Z4  FAIL            …Z8  TIMEOUT         …Z9  PROVIDER_ERROR
 *
 * **Two accounts per theme, and that is deliberate.** `checkForValueShopping`
 * pauses an application the moment it has seen three *distinct* GSTINs from one
 * org in twenty-four hours, so one account cannot be shown a PASS, a FAIL and a
 * PROVIDER_ERROR. Run A takes the two refusals, run B walks the clean path and
 * is the account every other shot is taken against — four registrations in all,
 * against a per-IP budget of ten a day and twenty OTP sends an hour.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';

/**
 * The registration limits are keyed on the caller's IP and nothing else, so a
 * capture run of four accounts spends four of one budget of ten a day and eight
 * of one budget of twenty OTP sends an hour — from the same key every real
 * signup on this machine uses. T6 hit the wall mid-run and lost 47 minutes to it.
 *
 * Cleared deliberately and loudly, in dev only. **This is the workaround, not
 * the fix**: in production, behind an office NAT or a CGNAT, one applicant's
 * registrations lock out everybody else's from the same building. The rule needs
 * a second dimension. Reported again.
 */
function clearDevRateLimits() {
  for (const key of [
    'rl:auth-register:::1',
    'rl:auth-register-otp-ip:::1',
    'rl:auth-register-otp-verify-ip:::1',
  ]) {
    execFileSync('docker', ['exec', 'trugrade-redis', 'redis-cli', 'del', key], {
      encoding: 'utf8',
    });
  }
}

/* ----------------------------------------------------- statutory identities */

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

/** The 13th character may not be `0`, so one check digit is unreachable per state. */
const STATE_CODES = ['06', '07', '09', '24', '27', '29', '33', '19'];

function gstinFor(pan, wanted) {
  for (const stateCode of STATE_CODES) {
    for (const serial of '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const first14 = `${stateCode}${pan}${serial}Z`;
      if (gstinCheckDigit(first14) === wanted) return first14 + wanted;
    }
  }
  throw new Error(`no GSTIN with check digit ${wanted} for ${pan}`);
}

/**
 * A fresh identity per run. `assertRetryAllowed` counts attempts by input hash
 * alone — no org — so a constant PAN across runs works exactly once.
 */
function mintIdentity(runIndex) {
  const digits = String((Date.now() + runIndex * 7919) % 10000).padStart(4, '0');
  const letter = B36[10 + ((Date.now() + runIndex) % 26)];
  /** 4th character C — the fake reports the holder as a COMPANY. */
  const pan = `AB${letter}C${letter}${digits}F`;
  return {
    pan,
    pass: gstinFor(pan, '1'),
    fail: gstinFor(pan, '4'),
    providerError: gstinFor(pan, '9'),
  };
}

const LEGAL_NAME = 'Northgate Asset Recovery Private Limited';

const stamp = Date.now().toString().slice(-6);
let seq = 0;
function account() {
  seq += 1;
  return {
    email: `t7.${seq}.${stamp}@northgate-recovery.co.in`,
    mobile: `9${(8100000 + Number(stamp) + seq * 13).toString().slice(-7)}${seq}${(seq * 7) % 10}`,
    password: 'Vermilion-Ledger-88!',
  };
}

/* -------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

/** A failed capture is a bug report: keep the screen that failed. */
async function guard(page, label, fn) {
  try {
    await fn();
  } catch (error) {
    await page.screenshot({ path: `${OUT}/_failed-${label}.png`, fullPage: true });
    throw error;
  }
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.localStorage.setItem('tg-theme', t), theme);

  const codes = new Map();
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('verify')) return;
    if (url.includes('/auth/mfa/otp')) {
      const body = await res.json().catch(() => null);
      if (body?.devCode) codes.set('MFA', body.devCode);
      return;
    }
    if (!url.includes('/auth/register/otp')) return;
    const body = await res.json().catch(() => null);
    if (body?.devCode) codes.set(body.channel, body.devCode);
  });

  return { page, codes, context };
}

/* ------------------------------------------------------------------- step 1 */

async function fillStepOne(page, who, codes, brands) {
  await page.getByLabel('Your full name').fill('Rohan Deshpande');
  await page.getByLabel('Company name').fill('Northgate Asset Recovery');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForSelector('text=The code is good for');
}

async function finishStepOne(page, who, codes) {
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('EMAIL'));
  await page.waitForSelector('text=Verified. We sent a code to');

  await page.getByLabel('Mobile').fill(who.mobile);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('MOBILE'));
  await page.waitForTimeout(900);

  await page.getByLabel('Password').fill(who.password);
  await page.getByLabel('City you operate from').fill('Gurugram');
  await page.getByLabel('Laptops you move in a month').selectOption('100');
  for (const brand of ['Dell', 'HP', 'Lenovo']) {
    const chip = page.getByRole('button', { name: brand, exact: true });
    if (await chip.count()) await chip.first().click();
  }
  await page.getByLabel('Any other brands').fill('Fujitsu, Panasonic');
  await page.getByLabel('How did you hear about us?').selectOption('EXISTING_VENDOR');
}

/**
 * The second factor.
 *
 * A VENDOR_OWNER is in `MFA_REQUIRED_ROLES`, so the account is created and then
 * refused by `AuthGuard` on every onboarding call until a code lands. This is
 * not an extra the capture invented — it is the only path a real supplier has.
 */
async function passMfa(page, codes, theme, shotName) {
  await page.waitForSelector('text=It needs a second code', { timeout: 40000 });
  if (shotName) await shot(page, `${shotName}-${theme}`);
  await page.waitForTimeout(600);
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('MFA'));
}

/* ------------------------------------------------------------------- step 2 */

const section = (page, title) =>
  page.getByTestId('form-section').filter({ hasText: title }).first();

async function fillAddress(scope, values) {
  await scope.getByLabel('Building and street').fill(values.line1);
  await scope.getByLabel('Area or landmark').fill(values.line2);
  await scope.getByLabel('City').fill(values.city);
  await scope.getByLabel('PIN code').fill(values.pincode);
  await scope.getByLabel('State').selectOption(values.state);
}

async function fillStepTwo(page) {
  await page.getByLabel('Legal name').fill(LEGAL_NAME);
  await page.getByLabel('Trade name').fill('Northgate Recovery');
  await page.getByLabel('Constitution').selectOption('PVT_LTD');
  await page.getByLabel('Date of incorporation').fill('2016-04-18');
  await page.getByLabel('What best describes you').selectOption('ITAD');
  await page.getByLabel('People on the payroll').selectOption('51-200');
  await page.getByLabel('Website').fill('northgate-recovery.co.in');

  await fillAddress(section(page, 'Registered office'), {
    line1: 'Unit 214, Vipul Agora',
    line2: 'MG Road',
    city: 'Gurugram',
    pincode: '122002',
    state: '06',
  });
  await fillAddress(section(page, 'Operating address'), {
    line1: 'Plot 61, Sector 37 Industrial Estate',
    line2: 'Pace City II',
    city: 'Gurugram',
    pincode: '122004',
    state: '06',
  });
  await page.getByLabel('Website').blur();
  await page.waitForTimeout(800);
}

/* ------------------------------------------------------- widths, both shots */

async function widths(page, name) {
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(500);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(400);
}

/* ==========================================================================
 * Run B — the clean path, and every shot that is not a refusal
 * ======================================================================== */

async function cleanPath(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  const who = account();
  await guard(page, `clean-${theme}`, async () => {

  await page.goto(`${BASE}/sell/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Create account and continue');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);

  /* 1 — nothing entered. */
  await shot(page, `T7-step1-empty-${theme}`);
  await widths(page, `T7-step1-empty-${theme}`);

  /* 2 — a code genuinely sent, with the server's masked address echoed back. */
  await fillStepOne(page, who, codes);
  await shot(page, `T7-step1-otp-sent-${theme}`);

  /* 3 — both channels proved, everything answered. */
  await finishStepOne(page, who, codes);
  await shot(page, `T7-step1-ready-${theme}`);

  /* 4 — the second factor, then step 2 with nothing entered. */
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await passMfa(page, codes, theme, 'T7-second-factor');
  await page.getByLabel('Legal name').waitFor({ timeout: 40000 });
  await shot(page, `T7-step2-empty-${theme}`);

  /* 5 — both addresses, and the incorporation date the constitution unlocked. */
  await fillStepTwo(page);
  await shot(page, `T7-step2-both-addresses-${theme}`);
  await widths(page, `T7-step2-both-addresses-${theme}`);

  /* 6 — step 3, nothing entered: every check reads "Not verified". */
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('PAN', { exact: false }).first().waitFor({ timeout: 40000 });
  await shot(page, `T7-step3-empty-${theme}`);

  /* 7 — PAN, then a GSTIN the portal confirms. The returned legal name is the
     whole point of the panel, so it is what the shot is of. */
  await page.getByLabel('PAN', { exact: false }).first().fill(identity.pan);
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Held by', { timeout: 30000 });

  await page.getByLabel('GSTIN 1').fill(identity.pass);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForSelector('text=Registered since', { timeout: 30000 });
  await shot(page, `T7-gstin-pass-${theme}`);

  /* 8 — confirmed, primary chosen, and the three registry numbers captured. */
  await page.getByLabel('Yes, this is our business').first().check();
  await page.locator('input[name="primary-gstin"]').first().check();
  await page.getByLabel('CIN').fill('U72900HR2016PTC098765');
  await page.getByLabel('Udyam registration').fill('UDYAM-HR-05-0001234');
  await page.getByLabel('TAN').fill('DELT12345E');
  await page.getByLabel('TAN').blur();
  await page.waitForTimeout(900);
  await shot(page, `T7-registry-captured-${theme}`);
  await widths(page, `T7-registry-captured-${theme}`);

  /* 9 — a cold reload, taken before step 3 is completed: `completeStep` clears
     the draft server-side, so this is the state a returning applicant is in. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('PAN', { exact: false }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  await shot(page, `T7-resumed-${theme}`);

  /* 10 — step 4. It is T8's, and the shell says so rather than pretending: the
     rail still shows all seven and the three answered steps stay answered. */
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=is not built yet', { timeout: 40000 });
  await shot(page, `T7-step4-not-built-${theme}`);
  });
  await context.close();
}

/* ==========================================================================
 * Run A — the two refusals, on their own account
 * ======================================================================== */

async function refusals(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  const who = account();
  await guard(page, `refusals-${theme}`, async () => {

  await page.goto(`${BASE}/sell/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Create account and continue');
  await fillStepOne(page, who, codes);
  await finishStepOne(page, who, codes);
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await passMfa(page, codes, theme, null);
  await page.getByLabel('Legal name').waitFor({ timeout: 40000 });
  await fillStepTwo(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('PAN', { exact: false }).first().waitFor({ timeout: 40000 });

  await page.getByLabel('PAN', { exact: false }).first().fill(identity.pan);
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Held by', { timeout: 30000 });

  /* 10 — FAIL. Theirs to fix, and the message says how. */
  await page.getByLabel('GSTIN 1').fill(identity.fail);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForSelector('text=Refused', { timeout: 30000 });
  await shot(page, `T7-gstin-fail-${theme}`);

  /* 11 — PROVIDER_ERROR: ours, not theirs. No attempt spent, retrying on a
     visible countdown. Caught inside the first five-second window. */
  await page.getByLabel('GSTIN 1').fill(identity.providerError);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForSelector('text=Retrying automatically in', { timeout: 30000 });
  await shot(page, `T7-provider-error-${theme}`);
  await widths(page, `T7-provider-error-${theme}`);
  });
  await context.close();
}

await mkdir(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
const only = process.env.ONLY;
const browser = await chromium.launch();
let run = 0;
for (const theme of themes) {
  clearDevRateLimits();
  if (!only || only === 'clean') await cleanPath(browser, theme, (run += 1));
  clearDevRateLimits();
  if (!only || only === 'refusals') await refusals(browser, theme, (run += 1));
}
await browser.close();
console.log('done');
