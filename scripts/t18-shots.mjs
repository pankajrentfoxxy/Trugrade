/**
 * T18 review captures: `/bulk`, every state, both themes, 1440/900/600.
 *
 * Nothing is stubbed and nothing is seeded for the occasion. Every screen below
 * is the real route talking to the real `POST /api/buyer/requirements`, signed
 * in as the buyer the demo seeds. The four files in `scripts/t18-files` are the
 * inputs, and they are real files on disk rather than strings built in the page:
 *
 *   requirements-q4.csv    seven lines — three we carry, two we do not, two that
 *                          do not validate. The mixed answer.
 *   mostly-unreadable.csv  one good line and four the row schema refuses, so the
 *                          "lines we could not read" panel is the story.
 *   wrong-header.csv       a real CSV with the wrong column names, which the
 *                          server refuses as a file rather than row by row.
 *   requirement-list.csv   a PNG. Named `.csv`, and refused on its first bytes.
 *
 * **Nothing is moved in the database to reach a state.** Signed-out is captured
 * by not signing in; the server failure by answering the request with a 500 from
 * the browser side, which is the same response a real one produces; the two
 * waits by holding the real request open.
 *
 * **One state could not be captured**, and it is not faked: the route segment's
 * own `loading.tsx`. A `<Link>` transition in the App Router holds the previous
 * page on screen while the payload streams rather than painting the boundary,
 * and every other way into `/bulk` is a full document load. What IS captured is
 * the wait a person really sits through — the file being checked, and the typed
 * form in flight.
 *
 * **Every successful capture really records a requirement.** Each mixed or
 * unmatched run writes `ordering.rfq` rows and opens one `platform.ticket`, and
 * the script prints them at the end so a reviewer can see the leads this run
 * created rather than taking the screen's word for it.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const SHOP = 'http://localhost:3000';
const FILES = 'scripts/t18-files';

const BUYER = { email: 'buyer@acme.example', password: 'Trugrade!Demo2026' };

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

const visit = async (page, query = '') => {
  await page.goto(`${SHOP}/bulk${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
};

const upload = async (page, file) => {
  await page.setInputFiles('input[type=file]', `${FILES}/${file}`);
};

const answered = (page) =>
  page.waitForSelector('h1:has-text("What we can fill now")', { timeout: 30000 });

/** Fill line 1 of the typed form. Empty strings are left empty on purpose. */
async function typeLine(page, { model, quantity, pincode, grade, price, by }) {
  if (model !== undefined)
    await page.fill('input[placeholder="Dell Latitude 5420 i5 16GB 512GB"]', model);
  if (quantity !== undefined) await page.fill('input[placeholder="40"]', quantity);
  if (price !== undefined) await page.fill('input[placeholder="42000"]', price);
  if (pincode !== undefined) await page.fill('input[placeholder="122001"]', pincode);
  if (by !== undefined) await page.fill('input[type=date]', by);
  // `#grade-0`, not `select`: the header's own search-scope select is on the
  // page too, and it is the one a bare `select` finds first.
  if (grade !== undefined) await page.selectOption('#grade-0', grade);
}

const submitTyped = (page) => page.click('button:has-text("Check these lines")');

/* ---------------------------------------------------------------------- run */

