/**
 * T9 review captures: vendor registration steps 6 and 7, review and submission.
 * Both themes.
 *
 * Drives the real API. Nothing below is stubbed — the OTPs are real codes read
 * off the dev response, the registration creates a real VENDOR organisation, the
 * uploads are refused by `checkUpload`'s own magic-byte sniff, and every
 * penny-drop outcome is chosen by picking an account number the fake bank
 * adapter answers differently for (`kyc.fakes.ts`, `accountNumber.slice(-4)`):
 *
 *   …0009 → PROVIDER_ERROR   …0008 → FAIL (account closed)
 *   …0002 → FAIL (a name that is nothing like theirs)
 *   …0001 → MISMATCH (their name plus " Enterprises", scoring 0.80)
 *   anything else → PASS
 *
 * **One account per theme, and every shot comes off it.** The registration and
 * OTP rate limits are keyed on the caller's IP and nothing else, so a run that
 * registered per shot would lock the machine out mid-run.
 *
 * Steps 1 to 5 are walked with the same keystrokes T8 used, because the point of
 * this run is what happens after them.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';

/** Dev only, and the workaround rather than the fix. Reported by T6 and T7. */
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
    email: `t9.${seq}.${stamp}@northgate-recovery.co.in`,
    mobile: `9${(8100000 + Number(stamp) + seq * 13).toString().slice(-7)}${seq}${(seq * 7) % 10}`,
    password: 'Vermilion-Ledger-88!',
  };
}

/**
 * Bank account numbers. The last four digits pick the outcome; everything in
 * front of them only has to be unique, because `assertRetryAllowed` counts five
 * attempts a day per *value*.
 *
 * **Two of them per organisation, and no more.** `checkForValueShopping` pauses
 * an application at the THIRD distinct value for one check type in 24 hours —
 * and on a payout account that rule is exactly right: one company, one lawful
 * answer, so a third is a pattern. It is why this run registers twice per theme:
 * the first supplier reaches a PASS and finishes the flow, the second exists to
 * show the two refusals and the pause itself.
 */
function bankAccounts(runIndex, org) {
  const prefix = `5020${String((Date.now() + runIndex * 31 + org * 7717) % 100000000).padStart(8, '0')}`;
  return {
    providerError: `${prefix}0009`,
    pass: `${prefix}0007`,
    mismatch: `${prefix}0001`,
    fail: `${prefix}0002`,
    closed: `${prefix}0008`,
  };
}

