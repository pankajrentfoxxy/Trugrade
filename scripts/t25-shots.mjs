/**
 * T25 review captures: the approval inbox, one approval, the address book and
 * the team board — every state, both themes, 1440/900/600.
 *
 * **Two of these states are real for the first time in this build.** Until T25
 * there was no approve/reject endpoint, so `APPROVED` and `REJECTED` could only
 * be photographed by writing the columns by hand — T17 and T19 both had to. They
 * are now reached the way a person reaches them: signed in as Suresh Pillai, the
 * named approver on this organisation's four stranded orders, pressing the
 * button. `TT-26-00004` was approved and `TT-26-00011` declined through
 * `POST /api/buyer/approvals/:id/decision` before this run, which raised a real
 * purchase order for one and put six machines back on sale for the other.
 * `TT-26-00007` and `TT-26-00009` are left PENDING, so the inbox has something
 * outstanding in it.
 *
 * **Only one thing here is moved and it is moved back.** `EXPIRED` cannot be
 * reached by driving the UI — it requires a deadline to pass — so
 * `TT-26-00007`'s `expires_at` is brought back an hour and restored to the exact
 * microsecond it held before, in a `finally`, with the rows printed before and
 * after. Nothing else is seeded, stubbed or written for a photograph.
 *
 * The loading and error arms need nothing moved: the response is held open for
 * one and dropped for the other, the way a slow and a lost network do it. The
 * calm empty inbox is reached by answering with an empty list — the shape the
 * endpoint genuinely returns for somebody nobody has asked yet — rather than by
 * deleting four approvals.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';

/** The named approver on this organisation's orders. */
const APPROVER = { email: 'approver@acme.example', password: 'Trugrade!Demo2026' };
/** The person who RAISED them. She may read an approval and may never decide one. */
const REQUESTER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };
/** The account owner. The only role that can change who may do what. */
const OWNER = { email: 'owner@acme.example', password: 'Trugrade!Demo2026' };

const PENDING = 'TT-26-00007';
const APPROVED = 'TT-26-00004';
const DECLINED = 'TT-26-00011';

const sql = (statement) =>
  spawnSync(
    'docker',
    ['exec', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-c', statement],
    { encoding: 'utf8' },
  ).stdout ?? '';

const approvalOf = (orderNumber) =>
  `(SELECT id FROM ordering."order" WHERE order_number = '${orderNumber}')`;

const idOf = (orderNumber) => {
  const [row] = sql(
    `SELECT a.id FROM ordering.order_approval a
       JOIN ordering."order" o ON o.id = a.order_id
      WHERE o.order_number = '${orderNumber}';`,
  )
    .split('\n')
    .slice(2, 3);
  return (row ?? '').trim();
};

/* ------------------------------------------------- the one thing that moves */

let originalExpiry = null;

const expire = () => {
  if (originalExpiry === null) {
    const [row] = sql(
      `SELECT expires_at FROM ordering.order_approval
        WHERE order_id = ${approvalOf(PENDING)};`,
    )
      .split('\n')
      .slice(2, 3);
    originalExpiry = (row ?? '').trim();
  }
  sql(
    `UPDATE ordering.order_approval SET expires_at = now() - interval '1 hour'
      WHERE order_id = ${approvalOf(PENDING)};`,
  );
};

const unexpire = () => {
  if (!originalExpiry) return;
  sql(
    `UPDATE ordering.order_approval SET expires_at = '${originalExpiry}'::timestamptz
      WHERE order_id = ${approvalOf(PENDING)};`,
  );
};

const show = (label) =>
  console.log(
    `\n${label}\n` +
      sql(
        `SELECT o.order_number, a.status, a.decided_at, a.expires_at
           FROM ordering.order_approval a
           JOIN ordering."order" o ON o.id = a.order_id
          ORDER BY o.order_number;`,
      ),
  );

/* ----------------------------------------------------------------- browsing */

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name, widths = [900, 600]) {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(400);
  await shot(page, name);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1500 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1500 });
}

/**
 * One sign-in per person for the whole run, replayed into every context.
 *
 * `POST /auth/login` is limited per IP and this run opens dozens of contexts.
 * Nothing is forged; these are the real cookies the real sign-in set.
 */
const sessions = new Map();

async function sessionFor(browser, who) {
  if (sessions.has(who.email)) return sessions.get(who.email);
  const context = await browser.newContext();
  const res = await context.request.post(`${SHOP}/api/auth/login`, { data: who });
  if (!res.ok()) throw new Error(`sign-in failed for ${who.email}: ${res.status()}`);
  const state = await context.storageState();
  sessions.set(who.email, state);
  await context.close();
  return state;
}