async function run() {
  await mkdir(OUT, { recursive: true });
  const before = sql(
    `SELECT count(*) FROM platform.ticket WHERE category = 'BULK_REQUIREMENT';`,
  );
  console.log('BULK_REQUIREMENT leads before this run:\n' + before);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} ===`);

      // --- 1. the empty upload state, and the typed form under it -----------
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await capture(page, `T18-empty-${theme}`);
        await context.close();
      }

      // --- 2. a file in flight ---------------------------------------------
      // The determinate percentage belongs to reading the file off the disk and
      // is over in milliseconds; the wait a person actually sits through is the
      // parse and the match, which is what this holds open.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/requirements', async (route) => {
          await new Promise((r) => setTimeout(r, 20000));
          await route.continue();
        });
        await visit(page);
        await upload(page, 'requirements-q4.csv');
        await page.waitForTimeout(1200);
        await capture(page, `T18-uploading-${theme}`);
        await context.close();
      }

      // --- 3. the mixed answer: matched, unmatched, and rows we could not read
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await upload(page, 'requirements-q4.csv');
        await answered(page);
        await capture(page, `T18-parsed-${theme}`);
        await context.close();
      }

      // --- 4. rows that could not be parsed at all --------------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await upload(page, 'mostly-unreadable.csv');
        await answered(page);
        await capture(page, `T18-unreadable-rows-${theme}`);
        await context.close();
      }

      // --- 5. a file refused on its first bytes -----------------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await upload(page, 'requirement-list.csv');
        await page.waitForSelector('text=is a PNG image');
        await capture(page, `T18-refused-magic-bytes-${theme}`);
        await context.close();
      }

      // --- 6. a real CSV the server refuses as a file -----------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page);
        await upload(page, 'wrong-header.csv');
        await page.waitForSelector('text=The expected header is');
        await capture(page, `T18-refused-header-${theme}`);
        await context.close();
      }

      // --- 7. the typed form, filled, as the alternative to the file --------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '?q=Dell+Latitude+5420+i5+16GB+512GB&pin=122001');
        await typeLine(page, { quantity: '40', grade: 'A', price: '42000', by: '2026-10-15' });
        await page.click('button:has-text("Add another line")');
        await page.waitForTimeout(300);
        await capture(page, `T18-manual-form-${theme}`);
        await context.close();
      }

      // --- 8. the typed form refusing an incomplete line --------------------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '?q=Dell+Latitude+5420');
        await submitTyped(page);
        await page.waitForSelector('text=How many machines do you need?');
        await capture(page, `T18-manual-refused-${theme}`);
        await context.close();
      }

      // --- 9. a requirement nobody stocks: the lead, and nothing else -------
      {
        const { context, page } = await open(browser, theme);
        await visit(page, '?q=Zorblax+Quantum+Ultrabook+9000&pin=110001');
        await typeLine(page, { quantity: '25' });
        await submitTyped(page);
        await answered(page);
        await capture(page, `T18-lead-created-${theme}`);
        await context.close();
      }

      // --- 10. signed out ---------------------------------------------------
      {
        const { context, page } = await open(browser, theme, { signedIn: false });
        await visit(page, '?q=Dell+Latitude+5420+i5+16GB+512GB&pin=122001');
        await typeLine(page, { quantity: '40' });
        await submitTyped(page);
        await page.waitForSelector('text=Sign in to send a requirement list');
        await capture(page, `T18-signed-out-${theme}`);
        await context.close();
      }

      // --- 11. the wait on the typed path --------------------------------
      // The screen's real loading state. The route segment's own `loading.tsx`
      // could NOT be photographed: a `<Link>` transition in the App Router holds
      // the previous page while the payload streams rather than painting the
      // boundary, and every other way in is a full document load. It is not
      // faked here — see the ledger.
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/requirements', async (route) => {
          await new Promise((r) => setTimeout(r, 25000));
          await route.continue();
        });
        await visit(page, '?q=Dell+Latitude+5420+i5+16GB+512GB&pin=122001');
        await typeLine(page, { quantity: '40' });
        await submitTyped(page);
        await page.waitForTimeout(900);
        await capture(page, `T18-checking-typed-${theme}`);
        await context.close();
      }

      // --- 12. the failure arm ----------------------------------------------
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/requirements', (route) =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'INTERNAL', message: 'Something went wrong on our side.' },
            }),
          }),
        );
        // The uploaded path, because that is the one this screen exists for.
        // A failure on the TYPED path keeps the rows on screen and puts the
        // refusal above them — throwing away what somebody just typed would be
        // a worse answer than the failure itself — so it is captured separately
        // below rather than sharing this screen.
        await visit(page);
        await upload(page, 'requirements-q4.csv');
        await page.waitForSelector('text=We could not read your list just now');
        await capture(page, `T18-error-${theme}`);
        await context.close();
      }

      // --- 13. the same failure on the typed path, which keeps the rows ------
      {
        const { context, page } = await open(browser, theme);
        await page.route('**/api/buyer/requirements', (route) =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'INTERNAL', message: 'Something went wrong on our side.' },
            }),
          }),
        );
        await visit(page, '?q=Dell+Latitude+5420+i5+16GB+512GB&pin=122001');
        await typeLine(page, { quantity: '40' });
        await submitTyped(page);
        await page.waitForSelector('[role=alert]');
        await capture(page, `T18-error-typed-${theme}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    console.log(
      '\nBULK_REQUIREMENT leads after this run:\n' +
        sql(`SELECT count(*) FROM platform.ticket WHERE category = 'BULK_REQUIREMENT';`),
    );
    console.log(
      '\nthe five most recent, with the lines attached to each:\n' +
        sql(
          `SELECT t.ticket_number, t.subject, t.status,
                  jsonb_array_length((m.body::jsonb)->'unmatched') AS unmatched_lines
             FROM platform.ticket t
             JOIN platform.ticket_message m ON m.ticket_id = t.id
            WHERE t.category = 'BULK_REQUIREMENT'
            ORDER BY t.created_at DESC
            LIMIT 5;`,
        ),
    );
  }
}

await run();
