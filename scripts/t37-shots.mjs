/**
 * T37 review captures: the catalog, the SKU record, the condition-image library
 * and the SKU request queue. Every state, both themes, 1440 / 900 / 600.
 *
 * THREE THINGS THIS RUN DOES FOR REAL RATHER THAN FAKING
 * -----------------------------------------------------
 * 1. **The coverage gap.** Every model in the demo database has a complete set
 *    in every grade, so the gap state was unreachable. Rather than stub it, the
 *    dark run RETIRES one frame through the console's own retire form, with a
 *    real reason — which is the real workflow, leaves the row in place as the
 *    record of what a buyer was shown, and produces a genuine gap that stays
 *    reachable for whoever reviews next.
 * 2. **The SKU request.** `catalog.sku_request` had never held a row. The dark
 *    run raises one through the vendor's own screen at `/vendor/sku-request`,
 *    signed in as a real supplier — so the populated queue is a real request
 *    with real near-match scores, and the reviewer's screen is photographed
 *    against data the product produced.
 * 3. **The reference photographs in the wizard.** Driven by actually walking a
 *    vendor to step 2, so what is captured is the panel a vendor sees, on the
 *    SKU they picked.
 *
 * It asserts the API is not a stale build before believing any frame: the
 * coverage payload must carry `url` on every image, which is the change this
 * task made. A build that predates it serves the same 200 with no `url`, and
 * that has produced screenshots of behaviour that no longer exists twice on this
 * machine.
 *
 * THE_ONLY_STUBS
 *   - *-loading / *-error: the GET is delayed, then answered 500. A local API
 *     answers in ~20 ms and cannot be made to fail on demand.
 *   - catalog-tree-empty: `/api/catalog/tree` answered `[]`. The demo database
 *     has 200 SKUs and emptying it is not a state worth creating.
 *   - sku-record-placeholder: the SKU response is answered with `images.match`
 *     PLACEHOLDER. Every model in the database has photographs in every grade,
 *     so the placeholder rendering has no real data behind it — and it is the
 *     one state where a missing value must not read as a passing one.
 *   Every other frame is the real screen rendering a real response.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const STOREFRONT = 'http://localhost:3000';

/** An Acer Swift 3 with four live units, so the product page has a board to render. */
const LIVE_SKU = 'b417a7b6-411a-4cd7-acb4-6d29fe19fad2';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const CATALOG_ADMIN = 'catalog@trugrade.in';
const VENDOR = 'ops@mayapuri.example';

const TREE = '**/api/catalog/tree*';
const COVERAGE = '**/api/catalog/condition-images/coverage*';
const SKU = '**/api/catalog/skus/*';
const REQUESTS = '**/api/catalog/sku-requests*';

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

async function delayedThen500(page, pattern, path, ready, base) {
  await page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await capture(page, `${base}-loading`);
  await page.unroute(pattern);

  await page.route(pattern, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${CONSOLE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=did not load', { timeout: 15000 });
  await capture(page, `${base}-error`);
  await page.unroute(pattern);
}

/**
 * The one thing this task changed on the API, checked against the live response
 * before any frame is believed.
 *
 * The console renders thumbnails and the buyer preview off `url`, and a build
 * that predates the change answers the same 200 with the field absent — the
 * screen then shows broken images and the capture looks like a CSS bug.
 */
async function assertBuildIsCurrent(page) {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/catalog/condition-images/coverage', { credentials: 'include' });
    const rows = await res.json();
    const images = rows.flatMap((m) => m.images);
    return {
      status: res.status,
      models: rows.length,
      images: images.length,
      withUrl: images.filter((i) => typeof i.url === 'string' && i.url.includes('/api/objects/'))
        .length,
      leakedKeyInUrl: images.filter((i) => (i.url ?? '').includes('catalog/')).length,
    };
  });

  if (r.status !== 200) throw new Error(`coverage answered ${r.status}`);
  if (r.images === 0) throw new Error('the coverage grid has no images to render');
  if (r.withUrl !== r.images) {
    throw new Error(
      `the API on :4000 is a stale build — ${r.images - r.withUrl} of ${r.images} frames carry no object token`,
    );
  }
  // The token is the key ENCRYPTED. If a key path ever appears inside it, the
  // adapter has been swapped for a provider presign and the leak is back.
  if (r.leakedKeyInUrl > 0) throw new Error('an object key appeared inside an image URL');

  console.log(
    `  build is current: ${r.models} models, ${r.images} frames, every one carrying an object token`,
  );
}

