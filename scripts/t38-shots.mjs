/**
 * T38 review captures: the margin rules, their precedence, and the three things
 * the screen refuses to make up. Every state, both themes, 1440 / 900 / 600.
 *
 * WHAT IS REAL HERE
 * -----------------
 * The collision is real. `procurement.margin_rule` holds the five seeded rules,
 * and a Grade B machine at 20,000 satisfies both the `0-25,000` band at priority
 * 5 and the Grade B rule at priority 10 — so "Overruled by priority 5" is the
 * screen reading live data, not a fixture. So is "Never applies" on the
 * catch-all at priority 100, and so are the per-rule money totals, which are
 * `unit_price` minus `vendor_ask_price` on the stock each rule is pricing.
 *
 * The run asserts three honesty invariants against the live response before it
 * believes any frame:
 *   - the winner the screen names for the seeded collision is the rule with the
 *     lower priority, because that is what the resolver returns;
 *   - `ceilingMarginPct` is null on every rule and appears nowhere as 0 — there
 *     is no ceiling column on the table;
 *   - `reserve.withReserveAmount` is 0 against a non-zero warranty count, which
 *     is the evidence behind "priced in, never held".
 *
 * THE_ONLY_STUBS
 *   - rules-loading / rules-error: the GET is delayed, then answered 500.
 *   - rules-empty: `/api/admin/pricing/margin-rules` answered with an empty rule
 *     list. Deleting the five real rules would leave the platform unable to
 *     price anything, including for the other session working in this tree.
 *
 * NOT A STUB, and the reason it is not: the scheduled and switched-off rules are
 * written straight to `procurement.margin_rule` and deleted again in a `finally`.
 * No route in the product creates a margin rule — that is one of this task's
 * findings — so SQL is the only way those two states exist at all, and it is
 * also how the seed makes the other five.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const RULES = '**/api/admin/pricing/margin-rules*';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
/** The only role holding `listing.price.override` that can sign in without MFA. */
const PRICING_ADMIN = 'pricing@trugrade.in';

/** Deleted in a `finally`. Fixed ids so a crashed run can be cleaned up by hand. */
const SCHEDULED_ID = 'd38b0001-0000-4000-8000-00000000c001';
const SWITCHED_OFF_ID = 'd38b0001-0000-4000-8000-00000000c002';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-e', 'PGPASSWORD=trugrade_dev', 'trugrade-postgres', 'psql', '-U', 'trugrade', '-d', 'trugrade', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function insertExtraRules() {
  const bands = JSON.stringify({ A_PLUS: 1.5, A: 2.5, B: 4.0 });
  for (const [id, priority, from, active] of [
    // Starts next year: active, and deliberately not yet in force. The screen has
    // to show it — a scheduled change is the one about to move every price.
    [SCHEDULED_ID, 40, '2027-04-01', 'TRUE'],
    // In its window and switched off. It must not be reported as a collision.
    [SWITCHED_OFF_ID, 45, '2020-01-01', 'FALSE'],
  ]) {
    psql(
      `INSERT INTO procurement.margin_rule
         (id, priority, category, brand_id, grade, value_from, value_to,
          target_margin_pct, floor_margin_pct, warranty_top_up_months,
          reserve_pct_by_grade, effective_from, effective_to, is_active)
       VALUES ('${id}'::uuid, ${priority}, NULL, NULL, 'A'::grade_type, NULL, NULL,
               16.000, 10.000, 3, '${bands}'::jsonb, '${from}'::date, NULL, ${active})
       ON CONFLICT (id) DO NOTHING`,
    );
  }
}

function removeExtraRules() {
  psql(
    `DELETE FROM procurement.margin_rule WHERE id IN ('${SCHEDULED_ID}'::uuid, '${SWITCHED_OFF_ID}'::uuid)`,
  );
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

async function capture(page, name) {
  await shot(page, name);
  for (const width of [900, 600]) {
    await page.setViewportSize({ width, height: 1700 });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1700 });
  await page.waitForTimeout(300);
}

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
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

/** The console holds its token in memory, so a Vite rebuild signs you out mid-run. */
async function open(page, path, ready) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(ready, { timeout: 20000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await signIn(page, PRICING_ADMIN);
    }
  }
}

/**
 * The claims the screen makes, checked against the response that produced them.
 *
 * A stale API answers this route with a 404 and a stale one that predates the
 * precedence work answers it without `overlaps` — either way the frames would be
 * of behaviour that no longer exists, which has happened twice on this machine.
 */
