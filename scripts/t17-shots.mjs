/**
 * T17 review captures: `/orders/[orderNumber]`, every state, both themes,
 * 1440/900/600.
 *
 * Nothing is stubbed and nothing is seeded for the occasion. Every screen below
 * is the real route reading a real order that checkout really placed, signed in
 * as the buyer who placed it. The order numbers are the ones in the database:
 *
 *   TT-26-00001  PAYMENT_PENDING, 2 machines, ONE dispatch point, CGST + SGST
 *   TT-26-00002  PAYMENT_PENDING, 3 machines, TWO dispatch points, IGST
 *   TT-26-00004  AWAITING_APPROVAL, 6 machines held, 0 purchase orders
 *   TT-26-00007  AWAITING_APPROVAL — borrowed for the EXPIRED capture
 *   TT-26-00009  AWAITING_APPROVAL — borrowed for the REJECTED capture
 *
 * **Two states need data moved, and both move through the real column and are
 * put back.** There is no approve/reject endpoint yet (PHASE_06 Task 2 builds
 * the policy and the row; the decision screens are the approver's, not this
 * task's), so an approval that expired and one that was declined cannot be
 * reached by driving the UI:
 *
 *   EXPIRED   `ordering.order_approval.expires_at` is brought back an hour. That
 *             is the column `OrderReadService` compares against its clock, and
 *             the column the release job reads, so the screen is answering the
 *             same question a real expiry asks it.
 *   REJECTED  `status`, `decided_at` and `comment` are set to what an approver
 *             pressing decline would write, and reset to `PENDING` / NULL / NULL
 *             afterwards.
 *
 * Both are restored in a `finally`, and the script prints the rows before and
 * after so a reviewer can see they came back.
 *
 * The remaining states need nothing moved: a foreign order is captured by asking
 * for one that is not on this account (the API answers 404 for both cases on
 * purpose, so this is the same screen an order belonging to another organisation
 * produces), loading by holding the response open, and the failure arm by
 * dropping the request the way a lost network does.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

const ORDERS = {
  confirmed: 'TT-26-00001',
  multiDispatch: 'TT-26-00002',
  awaiting: 'TT-26-00004',
  expiring: 'TT-26-00007',
  rejecting: 'TT-26-00009',
  /** Well formed, and on nobody's account. The foreign-order screen, exactly. */
  foreign: 'TT-26-00099',
};

const sql = (statement) =>
  execFileSync(
    'docker',
    ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-c', statement],
    { encoding: 'utf8' },
  ).trim();

/* --------------------------------------------------------------------- utils */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1400 });
}

/**
 * One sign-in for the whole run, replayed into every context.
 *
 * `POST /auth/login` is limited to 20 per IP per 15 minutes and this run opens a
 * dozen contexts. Nothing here forges a session; it replays the real cookies the
 * real sign-in set.
 */
let session = null;

async function sessionFor(browser) {
  if (session) return session;
  const context = await browser.newContext();
  const res = await context.request.post(`${SHOP}/api/auth/login`, { data: BUYER });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
  session = await context.storageState();
  await context.close();
  return session;
}

async function open(browser, theme, { signedIn = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    storageState: signedIn ? await sessionFor(browser) : undefined,
  });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);
    else hide();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { context, page };
}

const visit = async (page, orderNumber) => {
  await page.goto(`${SHOP}/orders/${orderNumber}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/* ------------------------------------------------------- the moved-data pair */

const show = (label) =>
  console.log(
    `\n${label}\n` +
      sql(
        `SELECT o.order_number, a.status, a.decided_at, a.expires_at, a.comment
           FROM ordering.order_approval a
           JOIN ordering."order" o ON o.id = a.order_id
          WHERE o.order_number IN ('${ORDERS.expiring}', '${ORDERS.rejecting}')
          ORDER BY o.order_number;`,
      ),
  );

const approvalOf = (orderNumber) =>
  `(SELECT id FROM ordering."order" WHERE order_number = '${orderNumber}')`;

const REJECTION =
  'Q3 hardware budget is committed until October. Re-raise this in the next quarter, or bring it to me with a cost-centre transfer from Operations.';

/**
 * The deadline as it stood before this run, remembered to the microsecond.
 *
 * Restoring it as `requested_at + 24 hours` was close but not equal — the real
 * value came off `ClockPort` a few milliseconds either side of the request — and
 * "close" is not "put back".
 */
let originalExpiry = null;

const expire = () => {
  if (originalExpiry === null) {
    const [row] = sql(
      `SELECT expires_at FROM ordering.order_approval
        WHERE order_id = ${approvalOf(ORDERS.expiring)};`,
    )
      .split('\n')
      .slice(2, 3);
    originalExpiry = row.trim();
  }
  sql(
    `UPDATE ordering.order_approval
        SET expires_at = now() - interval '1 hour'
      WHERE order_id = ${approvalOf(ORDERS.expiring)};`,
  );
};

const unexpire = () => {
  if (originalExpiry === null) return;
  sql(
    `UPDATE ordering.order_approval
        SET expires_at = '${originalExpiry}'::timestamptz
      WHERE order_id = ${approvalOf(ORDERS.expiring)};`,
  );
};

const reject = () =>
  sql(
    `UPDATE ordering.order_approval
        SET status = 'REJECTED', decided_at = now(), comment = '${REJECTION.replace(/'/g, "''")}'
      WHERE order_id = ${approvalOf(ORDERS.rejecting)};`,
  );

const unreject = () =>
  sql(
    `UPDATE ordering.order_approval
        SET status = 'PENDING', decided_at = NULL, comment = NULL
      WHERE order_id = ${approvalOf(ORDERS.rejecting)};`,
  );

/* ---------------------------------------------------------------------- run */

async function run() {
  await mkdir(OUT, { recursive: true });
  show('before (both should be PENDING, no decision, expires 24h after request):');

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      // --- the states that need nothing moved -----------------------------
      for (const [name, orderNumber] of [
        ['confirmed', ORDERS.confirmed],
        ['multi-dispatch', ORDERS.multiDispatch],
        ['awaiting-approval', ORDERS.awaiting],
        ['not-yours', ORDERS.foreign],
      ]) {
        const { context, page } = await open(browser, theme);
        await visit(page, orderNumber);
        await capture(page, `T17-${name}-${theme}`);
        await context.close();
      }

      // --- an approval that ran out of time --------------------------------
      expire();
      {
        const { context, page } = await open(browser, theme);
        await visit(page, ORDERS.expiring);
        await capture(page, `T17-approval-expired-${theme}`);
        await context.close();
      }
      unexpire();

      // --- an approval that was declined, with the approver's reason --------
      reject();
      {
        const { context, page } = await open(browser, theme);
        await visit(page, ORDERS.rejecting);
        await capture(page, `T17-approval-rejected-${theme}`);
        await context.close();
      }
      unreject();

      // --- signed out ------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, ORDERS.confirmed);
        await capture(page, `T17-signed-out-${theme}`);
        await context.close();
      }

      // --- loading: the response held open, so the skeleton is on screen ----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/**', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/orders/${ORDERS.confirmed}`, { waitUntil: 'commit' });
        await page.waitForTimeout(1800);
        await capture(page, `T17-loading-${theme}`);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/**', (route) => route.abort('failed'));
        await visit(page, ORDERS.confirmed);
        await capture(page, `T17-error-${theme}`);
        await context.close();
      }
    }
  } finally {
    // Whatever happened above, the two borrowed rows go back.
    unexpire();
    unreject();
    await browser.close();
    show('after (identical to before):');
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