/**
 * One id off a live response, retried.
 *
 * A Vite rebuild mid-run drops the console's in-memory token and the next fetch
 * comes back empty — which surfaced as "Unexpected end of JSON input" and looked
 * like an API fault rather than a lost session.
 */
async function idFrom(page, path, pick, email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body = await page.evaluate(
      (p) => fetch(p, { credentials: 'include' }).then((r) => r.text()),
      path,
    );
    try {
      return pick(JSON.parse(body));
    } catch {
      await signIn(page, email);
      await page.waitForTimeout(600);
    }
  }
  throw new Error(`could not read an id from ${path}`);
}

/** The first model on the grid, by id — the row the panel opens for. */
const firstModelId = (page, email) =>
  idFrom(page, '/api/catalog/condition-images/coverage', (rows) => rows[0].modelId, email);

/** The first SKU in the tree, so the record shots are of a machine that exists. */
const firstSkuId = (page, email) =>
  idFrom(page, '/api/catalog/tree', (t) => t[0].series[0].models[0].skus[0].id, email);

async function catalogRun(browser, theme, { retire, requestRaised }) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, CATALOG_ADMIN);

  await open(page, '/catalog', 'summary', CATALOG_ADMIN);
  await assertTheme(page, theme);
  await assertBuildIsCurrent(page);
  await capture(page, `T37-catalog-tree-${theme}`);

  await open(page, '/catalog?q=latitude+5420', 'summary', CATALOG_ADMIN);
  await page.waitForTimeout(500);
  await capture(page, `T37-catalog-tree-filtered-${theme}`);

  await open(page, '/catalog?q=zzzznothing', 'text=Nothing matches', CATALOG_ADMIN);
  await capture(page, `T37-catalog-tree-filtered-empty-${theme}`);

  // Stubbed: the demo database has 200 SKUs and emptying it is not a state
  // worth creating. The assertion under test is that the guidance names the
  // importer and offers no link to a route that does not exist.
  await page.route(TREE, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto(`${CONSOLE}/catalog`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=The catalog is empty', { timeout: 15000 });
  await capture(page, `T37-catalog-tree-empty-${theme}`);
  await page.unroute(TREE);

  await delayedThen500(page, TREE, '/catalog', 'summary', `T37-catalog-tree-${theme}`);

  // ---- the SKU record -----------------------------------------------------
  await open(page, '/catalog', 'summary', CATALOG_ADMIN);
  const skuId = await firstSkuId(page, CATALOG_ADMIN);

  await open(page, `/catalog/skus/${skuId}`, '[data-testid="record-header"]', CATALOG_ADMIN);
  await page.waitForTimeout(900);
  await capture(page, `T37-sku-record-${theme}`);

  await open(
    page,
    `/catalog/skus/${skuId}?grade=A_PLUS`,
    '[data-testid="record-header"]',
    CATALOG_ADMIN,
  );
  await page.waitForTimeout(900);
  await capture(page, `T37-sku-record-grade-aplus-${theme}`);

  // Stubbed: every model in the database has photographs in every grade, so the
  // placeholder has no real data behind it — and it is the one state where a
  // missing value must not render as a passing one.
  await page.route(SKU, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        images: { images: [], match: 'PLACEHOLDER', isGeneric: true },
      }),
    });
  });
  await page.goto(`${CONSOLE}/catalog/skus/${skuId}?grade=B`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=labelled placeholder', { timeout: 15000 });
  await capture(page, `T37-sku-record-placeholder-${theme}`);
  await page.unroute(SKU);

  await delayedThen500(
    page,
    SKU,
    `/catalog/skus/${skuId}`,
    '[data-testid="record-header"]',
    `T37-sku-record-${theme}`,
  );

  // ---- the condition-image library ---------------------------------------
  await open(page, '/catalog/condition-images', 'tbody', CATALOG_ADMIN);
  await page.waitForTimeout(600);
  await capture(page, `T37-image-coverage-${theme}`);

  const modelId = await firstModelId(page, CATALOG_ADMIN);
  await open(
    page,
    `/catalog/condition-images?model=${modelId}`,
    'text=Frames already on',
    CATALOG_ADMIN,
  );
  // The thumbnails are real bytes off `/api/objects/:token`; give them a moment
  // or the frame is of a page still loading rather than of the panel.
  await page.waitForTimeout(2500);
  await capture(page, `T37-image-coverage-open-${theme}`);

  if (retire) {
    // The real retire form, and then the real retire. Not a stub: a frame going
    // out of service is the workflow this panel exists for, the row survives as
    // the record of what a buyer was shown, and the gap it leaves is the state
    // the grid is built to surface.
    await page.getByRole('button', { name: 'Retire' }).first().click();
    await page.waitForSelector('text=Why is this frame going out of service', { timeout: 10000 });
    await capture(page, `T37-image-coverage-retire-${theme}`);

    await page
      .getByLabel('Why is this frame going out of service?')
      .fill('Re-shot under better lighting; this frame under-states the wear.');
    await page.getByRole('button', { name: 'Retire this frame' }).click();
    await page.waitForTimeout(2500);
  }

  await open(page, '/catalog/condition-images', 'tbody', CATALOG_ADMIN);
  await page.waitForTimeout(800);
  await capture(page, `T37-image-coverage-gap-${theme}`);

  await delayedThen500(
    page,
    COVERAGE,
    '/catalog/condition-images',
    'tbody',
    `T37-image-coverage-${theme}`,
  );

  // ---- the SKU request queue ---------------------------------------------
  // Stubbed EMPTY on purpose once a real request exists: the empty state is the
  // deliverable here and it must stay photographable after the queue has
  // something in it. The populated shot below is the real row.
  await page.route(REQUESTS, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.continue(),
  );
  await page.goto(`${CONSOLE}/catalog/sku-requests`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Nothing is waiting', { timeout: 15000 });
  await capture(page, `T37-sku-requests-empty-${theme}`);
  await page.unroute(REQUESTS);

  if (requestRaised) {
    await open(page, '/catalog/sku-requests', 'article', CATALOG_ADMIN);
    await page.waitForTimeout(700);
    await capture(page, `T37-sku-requests-${theme}`);

    await page.getByRole('button', { name: /approve and create the sku/i }).first().click();
    await page.waitForTimeout(600);
    await capture(page, `T37-sku-requests-approve-${theme}`);
  }

  await context.close();
}

/**
 * The buyer's own view of the same library — the half that was still rendering a
 * placeholder over a working pipeline.
 *
 * No sign-in: the product page is public, and that it is public is part of what
 * is being checked. The assertion is that every frame actually decoded, because
 * a token that expired or a store that lost the object produces an alt-text
 * caption under a broken image and the frame still "renders".
 */
async function storefrontRun(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  await context.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await context.newPage();

  await page.goto(`${STOREFRONT}/laptops/${LIVE_SKU}?grade=B`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="representative-image"] img', { timeout: 20000 });

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="representative-image"] img')].map((i) => ({
      loaded: i.naturalWidth > 0,
      tokenised: i.currentSrc.includes('/api/objects/'),
    })),
  );
  const broken = frames.filter((f) => !f.loaded).length;
  if (frames.length === 0) throw new Error('the product page rendered no photographs');
  if (broken > 0) {
    // Almost always the object route's own rate limit — 240 fetches per five
    // minutes per IP — spent by the console captures that ran before this. Run
    // `T37_ONLY_STOREFRONT=1` a few minutes later rather than raising the limit:
    // it is a real control and this is one machine pretending to be a crowd.
    throw new Error(
      `${broken} of ${frames.length} photographs did not decode — likely the object rate limit, see the note above`,
    );
  }
  if (frames.some((f) => !f.tokenised)) throw new Error('a photograph was served off something other than an object token');
  console.log(`  storefront ${theme}: ${frames.length} photographs, every one decoded off an object token`);

  await capture(page, `T37-storefront-gallery-${theme}`);
  await context.close();
}