async function assertHonest(page) {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/admin/pricing/margin-rules', { credentials: 'include' });
    const body = await res.json();
    const seeded = body.rules.filter((x) => x.id.startsWith('9f1b0001'));
    const cheap = seeded.find((x) => x.priority === 5);
    const gradeB = seeded.find((x) => x.priority === 10);
    return {
      status: res.status,
      rules: body.rules.length,
      // Which rule the screen says wins the seeded Grade B collision.
      cheapWins: cheap?.overlaps.find((o) => o.ruleId === gradeB?.id)?.wins ?? null,
      gradeBWins: gradeB?.overlaps.find((o) => o.ruleId === cheap?.id)?.wins ?? null,
      unreachable: body.rules.filter((x) => x.unreachableBecause.length > 0).length,
      ceilings: [...new Set(body.rules.map((x) => x.ceilingMarginPct))],
      reserve: body.reserve,
      attribution: body.attribution,
      priceBook: body.priceBook,
      text: JSON.stringify(body),
    };
  });

  if (r.status !== 200) throw new Error(`the rules route answered ${r.status}`);
  if (r.rules === 0) throw new Error('no margin rules — nothing could be priced');

  // Precedence: the lower priority wins, and exactly one of the pair claims it.
  if (r.cheapWins !== true || r.gradeBWins !== false) {
    throw new Error(
      `precedence is wrong or missing: cheap=${r.cheapWins}, gradeB=${r.gradeBWins}`,
    );
  }
  // No ceiling COLUMN exists. If a 0 ever appears here the screen has started
  // rendering an absent value as a cap of nothing.
  if (r.ceilings.some((c) => c !== null)) {
    throw new Error(`a rule reported a ceiling: ${JSON.stringify(r.ceilings)}`);
  }
  // The evidence behind "priced in, never held".
  if (r.reserve.withReserveAmount !== 0) {
    throw new Error('a warranty now carries a reserve — the screen copy needs revisiting');
  }
  if (r.priceBook.tableExists) {
    throw new Error('procurement.price_book now exists — this screen claims it does not');
  }

  console.log(
    `  ${r.rules} rules · priority 5 overrules priority 10 · ${r.unreachable} unreachable · ` +
      `reserve held on ${r.reserve.withReserveAmount} of ${r.reserve.warranties} warranties · ` +
      `rule recorded on ${r.attribution.unitsWithRuleRecorded} of ${r.attribution.unitsWithRetailPrice} priced machines`,
  );
}

async function run(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, PRICING_ADMIN);

  await open(page, '/pricing/rules', 'tbody');
  await assertTheme(page, theme);
  await assertHonest(page);
  await capture(page, `T38-margin-rules-${theme}`);

  // A scheduled rule and a switched-off one, written the only way a margin rule
  // can be written. Removed in the `finally` below.
  insertExtraRules();
  await open(page, '/pricing/rules', 'text=Not yet in force');
  await page.waitForTimeout(500);
  await capture(page, `T38-margin-rules-scheduled-${theme}`);
  removeExtraRules();

  // Stubbed empty: the five real rules are what lets the platform price
  // anything, and the other session shares this database.
  await page.route(RULES, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        asAt: new Date().toISOString().slice(0, 10),
        rules: [],
        platform: {
          warrantyMinTotalMonths: 6,
          roundingStepInr: null,
          guardrailLowerMultiple: 0.3,
          guardrailUpperMultiple: 3,
          qcVisitFeeInr: '1500',
          qcVisitFeeWaivedAbove: 50,
          qcFeeBearer: 'TRUETECH',
          minMarginAbsoluteInr: 500,
        },
        reserve: { warranties: 0, withReserveAmount: 0 },
        attribution: { unitsWithRetailPrice: 0, unitsWithRuleRecorded: 0 },
        priceBook: { tableExists: false },
        unmatched: { listings: 0, units: 0 },
      }),
    }),
  );
  await page.goto(`${CONSOLE}/pricing/rules`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=No margin rule exists', { timeout: 15000 });
  await capture(page, `T38-margin-rules-empty-${theme}`);
  await page.unroute(RULES);

  await page.route(RULES, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}/pricing/rules`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await capture(page, `T38-margin-rules-loading-${theme}`);
  await page.unroute(RULES);

  await page.route(RULES, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}/pricing/rules`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `T38-margin-rules-error-${theme}`);

  await context.close();
}

/** A role that holds `listing.any.read` and not `listing.price.override`. */
async function refused(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, 'catalog@trugrade.in');
  await page.goto(`${CONSOLE}/pricing/rules`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await assertTheme(page, theme);
  await capture(page, `T38-margin-rules-refused-${theme}`);
  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const probe = await fetch(`${API}/api/admin/pricing/margin-rules`);
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — it does not know the T38 route');
  }
  console.log(`api rules -> ${probe.status} (401 expected unauthenticated; not 404)`);

  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      await run(browser, theme);
      await refused(browser, theme);
    }
  } finally {
    // Whatever happened above, the two extra rules do not stay in the database.
    removeExtraRules();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
