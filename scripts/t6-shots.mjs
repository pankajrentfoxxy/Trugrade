/**
 * T6 review captures: customer registration steps 4 and 5, the review screen,
 * submission and everything after it. Both themes.
 *
 * Drives the real API — the uploads are real multipart requests and every
 * refusal below is the server's own sentence, not a stub. The two refusals worth
 * saying something about:
 *
 *   **Magic bytes.** A JPEG is renamed `.pdf` and sent with
 *   `Content-Type: application/pdf`, which is exactly what `sniffMime` exists to
 *   catch — the declared type and the leading bytes disagree.
 *
 *   **Document age.** None of the four documents a buyer is asked for is
 *   age-limited (`max_age_days` is NULL for all four), so the age rule cannot
 *   fire on this step as seeded. The capture therefore does what ops would do —
 *   it sets `max_age_days` on SIGNATORY_ID, takes the shot, and puts it back.
 *   That the form grows a date field and an age rule from a row in
 *   `document_type_rule` is the point of rendering the checklist from data.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const BASE = 'http://localhost:3000';
const API = 'http://localhost:4000';

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

/** The fake GST adapter branches on the check digit; `1` is a PASS. */
const STATE_CODES = ['06', '07', '09', '24', '27', '29', '33', '19'];

/** Every GSTIN for this PAN with the wanted check digit, one per state. */
function gstinsFor(pan, wanted) {
  const found = [];
  for (const stateCode of STATE_CODES) {
    for (const serial of '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const first14 = `${stateCode}${pan}${serial}Z`;
      if (gstinCheckDigit(first14) === wanted) {
        found.push({ gstin: first14 + wanted, stateCode });
        break;
      }
    }
  }
  return found;
}

function mintIdentity(runIndex) {
  const digits = String((Date.now() + runIndex * 7919) % 10000).padStart(4, '0');
  const letter = B36[10 + ((Date.now() + runIndex) % 26)];
  const pan = `AB${letter}C${letter}${digits}F`;
  return { pan, passing: gstinsFor(pan, '1') };
}

const LEGAL_NAME = 'Alpha Systems Private Limited';

const stamp = Date.now().toString().slice(-6);
let seq = 0;
function account(theme) {
  seq += 1;
  return {
    email: `t6.${theme}.${seq}.${stamp}@alpha-systems.co.in`,
    mobile: `9${(8100000 + Number(stamp) + seq * 11).toString().slice(-7)}${seq}${(seq * 3) % 10}`,
    password: 'Vermilion-Ledger-88!',
  };
}

/* ------------------------------------------------------------------ fixtures */

/** A real 1x1 PNG. Valid magic bytes, valid file. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A real, minimal, single-page PDF with no active content. */
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

/** A JPEG. Renamed `.pdf` below, which is what the magic-byte check catches. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

/**
 * A 1 MB PDF, for the in-flight capture.
 *
 * Trailing bytes after `%%EOF` are ignored by every reader, and `checkUpload`
 * sniffs the header and scans the first 512 KB for active content — so this is a
 * genuinely valid file that takes a measurable time to send.
 */
const BIG_PDF = Buffer.concat([PDF, Buffer.alloc(1_000_000, 0x20)]);

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });

