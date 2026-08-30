/**
 * T34 review captures: the ops overview, every state, both themes,
 * 1440 / 900 / 600.
 *
 * **Nothing on the loaded screens is stubbed.** Every number is read live out of
 * the dev database by the API, and the three slices below are three real
 * sign-ins rather than three fixtures:
 *
 *   - `ops@trugrade.in` (OPS_MANAGER) holds all six slice permissions and gets
 *     the whole screen. In `MFA_REQUIRED_ROLES`, so the run walks a real OTP.
 *   - `kyc@trugrade.in` (KYC_REVIEWER) holds one of them and gets the two
 *     application queues, no purchase orders and no tickets — the "others see
 *     their slice" branch, photographed rather than described.
 *   - `rider@trugrade.in` (RIDER) holds none, and gets the platform-wide
 *     partition runway and the sentence explaining why there are no queues.
 *
 * ASSERTED BEFORE ANY FRAME IS BELIEVED: the payload is read directly and the
 * run fails unless it carries at least one queue with a real promise AND at
 * least one with none — because the whole claim of this screen is that those
 * two render differently, and a database where every queue happens to have an
 * SLA would photograph as if the rule were not there. It also fails if the
 * reviewer's slice contains a key only the ops manager should have, which is
 * the leak a screenshot cannot show you.
 *
 * THE_ONLY_STUBS
 *   - overview-loading / overview-error: the dashboard GET is delayed and then
 *     answered 500. A local API answers in ~40 ms and cannot be made to fail on
 *     demand.
 *   - overview-nothing-late: the dashboard GET is answered with the real
 *     payload edited so every queue's `breachedCount` is 0. That is a state the
 *     product reaches on a good week and the seeded database cannot, and the
 *     component renders the response exactly as it would a real one.
 *   Every stub intercepts the network and lets the real screen render it.
 *
 * A full run signs in six times, close enough to the login limiter's ceiling
 * that a couple of manual curls alongside it will trip a 429. Clear
 * `rl:login-id:<email>` and `rl:login-ip:::1` in Redis and run it again.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const DASHBOARD = '**/api/ops/dashboard';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const OPS = 'ops@trugrade.in';
const REVIEWER = 'kyc@trugrade.in';
const RIDER = 'rider@trugrade.in';

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

/** Sign in, and clear the second factor when the role demands one. */
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
    await page.locator('[data-testid="otp-input"] input').first().fill(devCode);
    await page.waitForTimeout(2000);
  }

  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
  page.off('response', listener);
}

/** A Bearer token for one demo account, MFA cleared if the role needs it. */
async function tokenFor(email) {
  const jar = [];
  const keepCookies = (res) => {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) jar.push(c.split(';')[0]);
  };

  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  keepCookies(login);
  const session = await login.json();
  if (!session.accessToken) throw new Error(`${email} could not sign in: ${JSON.stringify(session)}`);
  if (!session.mfaRequired) return session.accessToken;

  const headers = { Authorization: `Bearer ${session.accessToken}`, Cookie: jar.join('; ') };
  const otp = await fetch(`${API}/api/auth/mfa/otp`, { method: 'POST', headers });
  keepCookies(otp);
  const { devCode } = await otp.json();
  const verified = await fetch(`${API}/api/auth/mfa/verify`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', Cookie: jar.join('; ') },
    body: JSON.stringify({ code: devCode }),
  });
  const done = await verified.json();
  if (!done.accessToken) throw new Error(`${email} could not clear MFA: ${JSON.stringify(done)}`);
  return done.accessToken;
}

const slice = async (email) => {
  const token = await tokenFor(email);
  const res = await fetch(`${API}/api/ops/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${email} got ${res.status} from the dashboard`);
  return res.json();
};

/**
 * Refuse to photograph a database that cannot show what the screen claims.
 *
 * The dev server has served a stale build during a capture run before, and a
 * screenshot of the old code looks exactly like a screenshot of the new one.
 */
async function assertLiveSpread() {
  const ops = await slice(OPS);

  const timed = ops.queues.filter((q) => q.slaHours !== null);
  const untimed = ops.queues.filter((q) => q.slaHours === null);
  if (timed.length === 0) throw new Error('no queue carries a real promise — nothing to compare');
  if (untimed.length === 0) {
    throw new Error(
      'every queue carries a promise, so "Breaches not measured" cannot be photographed',
    );
  }
  if (untimed.some((q) => q.breachedCount !== null)) {
    throw new Error('a queue with no promise is reporting a breach count');
  }
  if (!timed.some((q) => (q.breachedCount ?? 0) > 0)) {
    throw new Error('nothing is past a promise, so the breached rule cannot be photographed');
  }
  if (!ops.metrics.some((m) => m.key === 'partition-runway')) {
    throw new Error('no partition runway — the API is serving a stale build');
  }
  if (ops.gaps.length === 0) {
    throw new Error('no gaps returned — the "cannot yet tell you" section would not render');
  }

  const reviewer = await slice(REVIEWER);
  const reviewerKeys = [...reviewer.metrics, ...reviewer.queues].map((x) => x.key ?? x.label);
  for (const forbidden of ['po-unacknowledged', 'payout-runs', 'tickets']) {
    if (reviewerKeys.includes(forbidden)) {
      throw new Error(`a KYC reviewer is being shown ${forbidden} — the slice split is not holding`);
    }
  }

  const rider = await slice(RIDER);
  if (rider.queues.length !== 0) throw new Error('a rider is being shown queues');

  console.log(
    `live spread ok: ${ops.queues.length} queues (${timed.length} with a promise, ${untimed.length} without), ` +
      `${ops.metrics.length} metrics, ${ops.gaps.length} named gaps; reviewer sees ${reviewer.queues.length} queues, rider ${rider.queues.length}`,
  );
  return ops;
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const opsPayload = await assertLiveSpread();

  /** The same payload, on the week nobody let a promise slip. */
  const nothingLate = JSON.stringify({
    ...opsPayload,
    queues: opsPayload.queues.map((q) => ({
      ...q,
      breachedCount: q.breachedCount === null ? null : 0,
    })),
  });

  const browser = await chromium.launch();

  for (const theme of ['dark', 'light']) {
    for (const [who, email] of [
      ['ops', OPS],
      ['reviewer', REVIEWER],
      ['rider', RIDER],
    ]) {
      const { page, context } = await openPage(browser, theme);
      await signIn(page, email);
      await assertTheme(page, theme);

      await page.goto(`${CONSOLE}/overview`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="kpi-row"]', { timeout: 20000 });
      await page.waitForTimeout(400);
      await capture(page, `T34-overview-${who}-${theme}`);

      if (who === 'ops') {
        await page.route(DASHBOARD, (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: nothingLate }),
        );
        await page.goto(`${CONSOLE}/overview`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="kpi-row"]', { timeout: 20000 });
        await capture(page, `T34-overview-nothing-late-${theme}`);
        await page.unroute(DASHBOARD);

        await page.route(DASHBOARD, async (route) => {
          await new Promise((r) => setTimeout(r, 4000));
          await route.continue().catch(() => undefined);
        });
        await page.goto(`${CONSOLE}/overview`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await capture(page, `T34-overview-loading-${theme}`);
        await page.unroute(DASHBOARD);

        await page.route(DASHBOARD, (route) => route.fulfill({ status: 500, body: '{}' }));
        await page.goto(`${CONSOLE}/overview`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        await capture(page, `T34-overview-error-${theme}`);
        await page.unroute(DASHBOARD);
      }

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