/* ------------------------------------------------------------------ fixtures */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`,
  'latin1',
);

/** A JPEG renamed `.pdf`. This is what the magic-byte check catches. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });

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

/* ------------------------------------------------------------- steps 1 to 5 */

const section = (page, title) =>
  page.getByTestId('form-section').filter({ hasText: title }).first();

async function fillAddress(scope, values) {
  await scope.getByLabel('Building and street').first().fill(values.line1);
  await scope.getByLabel('Area or landmark').first().fill(values.line2);
  await scope.getByLabel('City').first().fill(values.city);
  await scope.getByLabel('PIN code').first().fill(values.pincode);
  await scope.getByLabel('State').first().selectOption(values.state);
}

async function fillHours(facility, opensAt, closesAt) {
  const hours = facility.getByRole('group', { name: /^Operating hours for site/ });
  await hours.getByLabel('Opens').first().fill(opensAt);
  await hours.getByLabel('Closes').first().fill(closesAt);
  await hours.getByRole('button', { name: /Copy Monday/ }).click();
  await hours.getByLabel('Closed').nth(6).check();
}

async function walkToStepSix(page, who, codes, identity, theme) {
  await page.goto(`${BASE}/sell/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Create account and continue');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);

  /* Step 1. */
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

  /* Step 4. */
  await page.getByLabel('Laptops you can supply in a month').waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: 'Business laptops' }).click();
  await page.getByRole('button', { name: 'Mobile workstations' }).click();
  await page.getByLabel('Laptops you can supply in a month').fill('300');
  await page.getByLabel('Grade A+', { exact: true }).fill('50');
  await page.getByLabel('Grade A', { exact: true }).fill('30');
  await page.getByLabel('Grade B', { exact: true }).fill('20');
  await page.getByLabel('Typical price, lowest').fill('14000');
  await page.getByLabel('Typical price, highest').fill('42000');
  await page.getByLabel('Corporate buy-back', { exact: true }).check();
  await page.getByLabel('ITAD contract', { exact: true }).check();
  await page.getByLabel('We test in-house').check();
  await page.getByLabel('Lead time, in days').fill('2');
  await page.getByLabel('we can send serials with the offer').check();
  await page.getByLabel('we pack and hand over to the carrier').check();
  await page.getByLabel('Lead time, in days').blur();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  /* Step 5. */
  await page.getByLabel('Name this site').first().waitFor({ timeout: 40000 });
  const site = page.getByTestId('facility').first();
  await site.getByLabel('Name this site').fill('Sector 37 warehouse');
  await site.getByLabel('What this site is').selectOption('WAREHOUSE');
  await site.getByLabel('Building and street').first().fill('Plot 61, Sector 37 Industrial Estate');
  await site.getByLabel('Area or landmark').first().fill('Pace City II');
  await site.getByLabel('City').first().fill('Gurugram');
  await site.getByLabel('PIN code').first().fill('122004');
  await site.getByLabel('State').first().selectOption('06');
  await site.getByTestId('dispatch').getByLabel('same address').check();
  await site.getByLabel('Machines this site can hold').fill('1200');
  await site.getByLabel('Largest vehicle that can reach the loading point').selectOption('TRUCK');
  await fillHours(site, '09:30', '18:00');

  const people = [
    ['Owner or director', 'Rohan Deshpande', 'Director', 'rohan', '9810011221'],
    ['Operations', 'Meera Iyer', 'Operations head', 'meera', '9810022332'],
    ['Finance', 'Anil Bhatt', 'Accounts manager', 'anil', '9810033443'],
  ];
  for (const [role, name, designation, mailbox, mobile] of people) {
    await page.getByLabel(`${role} contact name`).fill(name);
    await page.getByLabel(`${role} designation`).fill(designation);
    await page.getByLabel(`${role} email`).fill(`${mailbox}@northgate-recovery.co.in`);
    await page.getByLabel(`${role} mobile`).fill(mobile);
  }
  await page.getByLabel('Finance designation').blur();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByLabel(/^Account holder name/).waitFor({ timeout: 40000 });
}

/* ==========================================================================
 * Step 6 — documents and bank
 * ======================================================================== */

/** The nine uploaders, in the order `VENDOR_DOCUMENTS` lists them. */
const DOC_INPUT = {
  gst: 0,
  pan: 1,
  cheque: 2,
  addressProof: 3,
  incorporation: 4,
  signatoryId: 5,
  boardResolution: 6,
  cpcb: 7,
  iso: 8,
};

async function stepSix(page, theme, accounts) {
  const inputs = page.locator('input[type="file"]');

  /* 1 — nothing supplied. Nine uploaders, "0 of 7", "Not verified". */
  await shot(page, `T9-step6-empty-${theme}`);
  await widths(page, `T9-step6-empty-${theme}`);

  /* 2 — a file refused by its magic bytes: a JPEG called .pdf. The server's
     own sentence, against the file that caused it. */
  await inputs.nth(DOC_INPUT.pan).setInputFiles(file('pan_card.pdf', 'application/pdf', JPEG));
  await page.waitForSelector('text=/does not match|is not a/i', { timeout: 20000 });
  await shot(page, `T9-magic-bytes-refused-${theme}`);
  await widths(page, `T9-magic-bytes-refused-${theme}`);

  /* 3 — some of the nine supplied. The counter carries its denominator. */
  await inputs.nth(DOC_INPUT.gst).setInputFiles(file('gst_certificate.pdf', 'application/pdf', PDF));
  await inputs.nth(DOC_INPUT.pan).setInputFiles(file('pan_card.pdf', 'application/pdf', PDF));
  await inputs
    .nth(DOC_INPUT.signatoryId)
    .setInputFiles(file('signatory_id.png', 'image/png', PNG));
  await page.waitForTimeout(1800);
  await shot(page, `T9-step6-partly-supplied-${theme}`);
  await widths(page, `T9-step6-partly-supplied-${theme}`);

  /* The two age-limited types need the printed date before the file. */
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel('Date on the Cancelled cheque').fill(today);
  await page.getByLabel('Date on the Address proof').fill(today);
  await page.waitForTimeout(400);
  await inputs
    .nth(DOC_INPUT.cheque)
    .setInputFiles(file('cancelled_cheque.png', 'image/png', PNG));
  await inputs
    .nth(DOC_INPUT.addressProof)
    .setInputFiles(file('address_proof.pdf', 'application/pdf', PDF));
  await inputs
    .nth(DOC_INPUT.incorporation)
    .setInputFiles(file('incorporation.pdf', 'application/pdf', PDF));
  await inputs
    .nth(DOC_INPUT.boardResolution)
    .setInputFiles(file('board_resolution.pdf', 'application/pdf', PDF));
  await page.waitForTimeout(2500);

  /* ------------------------------------------------------------- the bank */

  await fillBank(page, accounts.providerError);

  /* 4 — the bank did not answer. Never a failure, never an attempt spent, and
     it counts down on screen. Captured DURING the wait. */
  await page.getByRole('button', { name: 'Check this account' }).click();
  await page.waitForSelector('text=Checking', { timeout: 5000 }).catch(() => {});
  await shot(page, `T9-pennydrop-checking-${theme}`);
  await page.waitForSelector('text=The bank did not answer', { timeout: 40000 });
  await shot(page, `T9-pennydrop-provider-error-${theme}`);
  await widths(page, `T9-pennydrop-provider-error-${theme}`);

  /* 5 — the account is theirs. The name the BANK returned is the headline. */
  await page.getByLabel(/^Account number/).fill(accounts.pass);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Check/ }).click();
  await page.waitForSelector('text=Bank confirmed', { timeout: 40000 });
  await shot(page, `T9-pennydrop-pass-${theme}`);
  await widths(page, `T9-pennydrop-pass-${theme}`);

  /* 6 — committed: the freeze and the owner alert, with the real instant. */
  await page.getByRole('button', { name: 'Save account and continue' }).click();
  await page.getByLabel(/^Accepted by/).waitFor({ timeout: 60000 });
}

