/**
 * T10 review captures: signing in, both portals, and every surrounding state.
 * Both themes, 1440 / 900 / 600.
 *
 * Nothing here is stubbed. The OTPs are real codes read off the dev response,
 * the accounts are created through `POST /auth/register` with real verified
 * contacts, the rejection is written by a real reviewer through
 * `POST /kyc/orgs/:id/decision`, and the rate-limited screen is reached by
 * actually spending the budget — six wrong passwords against one address, which
 * is what `SESSION_POLICY.loginFailuresPerEmail` allows five of.
 *
 * Two states are set with SQL rather than through a route, and it is worth being
 * explicit about which: `organization.status = KYC_SUBMITTED` and
 * `= SUSPENDED`. The first has no route that does not require walking all seven
 * steps; the second has no route at all (`IdentityService.suspendOrganization`
 * is not exposed by any controller — reported). Everything the screenshots then
 * show is the real server reading those rows: the 403 on a suspended sign-in is
 * genuinely thrown by `completeLogin`, not painted on.
 *
 * **The fixtures are created once and reused across both themes.** The
 * registration and OTP rate limits are keyed on the caller's IP and nothing
 * else, so a run that registered per theme would lock the machine out halfway
 * through the light pass — which is exactly what happened to T6.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const PASSWORD = 'Vermilion-Ledger-88!';
const NEW_PASSWORD = 'Kestrel-Harbour-2026!';

/* -------------------------------------------------------------- dev plumbing */

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();

const redisDel = (key) =>
  execFileSync('docker', ['exec', 'trugrade-redis', 'redis-cli', 'del', key], {
    encoding: 'utf8',
  });

/**
 * Dev only, and the workaround rather than the fix. Every one of these budgets
 * is keyed on the IP alone, so one capture run looks exactly like one abusive
 * office. Reported by T6, T7 and again here.
 */
function clearIpLimits() {
  for (const key of [
    'rl:auth-register:::1',
    'rl:auth-register-otp-ip:::1',
    'rl:auth-register-otp-verify-ip:::1',
    'rl:auth-account-otp-ip:::1',
    'rl:auth-account-otp-verify-ip:::1',
    'rl:login-ip:::1',
  ]) {
    redisDel(key);
  }
}

/**
 * Every budget keyed on ONE address: the lockout, and all three OTP windows.
 *
 * The hour window is the one that bites a capture run — `OTP_POLICY` allows five
 * codes an hour per target, and one full run asks the same supplier owner for
 * four (two portals, two themes) on top of whatever a previous run spent.
 */
const clearLoginBudget = (email) => {
  const target = email.toLowerCase();
  redisDel(`rl:login-id:${target}`);
  for (const purpose of ['LOGIN', 'PASSWORD_RESET']) {
    for (const window of ['cooldown', 'hour', 'day', 'verify']) {
      redisDel(`rl:otp-${window}:${purpose}:${target}`);
    }
  }
};

/* ------------------------------------------------------------------ fixtures */

const stamp = Date.now().toString().slice(-7);
let seq = 0;

function account(tag) {
  seq += 1;
  return {
    tag,
    email: `t10.${tag}.${stamp}@harbourpoint.example`,
    mobile: `9${String(100000000 + ((Number(stamp) + seq * 977) % 900000000)).slice(-9)}`,
    password: PASSWORD,
  };
}

/** Register through the real endpoint, proving both contacts exactly as a person does. */
async function register(request, who, orgType, companyName) {
  const proof = async (channel, value) => {
    const sent = await request.post(`${API}/api/auth/register/otp`, { data: { channel, value } });
    const body = await sent.json();
    if (!body.devCode) throw new Error(`no devCode for ${channel} ${value}: ${sent.status()}`);
    const ok = await request.post(`${API}/api/auth/register/otp/verify`, {
      data: { channel, value, code: body.devCode },
    });
    if (!ok.ok()) throw new Error(`${channel} verify failed: ${await ok.text()}`);
    return (await ok.json()).value;
  };

  const email = await proof('EMAIL', who.email);
  const mobile = await proof('MOBILE', who.mobile);

  const created = await request.post(`${API}/api/auth/register`, {
    data: {
      orgType,
      companyName,
      fullName: 'Ishaan Malhotra',
      email,
      mobile,
      password: who.password,
    },
  });
  if (!created.ok()) throw new Error(`register failed: ${await created.text()}`);

  const session = await created.json();

  // A supplier owner is in MFA_REQUIRED_ROLES, so the very next call is a 403
  // until the factor lands — the defect T7 found. Satisfy it the way the screen
  // does, then materialise the steps so the status screens have something real
  // to show rather than an empty list.
  if (session.mfaRequired) {
    const asked = await request.post(`${API}/api/auth/mfa/otp`);
    const code = (await asked.json()).devCode;
    const done = await request.post(`${API}/api/auth/mfa/verify`, { data: { code } });
    if (!done.ok()) throw new Error(`mfa failed: ${await done.text()}`);
  }
  const started = await request.post(`${API}/api/onboarding/start`);
  if (!started.ok()) throw new Error(`onboarding/start failed: ${await started.text()}`);

  const orgId = psql(
    `SELECT org_id FROM identity.user_account WHERE lower(email::text) = lower('${who.email}')`,
  );
  if (!orgId) throw new Error(`no org for ${who.email}`);
  await request.post(`${API}/api/auth/logout`);
  return { ...who, orgId, normalisedEmail: email };
}

