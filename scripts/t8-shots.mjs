/**
 * T8 review captures: vendor registration steps 4 and 5. Both themes.
 *
 * Drives the real API. Nothing below is stubbed — the OTPs are real codes read
 * off the dev response, the registrations create real VENDOR organisations, and
 * the GSTIN is verified by the fake GST adapter answering on the check digit of
 * a genuine 15-character number (`kyc.fakes.ts`, `gstin.slice(-2)`; `…Z1` is a
 * PASS).
 *
 * **One account per theme, and every shot comes off it.** The registration and
 * OTP rate limits are keyed on the caller's IP and nothing else, so a capture
 * run that registered per shot would lock the machine out mid-run — which is
 * what happened to T6. Steps 1 to 3 are walked once, then steps 4 and 5 are
 * driven through every state in place.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';

/**
 * Cleared deliberately and loudly, in dev only. **This is the workaround, not
 * the fix**: in production, behind an office NAT or a CGNAT, one applicant's
 * registrations lock out everybody else's from the same building. Reported by
 * T6 and T7; still keyed on IP alone.
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

/** `assertRetryAllowed` counts attempts by input hash alone, so the PAN is fresh. */
function mintIdentity(runIndex) {
  const digits = String((Date.now() + runIndex * 7919) % 10000).padStart(4, '0');
  const letter = B36[10 + ((Date.now() + runIndex) % 26)];
  const pan = `AB${letter}C${letter}${digits}F`;
  return { pan, pass: gstinFor(pan, '1') };
}

const LEGAL_NAME = 'Northgate Asset Recovery Private Limited';

const stamp = Date.now().toString().slice(-6);
let seq = 0;
function account() {
  seq += 1;
  return {
    email: `t8.${seq}.${stamp}@northgate-recovery.co.in`,
    mobile: `9${(8100000 + Number(stamp) + seq * 13).toString().slice(-7)}${seq}${(seq * 7) % 10}`,
    password: 'Vermilion-Ledger-88!',
  };
}

/* -------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function guard(page, label, fn) {
  try {
    await fn();
  } catch (error) {
    await page.screenshot({ path: `${OUT}/_failed-${label}.png`, fullPage: true });
    throw error;
  }
}

async function widths(page, name) {
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(500);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(400);
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

/* ------------------------------------------------------------- steps 1 to 3 */

const section = (page, title) =>
  page.getByTestId('form-section').filter({ hasText: title }).first();

async function fillAddress(scope, values) {
  await scope.getByLabel('Building and street').first().fill(values.line1);
  await scope.getByLabel('Area or landmark').first().fill(values.line2);
  await scope.getByLabel('City').first().fill(values.city);
  await scope.getByLabel('PIN code').first().fill(values.pincode);
  await scope.getByLabel('State').first().selectOption(values.state);
}

