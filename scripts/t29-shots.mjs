/**
 * T29 review captures: the vendor's bulk serial upload and its dry run. Every
 * state, both themes, 1440 / 900 / 600.
 *
 * **The commit is real.** The dark run uploads a partly-bad file to a live draft
 * listing and presses the button, so `T29-committed-dark` photographs machines
 * that were actually written — and the reconciliation line under it is the API's
 * own answer compared against the promise the report made a second earlier.
 *
 * **It asserts the thing the whole task is about, live**: the number in the
 * dry-run sentence, the number on the button and the number the commit reports
 * are one number. Those were three different numbers before T29 — the sentence
 * printed clean rows, the button offered clean + warned, and the commit could
 * refuse the whole file for a reason the report never mentioned.
 *
 * THE_ONLY_STUBS
 *   - upload-loading / upload-error: the dry-run POST is delayed, then answered
 *     500. A local API answers in ~20 ms and cannot be made to fail on demand.
 *   - near-capacity: `listing.qty_total` on one DRAFT listing is set to 4,998
 *     for the duration of the capture and put back afterwards. The alternative
 *     is inserting 4,998 units, which is the same state reached slowly. The
 *     screen renders the real API response either way.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const DRY_RUN = '**/serials/validate-csv';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const NORTHGATE = 'ops@northgate.example';

/** Northgate's two DRAFT listings, read out of the dev database. */
const DRAFT = '8a6da557-3694-41f6-852d-6ab986de25bf';
const NEAR_FULL = 'c1d6dcbb-8c14-4b8e-aa10-443fe4bb7086';
/** An ACTIVE listing: units can only be added while a listing is a draft. */
let PAST_DRAFT = '';

const psql = (sql) => {
  const container = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split('\n')
    .find((n) => /postgres/i.test(n));
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'trugrade', '-d', 'trugrade', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();
};

