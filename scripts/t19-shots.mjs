/**
 * T19 review captures: `/account`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed and nothing is seeded for the occasion. The dashboard below
 * is the real route reading `GET /api/buyer/orders/summary`, signed in as the
 * buyer whose organisation placed the orders. The figures are the ones in the
 * database: 13 orders, 46 machines, 4 awaiting approval, 9 placed and unpaid.
 *
 * **Two states need data moved, and both move through the real column and are
 * put back**, exactly as `t19`'s predecessor `t17-shots.mjs` does it:
 *
 *   NEAR DEADLINE  `ordering.order_approval.expires_at` on ONE approval is
 *                  brought forward to 38 minutes from now. That is the column
 *                  the dashboard compares against the server's clock and the
 *                  column the release job reads, so the screen is answering the
 *                  same question a real near-expiry asks it. There is no
 *                  approve/reject endpoint yet, so this state cannot be reached
 *                  by driving the UI.
 *   NO ORDERS      All thirteen orders' `buyer_org_id` is pointed at another
 *                  verified buyer organisation for the length of one capture.
 *                  The account genuinely has no orders while the screenshot is
 *                  taken — the endpoint is not mocked and the empty state is not
 *                  simulated — and the column goes straight back. There is only
 *                  one buyer organisation with orders on this database, so a
 *                  first-run buyer cannot otherwise be reached without inventing
 *                  a fixture.
 *
 * Both are restored in a `finally`, and the script prints the rows before and
 * after so a reviewer can see they came back.
 *
 * Loading and the failure arm need nothing moved: the response is held open for
 * one and dropped for the other, the way a slow and a lost network do it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

/** The approval borrowed for the near-deadline capture. */
const EXPIRING = 'TT-26-00007';

/**
 * Somewhere for the orders to sit for one screenshot. A real, verified buyer
 * organisation on this database that nobody signs in as.
 */
const PARKING = "(SELECT id FROM identity.organization WHERE legal_name = 'Harbourpoint Devices' AND status = 'VERIFIED' ORDER BY id LIMIT 1)";

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

const visit = async (page) => {
  await page.goto(`${SHOP}/account`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/* ------------------------------------------------------- the moved-data pair */

const show = (label) =>
  console.log(
    `\n${label}\n` +
      sql(
        `SELECT o.order_number, a.status, a.expires_at,
                (o.buyer_org_id = ${PARKING}) AS parked
           FROM ordering."order" o
           LEFT JOIN ordering.order_approval a ON a.order_id = o.id
          ORDER BY o.order_number;`,
      ),
  );

/**
 * The deadline as it stood before this run, remembered to the microsecond.
 * Restoring it as `requested_at + 24 hours` is close but not equal, and "close"
 * is not "put back".
 */
let originalExpiry = null;

const approvalOf = (orderNumber) =>
  `(SELECT id FROM ordering."order" WHERE order_number = '${orderNumber}')`;

const bringForward = () => {
  if (originalExpiry === null) {
    const [row] = sql(
      `SELECT expires_at FROM ordering.order_approval WHERE order_id = ${approvalOf(EXPIRING)};`,
    )
      .split('\n')
      .slice(2, 3);
    originalExpiry = row.trim();
  }
  sql(
    `UPDATE ordering.order_approval
        SET expires_at = now() + interval '38 minutes'
      WHERE order_id = ${approvalOf(EXPIRING)};`,
  );
};

const putBackExpiry = () => {
  if (originalExpiry === null) return;
  sql(
    `UPDATE ordering.order_approval
        SET expires_at = '${originalExpiry}'::timestamptz
      WHERE order_id = ${approvalOf(EXPIRING)};`,
  );
};

/** The buyer organisation the orders belong to, remembered before they move. */
let originalOrg = null;

const park = () => {
  if (originalOrg === null) {
    const [row] = sql(
      `SELECT DISTINCT buyer_org_id::text FROM ordering."order";`,
    )
      .split('\n')
      .slice(2, 3);
    originalOrg = row.trim();
  }
  sql(`UPDATE ordering."order" SET buyer_org_id = ${PARKING};`);
};

const putBackOrders = () => {
  if (originalOrg === null) return;
  sql(`UPDATE ordering."order" SET buyer_org_id = '${originalOrg}'::uuid;`);
};

/* ---------------------------------------------------------------------- run */

async function run() {
  await mkdir(OUT, { recursive: true });
  show('before (4 PENDING approvals, 24h out, nothing parked):');

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      // --- the dashboard as it stands, with four live approvals -----------
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await capture(page, `T19-dashboard-${theme}`);
        await context.close();
      }

      // --- one approval 38 minutes from its deadline ----------------------
      bringForward();
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await capture(page, `T19-near-deadline-${theme}`);
        await context.close();
      }
      putBackExpiry();

      // --- a buyer whose organisation has never ordered -------------------
      park();
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await capture(page, `T19-no-orders-${theme}`, [600]);
        await context.close();
      }
      putBackOrders();

      // --- signed out ------------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page);
        await capture(page, `T19-signed-out-${theme}`, [600]);
        await context.close();
      }

      // --- loading: the response held open, so the skeleton is on screen ----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/summary*', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account`, { waitUntil: 'commit' });
        await page.waitForTimeout(1800);
        await capture(page, `T19-loading-${theme}`, [600]);
        await context.close();
      }

      // --- error: the request never lands, exactly as a dropped network -----
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/orders/summary*', (route) => route.abort('failed'));
        await visit(page);
        await capture(page, `T19-error-${theme}`, [600]);
        await context.close();
      }
    }
  } finally {
    // Whatever happened above, the borrowed rows go back.
    putBackExpiry();
    putBackOrders();
    await browser.close();
    show('after (identical to before):');
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