async function walkToStepFour(page, who, codes, identity, theme) {
  await page.goto(`${BASE}/sell/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Create account and continue');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);

  await page.getByLabel('Your full name').fill('Rohan Deshpande');
  await page.getByLabel('Company name').fill('Northgate Asset Recovery');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForSelector('text=The code is good for');
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

  await page.getByRole('button', { name: 'Create account and continue' }).click();

  /* The second factor: VENDOR_OWNER is in MFA_REQUIRED_ROLES. */
  await page.waitForSelector('text=It needs a second code', { timeout: 40000 });
  await page.waitForTimeout(600);
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('MFA'));

  /* Step 2. */
  await page.getByLabel('Legal name').waitFor({ timeout: 40000 });
  await page.getByLabel('Legal name').fill(LEGAL_NAME);
  await page.getByLabel('Trade name').fill('Northgate Recovery');
  await page.getByLabel('Constitution').selectOption('PVT_LTD');
  await page.getByLabel('Date of incorporation').fill('2016-04-18');
  await page.getByLabel('What best describes you').selectOption('ITAD');
  await page.getByLabel('People on the payroll').selectOption('51-200');
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
  await page.getByLabel('Trade name').blur();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  /* Step 3. */
  await page.getByLabel('PAN', { exact: false }).first().waitFor({ timeout: 40000 });
  await page.getByLabel('PAN', { exact: false }).first().fill(identity.pan);
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Held by', { timeout: 30000 });
  await page.getByLabel('GSTIN 1').fill(identity.pass);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForSelector('text=Registered since', { timeout: 30000 });
  await page.getByLabel('Yes, this is our business').first().check();
  await page.locator('input[name="primary-gstin"]').first().check();
  await page.getByLabel('CIN').fill('U72900HR2016PTC098765');
  await page.getByLabel('TAN').fill('DELT12345E');
  await page.getByLabel('TAN').blur();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByLabel('Laptops you can supply in a month').waitFor({ timeout: 40000 });
}

/* ==========================================================================
 * Step 4 — capability
 * ======================================================================== */

async function stepFour(page, theme) {
  /* 1 — nothing entered. Every yes/no reads "Not answered yet". */
  await shot(page, `T8-step4-empty-${theme}`);
  await widths(page, `T8-step4-empty-${theme}`);

  await page.getByRole('button', { name: 'Business laptops' }).click();
  await page.getByRole('button', { name: 'Mobile workstations' }).click();
  await page.getByLabel('Laptops you can supply in a month').fill('300');
  await page.getByLabel('Grade A+', { exact: true }).fill('50');
  await page.getByLabel('Grade A', { exact: true }).fill('30');
  await page.getByLabel('Typical price, lowest').fill('14000');
  await page.getByLabel('Typical price, highest').fill('42000');
  await page.getByLabel('Corporate buy-back', { exact: true }).check();
  await page.getByLabel('ITAD contract', { exact: true }).check();
  await page.getByLabel('We test in-house').check();
  await page.getByLabel('Lead time, in days').fill('2');
  await page.getByLabel('Lead time, in days').blur();

  /* 2 — a grade mix that does not total 100, and can_dropship unanswered.
     Both refusals name the number and the fix. */
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=of your stock is not described');
  await shot(page, `T8-step4-mix-short-${theme}`);
  await widths(page, `T8-step4-mix-short-${theme}`);

  /* 3 — can_dropship answered "no": a real answer with a real consequence,
     never a validation failure. */
  await page.getByLabel('Grade B', { exact: true }).fill('20');
  await page.getByLabel('we can send serials with the offer').check();
  await page.getByLabel('we cannot dispatch to a third party').check();
  await page.waitForTimeout(400);
  await shot(page, `T8-step4-dropship-no-${theme}`);
  await widths(page, `T8-step4-dropship-no-${theme}`);

  /* 4 — everything answered the ordinary way. */
  await page.getByLabel('we pack and hand over to the carrier').check();
  await page.waitForTimeout(400);
  await shot(page, `T8-step4-filled-${theme}`);
  await widths(page, `T8-step4-filled-${theme}`);

  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Name this site').first().waitFor({ timeout: 40000 });
}

/* ==========================================================================
 * Step 5 — facility and contacts
 * ======================================================================== */

async function fillHours(facility, opensAt, closesAt) {
  const hours = facility.getByRole('group', { name: /^Operating hours for site/ });
  await hours.getByLabel('Opens').first().fill(opensAt);
  await hours.getByLabel('Closes').first().fill(closesAt);
  await hours.getByRole('button', { name: /Copy Monday/ }).click();
  // Sunday is the last row, and a shut day is an answer rather than a blank.
  await hours.getByLabel('Closed').nth(6).check();
}

async function stepFive(page, theme) {
  /* 5 — nothing entered. One empty site, no holidays, no contacts. */
  await shot(page, `T8-step5-empty-${theme}`);
  await widths(page, `T8-step5-empty-${theme}`);

  const first = page.getByTestId('facility').first();
  await first.getByLabel('Name this site').fill('Sector 37 warehouse');
  await first.getByLabel('What this site is').selectOption('WAREHOUSE');
  await first.getByLabel('Building and street').first().fill('Unit 214, Vipul Agora');
  await first.getByLabel('Area or landmark').first().fill('MG Road');
  await first.getByLabel('City').first().fill('Gurugram');
  await first.getByLabel('PIN code').first().fill('122002');
  await first.getByLabel('State').first().selectOption('06');

  /* 6 — the dispatch address differs from the facility address, and the line
     that will be printed on the e-way bill is shown back. */
  const dispatch = first.getByTestId('dispatch');
  await dispatch.getByLabel('goods leave from somewhere else').check();
  await dispatch
    .getByLabel('Dispatch building and street')
    .fill('Plot 61, Sector 37 Industrial Estate');
  await dispatch.getByLabel('Area or landmark').fill('Pace City II');
  await dispatch.getByLabel('City').fill('Gurugram');
  await dispatch.getByLabel('PIN code').fill('122004');
  await dispatch.getByLabel('State').selectOption('06');
  await dispatch.getByLabel('PIN code').blur();
  await page.waitForTimeout(400);
  await shot(page, `T8-dispatch-differs-${theme}`);
  await widths(page, `T8-dispatch-differs-${theme}`);

  await first.getByLabel('Machines this site can hold').fill('1200');
  await first.getByLabel('Testing stations here').fill('8');
  await first.getByLabel('Largest vehicle that can reach the loading point').selectOption('TRUCK');
  await first.getByLabel('There is a loading dock').check();
  await first.getByLabel('There is a working goods lift').check();
  await first
    .getByLabel('Anything a driver needs to know')
    .fill('Gate 3, ask for the security desk. No entry after 17:30.');
  await fillHours(first, '09:30', '18:00');
  await first.getByRole('button', { name: 'Add a holiday' }).click();
  await first.getByLabel('Date').fill('2026-10-20');
  await first.getByLabel('Reason').fill('Diwali');
  await first.getByLabel('Reason').blur();
  await page.waitForTimeout(500);

  /* 7 — one complete site. */
  await shot(page, `T8-step5-one-facility-${theme}`);
  await widths(page, `T8-step5-one-facility-${theme}`);

  /* 8 — a second site, dispatching from its own address. */
  await page.getByRole('button', { name: 'Add another site' }).click();
  const second = page.getByTestId('facility').nth(1);
  await second.getByLabel('Name this site').fill('Okhla refurb unit');
  await second.getByLabel('What this site is').selectOption('REFURB_UNIT');
  await second.getByLabel('Building and street').first().fill('B-42, Okhla Phase II');
  await second.getByLabel('City').first().fill('New Delhi');
  await second.getByLabel('PIN code').first().fill('110020');
  await second.getByLabel('State').first().selectOption('07');
  await second.getByTestId('dispatch').getByLabel('same address').check();
  await second.getByLabel('Machines this site can hold').fill('300');
  await second.getByLabel('Largest vehicle that can reach the loading point').selectOption('TEMPO');
  await fillHours(second, '10:00', '19:00');
  await second.getByLabel('Anything a driver needs to know').blur();
  await page.waitForTimeout(500);
  await shot(page, `T8-step5-two-facilities-${theme}`);
  await widths(page, `T8-step5-two-facilities-${theme}`);

  /* 9 — all four contacts, WhatsApp and preferred language included. */
  const people = [
    ['Owner or director', 'Rohan Deshpande', 'Director', 'rohan', '9810011221', '9810011221', 'EN'],
    ['Operations', 'Meera Iyer', 'Operations head', 'meera', '9810022332', '9810022332', 'EN'],
    ['Finance', 'Anil Bhatt', 'Accounts manager', 'anil', '9810033443', '', 'HI'],
    ['Warehouse', 'Sunil Yadav', 'Store in-charge', 'sunil', '9810044554', '9810044554', 'HI'],
  ];
  for (const [role, name, designation, mailbox, mobile, whatsapp, language] of people) {
    await page.getByLabel(`${role} contact name`).fill(name);
    await page.getByLabel(`${role} designation`).fill(designation);
    await page.getByLabel(`${role} email`).fill(`${mailbox}@northgate-recovery.co.in`);
    await page.getByLabel(`${role} mobile`).fill(mobile);
    if (whatsapp) await page.getByLabel(`${role} WhatsApp number`).fill(whatsapp);
    if (language) await page.getByLabel(`${role} preferred language`).selectOption(language);
  }
  await page.getByLabel('Warehouse designation').blur();
  await page.waitForTimeout(700);
  await shot(page, `T8-step5-contacts-${theme}`);
  await widths(page, `T8-step5-contacts-${theme}`);

  /* 10 — a cold reload. The draft comes back from the server, including a
     dispatch address that is not the facility's. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Name this site').first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  await shot(page, `T8-resumed-${theme}`);
  await widths(page, `T8-resumed-${theme}`);
}

/* ========================================================================== */

async function run(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  const who = account();
  await guard(page, `t8-${theme}`, async () => {
    await walkToStepFour(page, who, codes, identity, theme);
    await stepFour(page, theme);
    await stepFive(page, theme);
  });
  await context.close();
}

await mkdir(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
const browser = await chromium.launch();
let index = 0;
for (const theme of themes) {
  clearDevRateLimits();
  await run(browser, theme, (index += 1));
}
await browser.close();
console.log('done');