async function open(browser, theme, { as = APPROVER, signedIn = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1500 },
    storageState: signedIn ? await sessionFor(browser, as) : undefined,
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

const visit = async (page, path) => {
  await page.goto(`${SHOP}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

/* ---------------------------------------------------------------------- run */

async function run() {
  await mkdir(OUT, { recursive: true });
  show('before (00004 APPROVED, 00011 REJECTED, 00007 and 00009 PENDING):');

  const ids = {
    pending: idOf(PENDING),
    approved: idOf(APPROVED),
    declined: idOf(DECLINED),
  };
  console.log('approval ids', ids);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      /* ---------------------------------------------------- approval inbox */
      for (const [name, query, widths] of [
        ['inbox-waiting', '', [900, 600]],
        ['inbox-decided', '?status=decided', [600]],
        ['inbox-all', '?status=all', [600]],
      ]) {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/approvals${query}`);
        await capture(page, `T25-${name}-${theme}`, widths);
        await context.close();
      }

      // Calm empty. The shape the endpoint returns for somebody nobody has
      // asked yet — no rows are deleted to produce it.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/approvals*', async (route) => {
          if (/approvals\/[0-9a-f-]{36}/.test(route.request().url())) return route.continue();
          await route.fulfill({
            json: {
              approvals: [],
              total: 0,
              page: 1,
              per: 10,
              pages: 1,
              facets: [
                { value: 'waiting', label: 'Waiting on you', count: 0 },
                { value: 'decided', label: 'Decided', count: 0 },
                { value: 'all', label: 'Everything', count: 0 },
              ],
              waitingOnYou: 0,
            },
          });
        });
        await visit(page, '/account/approvals');
        await capture(page, `T25-inbox-empty-${theme}`, [600]);
        await context.close();
      }

      // Loading, and the failure arm.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/approvals*', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/approvals`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T25-inbox-loading-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/approvals*', (route) => route.abort('failed'));
        await visit(page, '/account/approvals');
        await capture(page, `T25-inbox-error-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, '/account/approvals');
        await capture(page, `T25-inbox-signed-out-${theme}`, [600]);
        await context.close();
      }

      /* --------------------------------------------------- one approval */
      for (const [name, id, widths] of [
        ['approval-pending', ids.pending, [900, 600]],
        ['approval-approved', ids.approved, [600]],
        ['approval-declined', ids.declined, [600]],
      ]) {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/approvals/${id}`);
        await capture(page, `T25-${name}-${theme}`, widths);
        await context.close();
      }

      // The decline form, open, with its own refusal on screen because the
      // reason is still too short.
      {
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/approvals/${ids.pending}`);
        await page.getByRole('button', { name: 'Decline it' }).click();
        await page.locator('#areason').fill('too much');
        await page.waitForTimeout(300);
        await capture(page, `T25-approval-declining-${theme}`, [600]);
        await context.close();
      }

      // The requester opening the approval she raised. VR-123, on screen.
      {
        const { context, page } = await open(browser, theme, { as: REQUESTER });
        await visit(page, `/account/approvals/${ids.pending}`);
        await capture(page, `T25-approval-not-yours-${theme}`, [600]);
        await context.close();
      }

      // Expired. The one moved row, restored in the `finally` below.
      {
        expire();
        const { context, page } = await open(browser, theme);
        await visit(page, `/account/approvals/${ids.pending}`);
        await capture(page, `T25-approval-expired-${theme}`, [600]);
        await context.close();
        const { context: c2, page: p2 } = await open(browser, theme);
        await visit(p2, '/account/approvals?status=all');
        await capture(p2, `T25-inbox-expired-${theme}`, [600]);
        await c2.close();
        unexpire();
      }

      // A link to an approval that is not on this account.
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account/approvals/00000000-0000-4000-8000-000000000000');
        await capture(page, `T25-approval-missing-${theme}`, [600]);
        await context.close();
      }

      /* ------------------------------------------------------- addresses */
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await visit(page, '/account/addresses');
        await capture(page, `T25-addresses-${theme}`, [900, 600]);
        await context.close();
      }
      {
        // Every refusal the form can give, on screen at once.
        const { context, page } = await open(browser, theme, { as: OWNER });
        await visit(page, '/account/addresses');
        await page.getByLabel('Pincode').fill('012345');
        await page.getByLabel('Their mobile').fill('12345');
        await page.getByRole('button', { name: 'Save this site' }).click();
        await page.waitForTimeout(400);
        await capture(page, `T25-addresses-invalid-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await page.route('**/api/account/addresses', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          await route.fulfill({ json: { delivery: [], billing: [] } });
        });
        await visit(page, '/account/addresses');
        await capture(page, `T25-addresses-empty-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await page.route('**/api/account/addresses', (route) => route.abort('failed'));
        await visit(page, '/account/addresses');
        await capture(page, `T25-addresses-error-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await page.route('**/api/account/addresses', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/addresses`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T25-addresses-loading-${theme}`, [600]);
        await context.close();
      }

      /* ------------------------------------------------------------ team */
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await visit(page, '/account/team');
        await capture(page, `T25-team-${theme}`, [900, 600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await visit(page, '/account/team');
        await page.getByRole('button', { name: 'Change roles' }).first().click();
        await page.waitForTimeout(300);
        await capture(page, `T25-team-roles-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await visit(page, '/account/team?role=CUSTOMER_APPROVER');
        await capture(page, `T25-team-filtered-${theme}`, [600]);
        await context.close();
      }
      {
        // Signed in, and not theirs to see. A distinct state from signed out.
        const { context, page } = await open(browser, theme, { as: REQUESTER });
        await visit(page, '/account/team');
        await capture(page, `T25-team-not-yours-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await page.route('**/api/account/team', (route) => route.abort('failed'));
        await visit(page, '/account/team');
        await capture(page, `T25-team-error-${theme}`, [600]);
        await context.close();
      }
      {
        const { context, page } = await open(browser, theme, { as: OWNER });
        await page.route('**/api/account/team', async (route) => {
          await new Promise((r) => setTimeout(r, 15000));
          await route.continue();
        });
        await page.goto(`${SHOP}/account/team`, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await capture(page, `T25-team-loading-${theme}`, [600]);
        await context.close();
      }

      /* --------------------- the dashboard queue, now that it leads somewhere */
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '/account');
        await capture(page, `T25-dashboard-wired-${theme}`, [600]);
        await context.close();
      }
    }
  } finally {
    unexpire();
    await browser.close();
    show('after (00007 must be back to its original deadline, to the microsecond):');
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
