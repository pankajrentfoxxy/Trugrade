/**
 * T5 review captures: customer registration step 3, statutory. Both themes.
 *
 * Drives the real API. The outcomes are not stubbed — every GSTIN below is a
 * genuine 15-character number with a correct check digit, and the *check digit*
 * is what the fake GST adapter branches on (`kyc.fakes.ts`, `gstin.slice(-2)`):
 *
 *   …Z1  PASS            …Z2  MISMATCH        …Z3  cancelled registration
 *   …Z4  FAIL            …Z8  TIMEOUT         …Z9  PROVIDER_ERROR
 *
 * **Two accounts per theme, not one.** `VerificationService.checkForValueShopping`
 * pauses an application the moment it has seen three *distinct* GSTINs in
 * twenty-four hours, so one account cannot be shown a FAIL, a MISMATCH and a
 * PASS. Run A takes the refusals, run B takes the successful path — and the
 * pause itself is captured at the end of run A, because it is a state this
 * screen has to render and a real multi-GSTIN buyer will meet it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';

/**
 * A fresh statutory identity per run.
 *
 * `VerificationService.assertRetryAllowed` counts attempts by `input_hash`
 * alone — no org, no lead — so five successful checks of one PAN anywhere on
 * the platform lock that PAN out for twenty-four hours. Reusing a constant PAN
 * across runs therefore works exactly once. Each run mints its own, and derives
 * GSTINs from it by solving for the check digit the fake adapter branches on.
 */
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

/**
 * The 13th character is the registration serial, so it is free to vary — but the
 * format forbids `0` there, which leaves exactly one check digit unreachable for
 * any given state code. Hence the second loop: `VerificationService.stateName`
 * knows these eight, so an unreachable digit just moves the taxpayer one state.
 */
const STATE_CODES = ['06', '07', '09', '24', '27', '29', '33', '19'];

function gstinFor(pan, wantedCheckDigit) {
  for (const stateCode of STATE_CODES) {
    for (const serial of '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const first14 = `${stateCode}${pan}${serial}Z`;
      if (gstinCheckDigit(first14) === wantedCheckDigit) return first14 + wantedCheckDigit;
    }
  }
  throw new Error(`no GSTIN with check digit ${wantedCheckDigit} for ${pan}`);
}

/** 4th character C — the fake reports the holder as a COMPANY. */
function mintIdentity(runIndex) {
  const digits = String((Date.now() + runIndex * 7919) % 10000).padStart(4, '0');
  const letter = B36[10 + ((Date.now() + runIndex) % 26)];
  const pan = `AB${letter}C${letter}${digits}F`;
  const otherPan = `AB${letter}D${letter}${digits}F`;
  const pass = gstinFor(pan, '1');
  return {
    pan,
    gstin: {
      pass,
      mismatch: gstinFor(pan, '2'),
      cancelled: gstinFor(pan, '3'),
      fail: gstinFor(pan, '4'),
      providerError: gstinFor(pan, '9'),
      /** Valid in every way, but issued against a different PAN entirely. */
      otherPan: gstinFor(otherPan, '1'),
      /** Correct except for the check digit. Never leaves the browser. */
      badChecksum: pass.slice(0, 14) + (pass[14] === '9' ? '8' : '9'),
    },
  };
}

const LEGAL_NAME = 'Alpha Systems Private Limited';