/** The state an application is in while a reviewer holds it. No route sets this. */
const markSubmitted = (orgId) =>
  psql(
    `UPDATE identity.organization
        SET status = 'KYC_SUBMITTED', review_sla_due_at = now() + interval '19 hours'
      WHERE id = '${orgId}'`,
  );

const markSuspended = (orgId) =>
  psql(`UPDATE identity.organization SET status = 'SUSPENDED' WHERE id = '${orgId}'`);

const REJECTION =
  'The GST certificate you sent is registered to Harbourpoint Trading LLP, and the PAN on the application belongs to Harbourpoint Devices Pvt Ltd. Those are two different entities. Send the certificate for the entity that will be invoiced, or apply again under the LLP.';

/** A real reviewer, through the real route, so `kyc_review` holds a real row. */
async function reject(request, orgId, notes) {
  const login = await request.post(`${API}/api/auth/login`, {
    data: { email: 'kyc@trugrade.in', password: DEMO_PASSWORD },
  });
  if (!login.ok()) throw new Error(`reviewer could not sign in: ${await login.text()}`);
  const decided = await request.post(`${API}/api/kyc/orgs/${orgId}/decision`, {
    data: { decision: 'REJECTED', reasonCodes: ['ENTITY_MISMATCH'], notes },
  });
  if (!decided.ok()) throw new Error(`decision refused: ${await decided.text()}`);
  await request.post(`${API}/api/auth/logout`);
}

/* --------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function widths(page, name) {
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(300);
}

/**
 * Actually spend the sign-in budget rather than mocking a 429.
 *
 * `SESSION_POLICY.loginFailuresPerEmail` is five per identifier per fifteen
 * minutes, so the sixth attempt is the one that is refused — but the button
 * disables itself the moment the notice appears, which is the behaviour under
 * test, so the loop stops on the notice rather than on a count.
 */
async function exhaust(page, email) {
  for (let i = 0; i < 8; i += 1) {
    if (await page.locator('[data-testid="rate-limit-notice"]').count()) break;
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(`Wrong-Guess-${i}!`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('[data-testid="rate-limit-notice"]', { timeout: 20000 });
}

const capture = async (page, name) => {
  await shot(page, name);
  await widths(page, name);
};

/**
 * A context with the theme pinned before first paint and a listener that keeps
 * every dev OTP the page is issued — the same trick T7-T9 use, and the reason
 * these runs drive the real endpoints instead of stubbing them.
 */
async function openPage(browser, theme, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await context.addInitScript(
    (t) => window.localStorage.setItem('tg-theme', t),
    theme,
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  const codes = new Map();
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\/auth\/(mfa\/otp|login\/otp|password\/forgot)$/.test(url)) return;
    const body = await res.json().catch(() => null);
    if (!body?.devCode) return;
    if (url.endsWith('/mfa/otp')) codes.set('MFA', body.devCode);
    else if (url.endsWith('/login/otp')) codes.set('LOGIN', body.devCode);
    else codes.set('RESET', body.devCode);
  });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  return { page, context, codes };
}

async function assertTheme(page, theme) {
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-t'));
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
}

/* ===================================================================== shop */

