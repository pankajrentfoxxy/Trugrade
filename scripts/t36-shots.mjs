/**
 * T36 review captures: the onboarding review queue and the review record,
 * every state, both themes, 1440 / 900 / 600.
 *
 * **Almost nothing here is stubbed.** The five applications are real rows
 * written by `prisma/seed/kyc-review.ts`, and every branch this task exists to
 * prove is reached by pointing the browser at a real one:
 *
 *   - Ambattur is genuinely 30 hours past our own 48-hour promise, carries a
 *     real GSTIN MISMATCH and a real penny-drop FAIL, and has two documents
 *     rejected with the reviewer's own sentence on them.
 *   - Kestrel carries two real `PROVIDER_ERROR` rows on its penny-drop followed
 *     by a PASS, which is the distinction the whole screen is built around.
 *   - Vasant Kunj is inside its promise with an unscanned document, so
 *     "Not scanned" renders beside files that were scanned.
 *   - Whitefield is a BUYER, so the board and the record both state 24 hours
 *     rather than the 48 this screen used to print over every row.
 *   - Chembur is genuinely REJECTED, with the reviewer's sentence on the record.
 *   - The documents refusal is captured by signing in as `ops@trugrade.in`, who
 *     holds `kyc.application.read` and not `kyc.document.read`. A real 403, not
 *     an intercepted one.
 *
 * ALSO ASSERTED, before any frame is believed: the queue's rows and the SLA
 * numbers are read live off the API in the same run, and the script fails if
 * the spread it needs is absent — one row inside the promise, one within twelve
 * hours of it, one past it, and both org types. A capture run against a stale
 * API build or an unseeded database is the failure mode this repo has hit more
 * than once, and a screenshot cannot tell you it happened.
 *
 * THE_ONLY_STUBS
 *   - queue-loading / queue-error / queue-empty: the review-queue GET is
 *     delayed, answered 500, and answered `[]`. A local API answers in ~30 ms,
 *     cannot be made to fail on demand, and the queue is never empty on a
 *     database with real applications on it.
 *   - record-error: the review GET is answered 500 for the same reason.
 *   Every stub intercepts the network and lets the real screen render it.
 *
 * A full run signs in eight times, which is close enough to the login limiter's
 * ceiling that a couple of manual curls alongside it will trip a 429 and the run
 * will stop on the assertion below rather than photograph a signed-out console.
 * Clear `rl:login-id:<email>` and `rl:login-ip:::1` in Redis and run it again.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const QUEUE = '**/api/kyc/review-queue*';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** KYC_REVIEWER: the queue AND the documents. */
const REVIEWER = 'kyc@trugrade.in';
/** OPS_MANAGER: the queue, and deliberately not the documents. */
const OPS = 'ops@trugrade.in';

const ORGS = {
  breached: '8b5efc72-71a3-426f-b90a-8dac907ce51b', // Ambattur — mismatch, fail, rejected docs
  providerError: '20ed3ce3-6892-43d0-ba70-09ff5f8be783', // Kestrel — two provider errors then a pass
  clean: 'd71038d5-2865-4169-a883-be706eb35ff6', // Vasant Kunj — inside the promise
  buyer: '45e5672e-2c2d-4c11-8e3d-5184b2eadff0', // Whitefield — a 24-hour promise
  rejected: '23df300e-0f29-4400-81d2-e69f489d7051', // Chembur — decided, with the sentence
};

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

/**
 * Open a screen, and re-sign-in once if the session has aged out mid-run.
 *
 * The console holds no client-side refresh, so a capture run long enough to
 * outlive an access token renders "did not load" on a screen that is perfectly
 * healthy — and a screenshot cannot tell you that is what happened. Reported
 * rather than fixed: it is console-wide, not this task's.
 */
async function openRecord(page, url, marker, email) {
  for (const attempt of [0, 1]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const found = await page.waitForSelector(marker, { timeout: 20000 }).catch(() => null);
    if (found) return;
    if (attempt === 0) {
      console.log('session aged out mid-run — signing in again');
      await signIn(page, email);
    }
  }
  throw new Error(`${url} never rendered ${marker}`);
}

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