const stamp = Date.now().toString().slice(-6);
let seq = 0;
function account(theme) {
  seq += 1;
  return {
    email: `t5.${theme}.${seq}.${stamp}@alpha-systems.co.in`,
    mobile: `9${(8100000 + Number(stamp) + seq * 11).toString().slice(-7)}${seq}${(seq * 3) % 10}`,
    password: 'Vermilion-Ledger-88!',
  };
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

const verify = (page) => page.getByRole('button', { name: 'Verify', exact: true }).first();

/** Steps 1 and 2, exactly as T4 verified them, to get to step 3. */
async function reachStatutory(page, who, codes) {
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Create account and continue');

  await page.getByLabel('Your full name').fill('Ananya Raghavan');
  await page.getByLabel('Company legal name').fill(LEGAL_NAME);
  await page.getByLabel('Work email').fill(who.email);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForSelector('text=The code is good for');
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('EMAIL'));
  await page.waitForSelector('text=Verified. We sent a code to');

  await page.getByLabel('Mobile').fill(who.mobile);
  await page.getByRole('button', { name: 'Send code' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('input[inputmode="numeric"]').first().fill(codes.get('MOBILE'));
  await page.waitForTimeout(800);

  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  try {
    await page.getByLabel('Year established').waitFor({ timeout: 30000 });
  } catch (error) {
    // A refusal here is a refusal from the API, and its wording is the only
    // thing that says which of the two identifiers was already taken.
    const alerts = await page.locator('[role="alert"]').allTextContents();
    console.log('[registration refused]', JSON.stringify(alerts));
    throw error;
  }
  await page.getByLabel('Year established').fill('2014');
  await page.getByLabel('Constitution').selectOption('PVT_LTD');
  await page.getByLabel('Industry').selectOption('IT_SERVICES');
  await page.getByLabel('Employees').selectOption('51-200');
  await page.getByLabel('Laptops bought in a year').selectOption('51-200');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByLabel('GSTIN 1').waitFor({ timeout: 30000 });
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.localStorage.setItem('tg-theme', t), theme);

  const codes = new Map();
  page.on('response', async (res) => {
    if (!res.url().includes('/auth/register/otp') || res.url().includes('verify')) return;
    const body = await res.json().catch(() => null);
    if (body?.devCode) codes.set(body.channel, body.devCode);
  });

  return { page, codes, context };
}

/* ------------------------------------------- run A: everything that refuses */

async function refusals(browser, theme, runIndex) {
  const { pan: PAN, gstin: GSTIN } = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);

  let holdMs = 0;
  await page.route('**/api/onboarding/verify/**', async (route) => {
    if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
    await route.continue().catch(() => {});
  });

  await reachStatutory(page, account(theme), codes);

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);

  /* 1 — nothing verified yet. */
  await shot(page, `T5-statutory-empty-${theme}`);

  /* 2 — the check digit does not match the rest. No provider call is made. */
  await page.getByLabel('GSTIN 1').fill(GSTIN.badChecksum);
  await verify(page).click();
  await page.waitForSelector('text=the last character does not match the rest');
  await shot(page, `T5-checksum-refused-${theme}`);

  /* 3 — the PAN inside the GSTIN belongs to somebody else. Also local. */
  await page.getByLabel('PAN').fill(PAN);
  await page.getByLabel('GSTIN 1').fill(GSTIN.otherPan);
  await verify(page).click();
  await page.waitForSelector('text=One of the two is from a different entity.');
  await shot(page, `T5-embedded-pan-conflict-${theme}`);

  /* 4 — checking, with the provider named. */
  holdMs = 4000;
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Asking the income-tax PAN service');
  await shot(page, `T5-checking-${theme}`);
  await page.waitForSelector('text=Held by', { timeout: 20000 });
  holdMs = 0;
  await shot(page, `T5-pan-verified-${theme}`);

  /* 5 — FAIL: the portal has no record of it. Theirs to fix, and it says how. */
  await page.getByLabel('GSTIN 1').fill(GSTIN.fail);
  await verify(page).click();
  await page.waitForSelector('text=Refused');
  await shot(page, `T5-gstin-fail-${theme}`);

  /* 6 — MISMATCH: registered, but to a name that is not theirs. */
  await page.getByLabel('GSTIN 1').fill(GSTIN.mismatch);
  await verify(page).click();
  await page.waitForSelector('text=Registered to a different name');
  await shot(page, `T5-gstin-mismatch-${theme}`);

  /* 7 — the third distinct value in a day pauses the application. */
  await page.getByLabel('GSTIN 1').fill(GSTIN.cancelled);
  await verify(page).click();
  await page.waitForSelector('text=Checks paused');
  await shot(page, `T5-value-shopping-paused-${theme}`);

  await context.close();
}

/* ------------------------------------- run B: the path that actually finishes */

async function success(browser, theme, runIndex) {
  const { pan: PAN, gstin: GSTIN } = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  await reachStatutory(page, account(theme), codes);

  /* 8 — PASS: the returned legal name, and the confirmation it asks for. */
  await page.getByLabel('PAN').fill(PAN);
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Held by', { timeout: 20000 });
  await page.getByLabel('GSTIN 1').fill(GSTIN.pass);
  await verify(page).click();
  await page.waitForSelector('text=Registered since');
  await shot(page, `T5-gstin-pass-${theme}`);

  /* 9 — PROVIDER_ERROR on a second registration: retrying, on a countdown. */
  await page.getByRole('button', { name: 'Add another GSTIN' }).click();
  await page.getByLabel('GSTIN 2').fill(GSTIN.providerError);
  await verify(page).click();
  await page.waitForSelector('text=Retrying automatically in');
  await shot(page, `T5-provider-error-retrying-${theme}`);

  /* 10 — the retries run out (5s + 15s + 45s) and it offers a way forward. */
  await page.waitForSelector('text=Continue — let a reviewer verify it', { timeout: 150000 });
  await shot(page, `T5-provider-error-exhausted-${theme}`);
  await page.getByRole('button', { name: 'Continue — let a reviewer verify it' }).click();
  await page.waitForSelector('text=Reviewer will check');
  await shot(page, `T5-provider-error-deferred-${theme}`);

  /* 11 — continue with no primary chosen. It is never chosen for them. */
  await page.getByLabel('Yes, this is our business').check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=Choose which registration we invoice.');
  await shot(page, `T5-primary-not-chosen-${theme}`);

  /* 12 — everything answered, primary picked, CIN in place. */
  await page.locator('input[name="primary-gstin"]').first().check();
  await page.getByLabel('CIN').fill('U72900HR2014PTC098765');
  await page.getByLabel('CIN').blur();
  await page.waitForTimeout(1200);
  await shot(page, `T5-ready-${theme}`);

  /* 13 — a cold resume shows what was already verified. */
  await page.goto(`${BASE}/register?step=STATUTORY`, { waitUntil: 'networkidle' });
  await page.getByLabel('GSTIN 1').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, `T5-resumed-${theme}`);

  /* 14 — breakpoints. */
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(500);
    await shot(page, `T5-resumed-${width}-${theme}`);
  }

  await context.close();
}

await mkdir(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
const browser = await chromium.launch();
let run = 0;
for (const theme of themes) {
  run += 1;
  await refusals(browser, theme, run);
  run += 1;
  await success(browser, theme, run);
}
await browser.close();
console.log('done');