/** A serial nobody has used, so the run is repeatable against a live database. */
const serial = () => `T29${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * A file with something of everything: good rows, a duplicate, a blank line and
 * a row that is not a serial at all — with the blank ABOVE the bad rows, so the
 * line numbers in the report are only right if blanks do not renumber.
 */
function mixedCsv() {
  const a = serial();
  return {
    csv: ['serial_number', a, serial(), '', serial(), a, 'no'].join('\n'),
    // Lines 2, 3 and 5 are accepted; line 4 is blank and is skipped WITHOUT
    // renumbering anything after it; line 6 duplicates line 2 and line 7 is not
    // a serial. So 3 in and 2 errors — and the report has to say 6 and 7.
    expectAdded: 3,
  };
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(300);
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { page, context };
}

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

async function signIn(page, email) {
  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) return;
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
}

async function open(page, path, ready, email) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(ready, { timeout: 20000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await signIn(page, email);
    }
  }
}

const upload = async (page, name, body) => {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'),
  });
};

/**
 * The sentence, the button and the commit have to be quoting one number.
 *
 * Read off the rendered page rather than off the API, because the defect this
 * task fixed lived entirely in the gap between them: the report was correct, the
 * commit was correct, and the screen described them with two different words.
 */
async function assertOneNumber(page) {
  const summary = await page.getByTestId('dry-run-summary').textContent();
  const button = await page.getByRole('button', { name: /^(Add \d+ machines?|Nothing to add yet)$/ }).textContent();
  const promised = Number(summary.match(/^(\d+) of/)?.[1]);
  const offered = Number(button.match(/Add (\d+)/)?.[1] ?? 0);
  if (!Number.isFinite(promised)) throw new Error(`could not read the promise from "${summary}"`);
  if (promised !== offered) {
    throw new Error(`the sentence promises ${promised} and the button offers ${offered}`);
  }
  console.log(`  dry run promises ${promised}, button offers ${offered}: one number`);
  return promised;
}

async function run(browser, theme, { commit }) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, NORTHGATE);

  // ---- before a file is chosen -------------------------------------------
  await open(page, `/vendor/listings/${DRAFT}/bulk-upload`, 'input[type="file"]', NORTHGATE);
  await assertTheme(page, theme);
  await capture(page, `T29-empty-${theme}`);

  // ---- a renamed workbook, refused on its first four bytes ---------------
  await upload(page, 'stock.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08]));
  await page.waitForSelector('text=is an Excel workbook', { timeout: 10000 });
  await capture(page, `T29-refused-workbook-${theme}`);

  // ---- a clean file ------------------------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="file"]');
  await upload(page, 'clean.csv', ['serial_number', serial(), serial(), serial()].join('\n'));
  await page.waitForSelector('[data-testid="dry-run-summary"]', { timeout: 15000 });
  await assertOneNumber(page);
  await capture(page, `T29-dry-run-clean-${theme}`);

  // ---- a file that is partly bad, which is the whole point of a dry run ---
  const mixed = mixedCsv();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="file"]');
  await upload(page, 'mixed.csv', mixed.csv);
  await page.waitForSelector('[data-testid="dry-run-summary"]', { timeout: 15000 });
  const promised = await assertOneNumber(page);
  if (promised !== mixed.expectAdded) {
    throw new Error(`expected ${mixed.expectAdded} accepted rows, the screen promised ${promised}`);
  }
  await capture(page, `T29-dry-run-partly-bad-${theme}`);

  // ---- the commit, for real ----------------------------------------------
  if (commit) {
    await page.getByRole('button', { name: /^Add \d+ machines?$/ }).click();
    await page.waitForSelector('text=the dry run promised', { timeout: 20000 });
    const line = await page.locator('[role="status"]').first().textContent();
    const added = Number(line.match(/^(\d+) of the/)?.[1]);
    if (added !== promised) {
      throw new Error(`the dry run promised ${promised} and the commit added ${added}`);
    }
    console.log(`  committed ${added} of ${promised} promised: the promise held`);
    await capture(page, `T29-committed-${theme}`);
  }

  // ---- a listing past drafting -------------------------------------------
  await open(page, `/vendor/listings/${PAST_DRAFT}/bulk-upload`, 'input[type="file"]', NORTHGATE);
  await page.waitForTimeout(400);
  await capture(page, `T29-past-drafting-${theme}`);

  await upload(page, 'clean.csv', ['serial_number', serial(), serial()].join('\n'));
  await page.waitForSelector('text=only be added while a listing is still a draft', { timeout: 15000 });
  await capture(page, `T29-past-drafting-file-${theme}`);

  // ---- a listing with almost no room left --------------------------------
  psql(`UPDATE listing.listing SET qty_total = 4998 WHERE id = '${NEAR_FULL}'`);
  try {
    await open(page, `/vendor/listings/${NEAR_FULL}/bulk-upload`, 'input[type="file"]', NORTHGATE);
    await upload(page, 'toomany.csv', ['serial_number', serial(), serial(), serial(), serial()].join('\n'));
    await page.waitForSelector('[data-testid="dry-run-summary"]', { timeout: 15000 });
    const fits = await assertOneNumber(page);
    if (fits !== 2) throw new Error(`two should fit under the cap, the screen promised ${fits}`);
    await capture(page, `T29-over-capacity-${theme}`);
  } finally {
    psql(`UPDATE listing.listing SET qty_total = 3 WHERE id = '${NEAR_FULL}'`);
  }

  await context.close();
}

async function loadingAndError(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, NORTHGATE);

  await page.route(DRY_RUN, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await open(page, `/vendor/listings/${DRAFT}/bulk-upload`, 'input[type="file"]', NORTHGATE);
  await upload(page, 'clean.csv', ['serial_number', serial()].join('\n'));
  await page.waitForTimeout(1200);
  await capture(page, `T29-checking-${theme}`);
  await page.unroute(DRY_RUN);

  await page.route(DRY_RUN, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="file"]');
  await upload(page, 'clean.csv', ['serial_number', serial()].join('\n'));
  await page.waitForSelector('[role="alert"]', { timeout: 15000 });
  await capture(page, `T29-dry-run-error-${theme}`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // The trap that has cost this build two capture runs. A 404 on the scoped dry
  // run means the process on :4000 predates it, and every frame below would be
  // a photograph of behaviour that no longer exists.
  const probe = await fetch(`${API}/api/vendor/listings/${DRAFT}/serials/validate-csv`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"csv":"a"}',
  });
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — it does not know the scoped dry run');
  }
  console.log(`api POST :id/serials/validate-csv -> ${probe.status} (not 404: the build is current)`);

  PAST_DRAFT = psql(
    `SELECT id FROM listing.listing WHERE vendor_org_id =
       (SELECT org_id FROM identity.user_account WHERE email = '${NORTHGATE}')
      AND status <> 'DRAFT' ORDER BY created_at LIMIT 1`,
  );
  if (!PAST_DRAFT) throw new Error('no non-draft listing on Northgate to photograph');
  console.log(`past-drafting listing: ${PAST_DRAFT}`);

  // Phases can be named on the command line so a run that lost its session
  // half way through is resumed rather than repeated — repeating it would
  // commit a second batch of machines to a live listing for no new frame.
  //   node scripts/t29-shots.mjs light states
  const want = process.argv.slice(2);
  const wanted = (phase) => want.length === 0 || want.includes(phase);

  const browser = await chromium.launch();
  try {
    // The commit happens once, in the dark run. The light run photographs the
    // same states against fresh serials without writing again.
    if (wanted('dark')) await run(browser, 'dark', { commit: !process.env.NO_COMMIT });
    if (wanted('light')) await run(browser, 'light', { commit: false });
    if (wanted('states')) for (const theme of ['dark', 'light']) await loadingAndError(browser, theme);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