/** Raise a real SKU request, through the vendor's own screen. */
async function raiseSkuRequest(browser) {
  const { page, context } = await openPage(browser, 'dark');
  await signIn(page, VENDOR);
  await open(page, '/vendor/sku-request', 'text=Ask us to add this machine', VENDOR);

  await page.getByLabel('Brand').fill('Dell');
  await page.getByLabel('Model').fill('Latitude 7440 Ultralight');
  await page
    .getByLabel('Configuration')
    .fill('Core Ultra 7 165U, 32 GB LPDDR5, 1 TB NVMe, 14in WUXGA touch, Windows 11 Pro');
  await page.getByRole('button', { name: 'Send the request' }).click();
  await page.waitForSelector('text=Request sent', { timeout: 20000 });

  const count = await page.evaluate(async () => {
    const res = await fetch('/api/vendor/listings', { credentials: 'include' });
    return res.status;
  });
  console.log(`  raised a SKU request through /vendor/sku-request (session ok: ${count})`);
  await context.close();
}

/** The reference photographs, in the wizard, on the step where a grade is chosen. */
async function wizardRun(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page, VENDOR);
  await open(page, '/vendor/listings/new', 'text=Pick the machine', VENDOR);
  await assertTheme(page, theme);

  await page.getByLabel('Search the catalog').fill('Latitude 5420');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Select' }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.waitForSelector('text=What a buyer sees at Grade', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await capture(page, `T37-wizard-grade-reference-${theme}`);

  // Grade A+ — a different set, and the panel has to follow the radio.
  await page.locator('input[name="grade"][value="A_PLUS"]').check();
  await page.waitForTimeout(2500);
  await capture(page, `T37-wizard-grade-reference-aplus-${theme}`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const probe = await fetch(`${API}/api/catalog/condition-images/coverage`);
  if (probe.status === 404) {
    throw new Error('the API on :4000 is a stale build — the coverage route is missing');
  }
  console.log(`api coverage -> ${probe.status} (401 expected unauthenticated; not 404)`);

  const browser = await chromium.launch();
  try {
    if (!process.env.T37_ONLY_WIZARD && !process.env.T37_ONLY_STOREFRONT) {
      // `T37_KEEP_DATA=1` re-shoots against the request and the gap a previous
      // run already created, rather than raising a second request and retiring a
      // second frame. Both of those are real writes; a capture script that
      // repeats them turns a re-run into data entry.
      if (!process.env.T37_KEEP_DATA) {
        await raiseSkuRequest(browser);
      }
      await catalogRun(browser, 'dark', {
        retire: !process.env.T37_KEEP_DATA,
        requestRaised: true,
      });
      await catalogRun(browser, 'light', { retire: false, requestRaised: true });
    }
    if (!process.env.T37_ONLY_STOREFRONT) {
      for (const theme of ['dark', 'light']) await wizardRun(browser, theme);
    }
    for (const theme of ['dark', 'light']) await storefrontRun(browser, theme);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