async function shopSignIn(browser, theme, fx) {
  const { page, context, codes } = await openPage(browser, theme, `${SHOP}/sign-in`);
  await page.waitForSelector('text=Email me a sign-in code');
  await assertTheme(page, theme);

  await capture(page, `T10-signin-empty-${theme}`);

  /* The password half. */
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.waitForSelector('input[name="password"]');
  await capture(page, `T10-signin-password-${theme}`);

  /* A wrong password, on an address that really exists. */
  clearLoginBudget(fx.ok.email);
  await page.getByLabel('Work email').fill(fx.ok.email);
  await page.getByLabel('Password').fill('Definitely-Not-It-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="alert"]', { timeout: 20000 });
  await capture(page, `T10-signin-wrong-password-${theme}`);

  /* The identical answer for an address that does not exist at all. */
  await page.getByLabel('Work email').fill(`nobody.${stamp}@harbourpoint.example`);
  await page.getByLabel('Password').fill('Definitely-Not-It-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1200);
  await capture(page, `T10-signin-unknown-email-${theme}`);

  /* Spend the budget for real: five failures allowed, the sixth is refused. */
  await exhaust(page, fx.ok.email);
  await capture(page, `T10-signin-rate-limited-${theme}`);
  clearLoginBudget(fx.ok.email);

  /* The code path, which is the customer default. */
  await page.getByRole('button', { name: 'Email me a code instead' }).click();
  await page.getByLabel('Work email').fill(fx.ok.email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await page.waitForSelector('text=Enter the code we emailed you', { timeout: 20000 });
  await capture(page, `T10-signin-code-sent-${theme}`);

  /* A code that is not right — one sentence, whoever typed it. */
  await page.locator('input[inputmode="numeric"]').first().fill('000000');
  await page.waitForTimeout(1200);
  await capture(page, `T10-signin-code-refused-${theme}`);

  await context.close();
}

/** A supplier owner on the customer door: password, then the second factor. */
async function shopMfa(browser, theme) {
  const { page, context } = await openPage(browser, theme, `${SHOP}/sign-in`);
  await page.waitForSelector('text=Email me a sign-in code');
  clearLoginBudget('owner@northgate.example');

  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Work email').fill('owner@northgate.example');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('text=One more code before you are in', { timeout: 30000 });
  await capture(page, `T10-signin-mfa-${theme}`);
  await context.close();
}

async function shopForgot(browser, theme, fx) {
  const { page, context, codes } = await openPage(browser, theme, `${SHOP}/forgot-password`);
  await page.waitForSelector('text=Email me a reset code');
  await assertTheme(page, theme);
  await capture(page, `T10-forgot-ask-${theme}`);

  clearLoginBudget(fx.reset.email);
  await page.getByLabel('Work email').fill(fx.reset.email);
  await page.getByRole('button', { name: 'Email me a reset code' }).click();
  await page.waitForSelector('text=Enter the code we emailed you', { timeout: 20000 });
  await capture(page, `T10-forgot-code-${theme}`);

  const code = codes.get('RESET');
  if (!code) throw new Error('no reset devCode was seen');
  await page.locator('input[inputmode="numeric"]').first().fill(code);
  await page.waitForSelector('text=Choose a new password', { timeout: 20000 });
  await capture(page, `T10-reset-choose-${theme}`);

  /* A password the server will refuse, so the meter and the refusal both show. */
  await page.getByLabel('New password').fill('password123');
  await page.waitForTimeout(400);
  await capture(page, `T10-reset-weak-${theme}`);

  await page.getByLabel('New password').fill(`${NEW_PASSWORD}${theme}`);
  await page.getByRole('button', { name: 'Set this password' }).click();
  await page.waitForSelector('text=Your new password is set', { timeout: 30000 });
  await capture(page, `T10-reset-done-${theme}`);
  await context.close();
}

/** Signed in, and the organisation is not simply open for business. */
async function shopOutcome(browser, theme, who, name) {
  const { page, context } = await openPage(browser, theme, `${SHOP}/sign-in`);
  await page.waitForSelector('text=Email me a sign-in code');
  clearLoginBudget(who.email);

  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector(
    name === 'suspended' ? '[data-testid="signin-suspended"]' : '[data-testid="signin-outcome"]',
    { timeout: 30000 },
  );
  await capture(page, `T10-${name}-${theme}`);
  await context.close();
}

/* ================================================================== console */

async function consoleSignIn(browser, theme) {
  const { page, context } = await openPage(browser, theme, `${CONSOLE}/login`);
  await page.waitForSelector('text=staff and suppliers');
  await assertTheme(page, theme);
  await capture(page, `T10-console-signin-empty-${theme}`);

  const probe = `nobody.console.${stamp}@harbourpoint.example`;
  clearLoginBudget(probe);
  await page.getByLabel('Work email').fill(probe);
  await page.getByLabel('Password').fill('Definitely-Not-It-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="alert"]', { timeout: 20000 });
  await capture(page, `T10-console-wrong-password-${theme}`);

  await exhaust(page, probe);
  await capture(page, `T10-console-rate-limited-${theme}`);
  clearLoginBudget(probe);
  await context.close();
}

/** The whole supplier-owner sign-in, second factor and all. */
async function consoleMfa(browser, theme) {
  const { page, context, codes } = await openPage(browser, theme, `${CONSOLE}/login`);
  await page.waitForSelector('text=staff and suppliers');
  clearLoginBudget('owner@northgate.example');

  await page.getByLabel('Work email').fill('owner@northgate.example');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('text=One more code before you are in', { timeout: 30000 });
  await capture(page, `T10-console-mfa-${theme}`);

  const code = codes.get('MFA');
  if (!code) throw new Error('no MFA devCode was seen');
  await page.locator('input[inputmode="numeric"]').first().fill(code);
  await page.waitForSelector('nav, [data-testid="login-application"]', { timeout: 30000 });
  await capture(page, `T10-console-signed-in-${theme}`);
  await context.close();
}

async function consoleOutcome(browser, theme, who, name, codesNeeded) {
  const { page, context, codes } = await openPage(browser, theme, `${CONSOLE}/login`);
  await page.waitForSelector('text=staff and suppliers');
  clearLoginBudget(who.email);

  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  if (name === 'suspended') {
    await page.waitForSelector('[data-testid="login-suspended"]', { timeout: 30000 });
  } else {
    if (codesNeeded) {
      await page.waitForSelector('text=One more code before you are in', { timeout: 30000 });
      const code = codes.get('MFA');
      if (!code) throw new Error('no MFA devCode was seen');
      await page.locator('input[inputmode="numeric"]').first().fill(code);
    }
    await page.waitForSelector('[data-testid="login-application"]', { timeout: 30000 });
  }
  await capture(page, `T10-console-${name}-${theme}`);
  await context.close();
}

/* ======================================================================= run */

await mkdir(OUT, { recursive: true });
clearIpLimits();

const browser = await chromium.launch();
const setup = await browser.newContext();

console.log('creating fixtures…');
const fx = {
  ok: await register(setup.request, account('ok'), 'BUYER', 'Harbourpoint Devices'),
  reset: await register(setup.request, account('reset'), 'BUYER', 'Harbourpoint Reset'),
  pending: await register(setup.request, account('pending'), 'BUYER', 'Harbourpoint Pending'),
  rejected: await register(setup.request, account('rejected'), 'BUYER', 'Harbourpoint Rejected'),
  suspended: await register(setup.request, account('susp'), 'BUYER', 'Harbourpoint Suspended'),
  vendorPending: await register(setup.request, account('vpend'), 'VENDOR', 'Harbourpoint Supply'),
  vendorSuspended: await register(setup.request, account('vsusp'), 'VENDOR', 'Harbourpoint Refurb'),
};

psql(`UPDATE identity.organization SET status = 'VERIFIED' WHERE id = '${fx.ok.orgId}'`);
psql(`UPDATE identity.organization SET status = 'VERIFIED' WHERE id = '${fx.reset.orgId}'`);
markSubmitted(fx.pending.orgId);
markSubmitted(fx.vendorPending.orgId);
markSubmitted(fx.rejected.orgId);
await reject(setup.request, fx.rejected.orgId, REJECTION);
markSuspended(fx.suspended.orgId);
markSuspended(fx.vendorSuspended.orgId);
await setup.close();
console.log('fixtures ready');

const themes = process.env.THEME ? [process.env.THEME] : ['dark', 'light'];
for (const theme of themes) {
  clearIpLimits();
  console.log(`--- ${theme} ---`);
  await shopSignIn(browser, theme, fx);
  await shopMfa(browser, theme);
  await shopForgot(browser, theme, fx);
  await shopOutcome(browser, theme, fx.pending, 'pending-approval');
  await shopOutcome(browser, theme, fx.rejected, 'rejected-with-reason');
  await shopOutcome(browser, theme, fx.suspended, 'suspended');
  await consoleSignIn(browser, theme);
  await consoleMfa(browser, theme);
  await consoleOutcome(browser, theme, fx.vendorPending, 'pending-approval', true);
  await consoleOutcome(browser, theme, fx.vendorSuspended, 'suspended', false);
}

await browser.close();
console.log('done');