/**
 * Sign in, and clear the second factor when the role demands one.
 *
 * OPS_MANAGER is in `MFA_REQUIRED_ROLES`, and it is also the **only** role that
 * holds `kyc.application.read` without `kyc.document.read` — which is the exact
 * pair this capture needs. So the documents-refusal frame is unreachable
 * without walking the OTP, and the code is read off the dev response the way
 * `t10-shots.mjs` reads it rather than out of a mailbox.
 */
async function signIn(page, email) {
  let devCode = null;
  const listener = async (response) => {
    if (!response.url().endsWith('/api/auth/mfa/otp')) return;
    const body = await response.json().catch(() => null);
    if (body?.devCode) devCode = body.devCode;
  };
  page.on('response', listener);

  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) {
    page.off('response', listener);
    return;
  }
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const challenge = await page
    .waitForSelector('text=One more code before you are in', { timeout: 8000 })
    .catch(() => null);
  if (challenge) {
    for (let i = 0; i < 40 && devCode === null; i += 1) await page.waitForTimeout(200);
    if (devCode === null) throw new Error(`no dev OTP came back for ${email}`);
    // The whole code into the first box: `OtpInput` deliberately has no
    // maxLength so a paste arrives whole and redistributes itself.
    await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
    await page.waitForTimeout(2000);
  }

  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
  page.off('response', listener);
}

/**
 * Read the API directly and refuse to photograph a database that cannot show
 * what the screens claim.
 *
 * The dev server has served a stale build during a capture run before, and a
 * screenshot of the old code is indistinguishable from a screenshot of the new
 * one until somebody reads the pixels closely. So the run asserts the payload.
 */
async function assertLiveSpread() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: REVIEWER, password: DEMO_PASSWORD }),
  });
  const { accessToken } = await login.json();
  const auth = { Authorization: `Bearer ${accessToken}` };

  const rows = await (await fetch(`${API}/api/kyc/review-queue`, { headers: auth })).json();
  if (!Array.isArray(rows)) throw new Error('review-queue did not return a list');

  const has = (predicate, what) => {
    if (!rows.some(predicate)) throw new Error(`no application ${what} — reseed before capturing`);
  };
  has((r) => r.slaHours === 48, 'on a 48-hour vendor promise');
  has((r) => r.slaHours === 24, 'on a 24-hour buyer promise');
  has((r) => r.slaBreached, 'past our promise');
  has((r) => !r.slaBreached && r.hoursRemaining <= 12, 'inside twelve hours of the promise');
  has((r) => !r.slaBreached && r.hoursRemaining > 12, 'comfortably inside the promise');
  has((r) => r.status === 'INFO_REQUESTED', 'waiting on the applicant');
  if (rows.some((r) => r.slaHours === undefined)) {
    throw new Error('slaHours is missing from the payload — the API is serving a stale build');
  }

  const record = await (
    await fetch(`${API}/api/kyc/review/${ORGS.providerError}`, { headers: auth })
  ).json();
  const outcomes = (record.checks ?? []).map((c) => c.outcome);
  if (!outcomes.includes('PROVIDER_ERROR')) {
    throw new Error('Kestrel carries no PROVIDER_ERROR — the one state this task exists for');
  }
  if (!outcomes.includes('PASS')) {
    throw new Error('Kestrel carries no PASS after its provider errors');
  }

  const mismatch = await (
    await fetch(`${API}/api/kyc/review/${ORGS.breached}`, { headers: auth })
  ).json();
  if (!(mismatch.checks ?? []).some((c) => c.outcome === 'MISMATCH')) {
    throw new Error('Ambattur carries no MISMATCH');
  }

  const docs = await (
    await fetch(`${API}/api/kyc/orgs/${ORGS.breached}/documents`, { headers: auth })
  ).json();
  if (!docs.some((d) => d.status === 'REJECTED')) throw new Error('no rejected document to show');
  const unscanned = await (
    await fetch(`${API}/api/kyc/orgs/${ORGS.clean}/documents`, { headers: auth })
  ).json();
  if (!unscanned.some((d) => d.avVerdict === null)) {
    throw new Error('every document is scanned — "Not scanned" cannot be photographed');
  }

  console.log(
    `live spread ok: ${rows.length} in the queue, ${rows.filter((r) => r.slaBreached).length} past our promise`,
  );
}