async function fillBank(page, accountNumber) {
  await page.getByLabel(/^Account holder name/).fill(LEGAL_NAME);
  await page.getByLabel(/^IFSC/).fill('HDFC0001234');
  await page.getByLabel(/^Account number/).fill(accountNumber);
  await page.waitForTimeout(300);
}

/**
 * The second supplier: the two answers that are not a pass, and the pause that
 * follows a third distinct account.
 *
 * A separate organisation because `checkForValueShopping` allows two distinct
 * values per check type per day and pausing the first supplier would have ended
 * the run at step 6.
 */
async function refusedBankStates(page, theme, accounts) {
  await fillBank(page, accounts.mismatch);
  await page.getByRole('button', { name: 'Check this account' }).click();
  await page.waitForSelector('text=Held in a different name', { timeout: 40000 });
  await shot(page, `T9-pennydrop-mismatch-${theme}`);
  await widths(page, `T9-pennydrop-mismatch-${theme}`);

  await page.getByLabel(/^Account number/).fill(accounts.closed);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Check/ }).click();
  await page.waitForSelector('text=Refused', { timeout: 40000 });
  await shot(page, `T9-pennydrop-fail-${theme}`);
  await widths(page, `T9-pennydrop-fail-${theme}`);

  /* The third distinct account in a day. Rendered as what it is — the
     application is paused and a person will call — rather than as a red line
     under a field that is probably correct. */
  await page.getByLabel(/^Account number/).fill(accounts.fail);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Check/ }).click();
  await page.waitForSelector('text=/paused|too many times/i', { timeout: 40000 });
  await shot(page, `T9-pennydrop-paused-${theme}`);
  await widths(page, `T9-pennydrop-paused-${theme}`);
}

/* ==========================================================================
 * Step 7 — agreement and payout
 * ======================================================================== */

async function stepSeven(page, theme) {
  /* 9 — nothing accepted. Four "Not accepted yet", nothing pre-ticked. */
  await shot(page, `T9-step7-empty-${theme}`);
  await widths(page, `T9-step7-empty-${theme}`);

  /* 10 — a cycle the tier has not earned: said out loud, neither granted nor
     silently refused. */
  await page.getByLabel('Two working days after delivery').check();
  await page.waitForTimeout(400);
  await shot(page, `T9-cycle-not-earned-${theme}`);
  await widths(page, `T9-cycle-not-earned-${theme}`);

  /* 11 — every agreement accepted, and the commercial answers given. */
  for (const label of [
    'I accept the supplier agreement, version 1.0',
    'I accept the grading policy, version 1.0',
    'I accept the data-wipe undertaking, version 1.0',
    'I accept the returns and claims, version 1.0',
  ]) {
    await page.getByLabel(label).check();
  }
  await page.getByLabel('I name the amount I want').check();
  await page.getByLabel('Raise it for us — self-billed').check();
  await page.getByLabel('Email').check();
  await page.getByLabel('WhatsApp').check();
  await page.getByLabel(/^Language/).selectOption('EN');
  await page.waitForTimeout(500);
  await shot(page, `T9-step7-accepted-${theme}`);
  await widths(page, `T9-step7-accepted-${theme}`);

  await page.getByRole('button', { name: 'Accept and continue' }).click();
}