/* -------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

const sql = (statement) =>
  execFileSync('docker', ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-c', statement], {
    encoding: 'utf8',
  });

/** Sign in as the seeded KYC reviewer and send one step back, for real. */
async function requestFix(orgId, stepCode, reason) {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kyc@trugrade.in', password: 'Trugrade!Demo2026' }),
  });
  const { accessToken } = await login.json();
  const res = await fetch(`${API}/api/kyc/orgs/${orgId}/steps/${stepCode}/request-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ blockingReason: reason }),
  });
  if (!res.ok) throw new Error(`request-fix failed: ${res.status} ${await res.text()}`);
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

/* ------------------------------------------------- steps 1 to 3, as verified */

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

  await page.getByLabel('Year established').waitFor({ timeout: 30000 });
  await page.getByLabel('Year established').fill('2014');
  await page.getByLabel('Constitution').selectOption('PVT_LTD');
  await page.getByLabel('Industry').selectOption('IT_SERVICES');
  await page.getByLabel('Employees').selectOption('51-200');
  await page.getByLabel('Laptops bought in a year').selectOption('51-200');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByLabel('GSTIN 1').waitFor({ timeout: 30000 });
}

/** Step 3, with TWO registrations so step 4 shows two billing addresses. */
async function finishStatutory(page, identity) {
  await page.getByLabel('PAN').fill(identity.pan);
  await page.getByRole('button', { name: 'Verify PAN' }).click();
  await page.waitForSelector('text=Held by', { timeout: 20000 });

  await page.getByLabel('GSTIN 1').fill(identity.passing[0].gstin);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForSelector('text=Registered since');
  await page.getByLabel('Yes, this is our business').first().check();

  await page.getByRole('button', { name: 'Add another GSTIN' }).click();
  await page.getByLabel('GSTIN 2').fill(identity.passing[1].gstin);
  await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.getByLabel('Yes, this is our business').nth(1).check();

  await page.locator('input[name="primary-gstin"]').first().check();
  await page.getByLabel('CIN').fill('U72900HR2014PTC098765');
  await page.getByLabel('CIN').blur();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Procurement contact name').waitFor({ timeout: 30000 });
}

/* ------------------------------------------------------------------- step 4 */

/** A city and PIN in each state the fake registrations can land in. */
const STATE_CITY = {
  '06': ['Gurugram', '122015'],
  '07': ['New Delhi', '110020'],
  '09': ['Noida', '201301'],
  '19': ['Kolkata', '700091'],
  '24': ['Ahmedabad', '380015'],
  '27': ['Pune', '411057'],
  '29': ['Bengaluru', '560103'],
  '33': ['Chennai', '600032'],
};

async function fillContacts(page, identity) {
  for (const [role, name, email] of [
    ['Procurement', 'Devika Menon', 'devika.menon@alpha-systems.co.in'],
    ['Finance', 'Harish Patel', 'harish.patel@alpha-systems.co.in'],
    ['IT', 'Sana Qureshi', 'sana.qureshi@alpha-systems.co.in'],
  ]) {
    await page.getByLabel(`${role} contact name`).fill(name);
    await page.getByLabel(`${role} email`).fill(email);
    await page.getByLabel(`${role} mobile`).fill('9810012345');
  }

  const billing = page.getByTestId('billing-address');
  const count = await billing.count();
  for (let i = 0; i < count; i += 1) {
    const card = billing.nth(i);
    // The state is pre-selected from the GSTIN's own state code, so the city has
    // to belong to that state or the address is nonsense on the invoice.
    const [city, pincode] = STATE_CITY[identity.passing[i].stateCode] ?? ['Gurugram', '122015'];
    await card.getByLabel('Building and street').fill(`Plot ${44 + i}, Industrial Area Phase IV`);
    await card.getByLabel('City').fill(city);
    await card.getByLabel('PIN code').fill(pincode);
  }

  const delivery = page.getByTestId('delivery-address');
  const [city, pincode] = STATE_CITY[identity.passing[0].stateCode] ?? ['Gurugram', '122015'];
  await fillDelivery(delivery.first(), {
    label: 'Head office',
    line1: 'Plot 44, Udyog Vihar Phase IV',
    city,
    pincode,
    state: identity.passing[0].stateCode,
    landmark: 'Opposite the Maruti gate 2',
    contact: 'Ramesh Yadav',
  });
}

async function fillDelivery(card, values) {
  await card.getByLabel('Name this address').fill(values.label);
  await card.getByLabel('Building and street').fill(values.line1);
  await card.getByLabel('City').fill(values.city);
  await card.getByLabel('PIN code').fill(values.pincode);
  await card.getByLabel('State').selectOption(values.state);
  await card.getByLabel('Landmark').fill(values.landmark);
  await card.getByLabel('Who signs for it').fill(values.contact);
  await card.getByLabel('Their mobile').fill('9820011223');
  await card.getByLabel('Gate instructions').fill('Gate 3, ask for the security desk. No entry after 17:30.');
  await card.getByLabel('Receiving days').selectOption('MON_SAT');
  await card.getByLabel('Opens at').fill('09:30');
  await card.getByLabel('Closes at').fill('18:00');
}

/* ------------------------------------------------------------------- step 5 */

/* ==========================================================================
 * The run
 * ======================================================================== */

async function fullPath(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  await reachStatutory(page, account(theme), codes);
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
  await finishStatutory(page, identity);

  /* 1 — step 4, nothing entered. */
  await shot(page, `T6-step4-empty-${theme}`);

  /* 2 — contacts, two billing addresses, two delivery addresses. */
  await fillContacts(page, identity);
  await page.getByRole('button', { name: 'Add another delivery address' }).click();
  await fillDelivery(page.getByTestId('delivery-address').nth(1), {
    label: 'Chennai office',
    line1: '7th floor, Olympia Teknos, Guindy',
    city: 'Chennai',
    pincode: '600032',
    state: '33',
    landmark: 'Behind the Guindy railway station',
    contact: 'Lakshmi Narayanan',
  });
  await page.getByTestId('delivery-address').nth(1).getByLabel('Landmark').blur();
  await page.waitForTimeout(900);
  await shot(page, `T6-step4-two-deliveries-${theme}`);

  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `T6-step4-${width}-${theme}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });

  /* 3 — step 5, nothing uploaded. */
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=GST registration certificate', { timeout: 30000 });
  await shot(page, `T6-step5-empty-${theme}`);

  /* 4 — a file genuinely in flight, at a real percentage.
     The upload is throttled through CDP rather than the response being held, so
     the bar shows a partial number rather than 100% waiting for a reply. */
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 220_000,
  });

  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(file('gst_certificate.pdf', 'application/pdf', BIG_PDF));
  await page.waitForSelector('role=progressbar');
  await page.waitForTimeout(2200);
  await shot(page, `T6-upload-in-flight-${theme}`);
  await page.waitForSelector('text=With our team', { timeout: 60000 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  /* 5 — a JPEG renamed .pdf. Refused on its bytes, named in the message. */
  await inputs.nth(1).setInputFiles(file('pan_card.pdf', 'application/pdf', JPEG));
  await page.waitForSelector("text=doesn't look like a valid", { timeout: 30000 });
  await shot(page, `T6-magic-bytes-refused-${theme}`);

  /* 6 — the rest of the checklist, honestly uploaded. */
  await inputs.nth(1).setInputFiles(file('pan_card.pdf', 'application/pdf', PDF));
  await page.waitForTimeout(2000);
  await inputs.nth(2).setInputFiles(file('signatory_id.png', 'image/png', PNG));
  await page.waitForTimeout(2000);
  await inputs.nth(3).setInputFiles(file('po_template.pdf', 'application/pdf', PDF));
  await page.waitForTimeout(2000);

  await page.getByLabel('Email', { exact: true }).check();
  await page.getByLabel('WhatsApp').check();
  await page.getByLabel('Language').selectOption('EN');
  await page.waitForTimeout(600);
  await shot(page, `T6-step5-complete-${theme}`);

  /* 7 — the review screen, everything answered. */
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForSelector('text=Submit for review', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot(page, `T6-review-${theme}`);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `T6-review-${width}-${theme}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });

  /* 8 — submitted, with the SLA clock. */
  const orgId = await page.evaluate(async () => {
    const res = await fetch('/api/onboarding/steps', { credentials: 'include' });
    return (await res.json()).orgId;
  });
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.waitForSelector('text=Decision due by', { timeout: 30000 });
  await shot(page, `T6-submitted-${theme}`);

  /* 9 — a reviewer sends a step back. Their words, verbatim. */
  await requestFix(
    orgId,
    'DOCUMENTS',
    'The PAN card you sent is a photo of a director’s personal PAN. We need the PAN of Alpha Systems Private Limited itself — the ten-character number printed on your GST certificate.',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=sent back', { timeout: 30000 });
  await shot(page, `T6-needs-fix-${theme}`);

  await context.close();
}

/** A second account that walks to the review screen with steps 4 and 5 open. */
async function reviewWithGap(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  const { page, codes, context } = await openPage(browser, theme);
  await reachStatutory(page, account(theme), codes);
  await finishStatutory(page, identity);

  // Half of step 4, then straight to the review screen.
  await page.getByLabel('Procurement contact name').fill('Devika Menon');
  await page.getByLabel('Procurement email').fill('devika.menon@alpha-systems.co.in');
  await page.getByLabel('Procurement mobile').fill('9810012345');
  await page.getByLabel('Procurement mobile').blur();
  await page.waitForTimeout(900);

  await page.goto(`${BASE}/register?step=REVIEW`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Submit for review', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot(page, `T6-review-with-gap-${theme}`);

  await context.close();
}

/**
 * The age rule, made reachable the way ops would make it reachable: a row in
 * `document_type_rule`. Put back immediately afterwards.
 */
async function ageRefusal(browser, theme, runIndex) {
  const identity = mintIdentity(runIndex);
  sql("UPDATE kyc.document_type_rule SET max_age_days = 90 WHERE doc_type = 'SIGNATORY_ID';");
  const { page, codes, context } = await openPage(browser, theme);
  try {
    await reachStatutory(page, account(theme), codes);
    await finishStatutory(page, identity);
    await fillContacts(page, identity);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForSelector('text=Authorised signatory ID', { timeout: 30000 });

    await page.getByLabel('Date on the authorised signatory id').fill('2025-01-15');
    await page.locator('input[type="file"]').nth(2).setInputFiles(file('signatory_id.png', 'image/png', PNG));
    await page.waitForSelector('text=we need one issued in the last', { timeout: 30000 });
    await shot(page, `T6-age-refused-${theme}`);
  } finally {
    sql("UPDATE kyc.document_type_rule SET max_age_days = NULL WHERE doc_type = 'SIGNATORY_ID';");
    await context.close();
  }
}

await mkdir(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
const only = process.env.ONLY;
const browser = await chromium.launch();
let run = 0;
for (const theme of themes) {
  if (!only || only === 'full') await fullPath(browser, theme, (run += 1));
  if (!only || only === 'gap') await reviewWithGap(browser, theme, (run += 1));
  if (!only || only === 'age') await ageRefusal(browser, theme, (run += 1));
}
await browser.close();
console.log('done');