async function run() {
  await mkdir(OUT, { recursive: true });
  await assertLiveSpread();

  const browser = await chromium.launch();

  for (const theme of ['dark', 'light']) {
    // ---------------------------------------------------------------- reviewer
    {
      const { page, context } = await openPage(browser, theme);
      await signIn(page, REVIEWER);
      await assertTheme(page, theme);

      await openRecord(page, `${CONSOLE}/kyc`, 'table', REVIEWER);
      await capture(page, `T36-queue-${theme}`);

      // The board's state is in the URL, so this frame is also the proof of it.
      await openRecord(page, `${CONSOLE}/kyc?view=breached`, 'table', REVIEWER);
      await capture(page, `T36-queue-breached-${theme}`);

      await openRecord(page, `${CONSOLE}/kyc?view=buyer`, 'table', REVIEWER);
      await capture(page, `T36-queue-buyers-${theme}`);

      for (const [name, orgId] of Object.entries(ORGS)) {
        await openRecord(
          page,
          `${CONSOLE}/kyc/${orgId}`,
          'text=Automated verification',
          REVIEWER,
        );
        await page.waitForTimeout(500);
        await capture(page, `T36-record-${name}-${theme}`);
      }

      // The rejection form, with the sentence the applicant will read shown
      // back before it is sent.
      await openRecord(page, `${CONSOLE}/kyc/${ORGS.clean}`, 'text=Automated verification', REVIEWER);
      // The address proof, not the first row: the sentence typed below is about
      // an electricity bill, and a rejection reason that does not match the
      // document it is against is a confusing thing to leave in a review folder.
      await page
        .getByRole('row', { name: /Address proof/ })
        .getByRole('button', { name: 'Reject' })
        .first()
        .click();
      await page.waitForTimeout(300);
      await page.getByLabel('Reason').selectOption('TOO_OLD');
      await page
        .getByLabel('What is wrong with this particular file?')
        .fill('Your electricity bill is dated January 2026; we need one from the last three months.');
      await page.waitForTimeout(400);
      await capture(page, `T36-record-reject-form-${theme}`);

      await context.close();
    }

    // ------------------------------------------------------------------- stubs
    {
      const { page, context } = await openPage(browser, theme);
      await signIn(page, REVIEWER);

      await page.route(QUEUE, async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        // The navigation away cancels the request while this handler is still
        // sleeping, and Playwright throws on a route that is already gone.
        await route.continue().catch(() => undefined);
      });
      await page.goto(`${CONSOLE}/kyc`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await capture(page, `T36-queue-loading-${theme}`);
      await page.unroute(QUEUE);

      await page.route(QUEUE, (route) => route.fulfill({ status: 500, body: '{}' }));
      await page.goto(`${CONSOLE}/kyc`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await capture(page, `T36-queue-error-${theme}`);
      await page.unroute(QUEUE);

      await page.route(QUEUE, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.goto(`${CONSOLE}/kyc`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await capture(page, `T36-queue-clear-${theme}`);
      await page.unroute(QUEUE);

      await page.route('**/api/kyc/review/*', (route) => route.fulfill({ status: 500, body: '{}' }));
      await page.goto(`${CONSOLE}/kyc/${ORGS.clean}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await capture(page, `T36-record-error-${theme}`);

      await context.close();
    }

    // --------------------------------------------------- the documents refusal
    {
      const { page, context } = await openPage(browser, theme);
      await signIn(page, OPS);
      await openRecord(page, `${CONSOLE}/kyc/${ORGS.breached}`, 'text=Automated verification', OPS);
      await page.waitForTimeout(600);
      const refused = await page.getByText(/not cleared for this applicant/i).count();
      if (refused === 0) {
        throw new Error(
          'OPS_MANAGER was shown the documents — the permission split is not holding',
        );
      }
      await capture(page, `T36-record-documents-refused-${theme}`);
      await context.close();
    }
  }

  await browser.close();
  console.log('done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