/* ==========================================================================
 * Review, submission and what comes back
 * ======================================================================== */

async function reviewAndSubmit(page, theme) {
  /* 12 — the review screen: seven steps, every answer read back. */
  await page.getByRole('button', { name: 'Submit for review' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await shot(page, `T9-review-${theme}`);
  await widths(page, `T9-review-${theme}`);

  /* 13 — submitted. The SLA clock, and where each step stands. */
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.waitForSelector('text=Your application is with our team', { timeout: 60000 });
  await page.waitForTimeout(600);
  await shot(page, `T9-submitted-${theme}`);
  await widths(page, `T9-submitted-${theme}`);
}

/**
 * 14 — NEEDS_FIX with a reviewer's own sentence.
 *
 * Sent back through the **real** reviewer route by a **real** reviewer session:
 * `kyc@trugrade.in` from the demo seed holds `kyc.application.review`, and
 * `POST /kyc/orgs/:orgId/steps/:stepKey/request-fix` is the only thing that
 * writes `blocking_reason`. The sentence on the applicant's screen is therefore
 * read back out of the database, not injected by this script — which is the
 * whole point of the capture.
 */
async function sendBack(browser, applicant, theme, reason) {
  const orgId = await applicant.evaluate(async () => {
    const res = await fetch('/api/onboarding/steps', { credentials: 'include' });
    const body = await res.json();
    return body.orgId ?? null;
  });
  if (!orgId) {
    console.log('[skipped] NEEDS_FIX: could not read the applicant orgId.');
    return false;
  }

  const reviewer = await browser.newContext({ baseURL: 'http://localhost:4000' });
  const login = await reviewer.request.post('/api/auth/login', {
    data: { email: 'kyc@trugrade.in', password: 'Trugrade!Demo2026' },
  });
  if (!login.ok()) {
    console.log(`[skipped] NEEDS_FIX: the reviewer could not sign in (${login.status()}).`);
    await reviewer.close();
    return false;
  }
  const sent = await reviewer.request.post(
    `/api/kyc/orgs/${orgId}/steps/DOCUMENTS_BANK/request-fix`,
    { data: { blockingReason: reason } },
  );
  await reviewer.close();
  if (!sent.ok()) {
    console.log(`[skipped] NEEDS_FIX: request-fix refused (${sent.status()}).`);
    return false;
  }

  await applicant.reload({ waitUntil: 'domcontentloaded' });
  await applicant.waitForSelector('text=sent back', { timeout: 40000 });
  await shot(applicant, `T9-needs-fix-${theme}`);
  await widths(applicant, `T9-needs-fix-${theme}`);
  return true;
}

/* ========================================================================== */

const REVIEWER_REASON =
  'The cancelled cheque is for account ••••4417 — that isn’t the account you typed. Send one for the account you actually want paying, or correct the number.';

async function run(browser, theme, runIndex) {
  /* The supplier who gets all the way through. */
  const { page, codes, context } = await openPage(browser, theme);
  await guard(page, `t9-${theme}`, async () => {
    await walkToStepSix(page, account(), codes, mintIdentity(runIndex), theme);
    await stepSix(page, theme, bankAccounts(runIndex, 1));
    await stepSeven(page, theme);
    await reviewAndSubmit(page, theme);
    await sendBack(browser, page, theme, REVIEWER_REASON);
  });
  await context.close();

  /* A second supplier, for the three answers the first one never sees. */
  const second = await openPage(browser, theme);
  await guard(second.page, `t9-refused-${theme}`, async () => {
    await walkToStepSix(second.page, account(), second.codes, mintIdentity(runIndex + 50), theme);
    await refusedBankStates(second.page, theme, bankAccounts(runIndex, 2));
  });
  await second.context.close();
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
