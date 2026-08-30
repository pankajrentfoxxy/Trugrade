/**
 * T27 review captures: the listing wizard at `/vendor/listings/new`, every step,
 * every state, both themes, 1440 / 900 / 600.
 *
 * **Nothing on these screens is stubbed except the two states below.** The SKU
 * search hits the real full-text index, the grade definitions and their battery
 * / cosmetic / cycle floors are read out of `catalog.v_current_grade_definition`,
 * the serial checks run against every live listing on the platform, and the
 * payout preview is `PricingService.previewPayout` against Northgate's real
 * cumulative purchases for the financial year — which is why the TDS line
 * appears at all and why it says 0.1%.
 *
 * THE_ONLY_STUBS
 *   - step4-loading: `payout-preview` is delayed 20s. A local API answers in
 *     ~25ms and the skeleton is otherwise unphotographable.
 *   - step4-error:   `payout-preview` is answered 500. There is no way to make
 *     the real endpoint fail on demand that does not involve breaking it.
 *   Both intercept the network and let the real component render the result.
 *
 * The wizard's own draft lives in `sessionStorage`, so a step is reached by
 * writing the draft the vendor would have built and loading the route — not by
 * clicking through four steps three times per theme. Step 1 and step 3 are
 * driven by real typing, because the thing being photographed on those two IS
 * the response to input.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review';
const CONSOLE = 'http://localhost:5173';
const PREVIEW = '**/api/vendor/listings/payout-preview';

const DEMO_PASSWORD = 'Trugrade!Demo2026';
const VENDOR = 'ops@northgate.example';

/** Real rows out of the dev database. A wizard on a fabricated SKU proves nothing. */
const SKU = {
  skuId: '288bbd98-531f-40b1-82ed-3f50ca17aede',
  skuCode: 'DEL-LAT5420-I51135G7-16-256',
  brandName: 'Dell',
  seriesName: 'Latitude',
  modelName: 'Latitude 5420',
  cpuBrand: 'Intel',
  cpuFamily: 'Core i5',
  cpuModel: '1135G7',
  cpuGeneration: '11th',
  ramGb: 16,
  storageGb: 256,
  storageType: 'NVMe SSD',
  gpuType: 'Integrated',
  gpuModel: null,
  screenSizeIn: 14,
  resolution: '1920x1080',
  isTouch: false,
  osSupported: 'Windows 11 Pro',
  osLicenceType: 'OEM',
};
const PICKUP = '36cb75bf-e34f-402b-bcee-2033c271bcd0';

/** Enough machines and a high enough ask to cross the ₹50 lakh TDS threshold. */
const MANY = Array.from({ length: 40 }, (_, i) => `T27DEMO${String(i + 1).padStart(4, '0')}`);

const BASE = {
  step: 1,
  sku: null,
  grade: 'A',
  conditionType: 'REFURBISHED',
  functionalStatus: 'FULLY_FUNCTIONAL',
  batteryHealthBand: 'GOOD_80_89',
  partsStatus: 'ALL_ORIGINAL',
  partsReplaced: [],
  repairHistory: 'NONE',
  dataWipeStatus: 'VERIFIED_WIPED',
  sellerWarranty: 'D30',
  oemWarrantyRemaining: 'M3_6',
  vendorWarrantyMonths: 6,
  pickupLocationId: PICKUP,
  serialText: '',
  serials: [],
  netPayoutRupees: '',
  moq: 1,
  dispatchSlaHours: 48,
};

const DRAFT_KEY = 'trugrade.vendor.listing-wizard';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

/** 1440 is the design width; 900 and 600 are the two breakpoints that move. */
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

/** Theme pinned before first paint, exactly as the pre-paint read in `<head>` does. */
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

async function signIn(page) {
  await page.goto(`${CONSOLE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const form = await page
    .waitForSelector('text=staff and suppliers', { timeout: 8000 })
    .catch(() => null);
  if (!form) return;
  await page.getByLabel('Work email').fill(VENDOR);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('nav', { timeout: 30000 }).catch(() => {});
}

/**
 * Load the wizard with a draft already in it.
 *
 * The console holds its access token in memory, so a reload signs you out —
 * Vite issues one whenever a workspace package rebuilds. Hence the retry.
 */
async function openWizard(page, draft, ready) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // `sessionStorage` survives a same-tab navigation, so the draft is written
    // on whatever page is open and the wizard reads it on arrival. An
    // `addInitScript` per call accumulates across the run and re-runs every
    // earlier draft on every later navigation.
    await page.evaluate(
      ([key, value]) => window.sessionStorage.setItem(key, value),
      [DRAFT_KEY, JSON.stringify(draft)],
    );
    await page.goto(`${CONSOLE}/vendor/listings/new`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(ready, { timeout: 25000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      // Vite reloads the page whenever a workspace package rebuilds, and the
      // console holds its access token in memory — so a rebuild mid-run signs
      // you out and the route renders the permission empty state instead.
      await signIn(page);
    }
  }
}

async function run(browser, theme) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page);

  // ---- step 1 -------------------------------------------------------------
  await openWizard(page, BASE, 'text=Pick the machine');
  await assertTheme(page, theme);
  await capture(page, `T27-step1-empty-${theme}`);

  // The search is debounced at 250ms and refires on every keystroke; a fill
  // that lands while the console is still refreshing its access token gets one
  // 401 and no retry of its own, so the retry lives here.
  for (let attempt = 0; ; attempt += 1) {
    await page.getByLabel('Search the catalog').fill('');
    await page.getByLabel('Search the catalog').fill('Latitude 5420');
    try {
      await page.waitForSelector('text=DEL-LAT5420', { timeout: 15000 });
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  await page.getByRole('button', { name: 'Select' }).first().click();
  await page.waitForSelector('text=This is what we will inspect against', { timeout: 20000 });
  await capture(page, `T27-step1-selected-${theme}`);

  await page.getByLabel('Search the catalog').fill('qzxqzx nothing');
  await page.waitForSelector('text=No SKU matches this configuration', { timeout: 20000 });
  await capture(page, `T27-step1-no-match-${theme}`);

  // ---- step 2 -------------------------------------------------------------
  await openWizard(page, { ...BASE, step: 2, sku: SKU }, 'text=We will check this.');
  await page.waitForSelector('text=Cosmetic', { timeout: 20000 });
  await capture(page, `T27-step2-${theme}`);

  // The declared band cannot reach the declared grade's floor. Warns, never blocks.
  await openWizard(
    page,
    { ...BASE, step: 2, sku: SKU, grade: 'A_PLUS', batteryHealthBand: 'FAIR_70_79' },
    'text=needs battery health of',
  );
  await capture(page, `T27-step2-grade-floor-${theme}`);

  // ---- step 3 -------------------------------------------------------------
  await openWizard(page, { ...BASE, step: 3, sku: SKU }, 'text=Serial numbers');
  await capture(page, `T27-step3-empty-${theme}`);

  // A real serial already live on the platform, and two that are not. The
  // duplicate check is the one a browser cannot make.
  await page
    .getByLabel('Paste a column from your spreadsheet, or type them one per line')
    .fill('TGD001D24B\nT27DEMO0001\nT27DEMO0002');
  await page.waitForTimeout(2500);
  await capture(page, `T27-step3-duplicate-${theme}`);

  // ---- step 4 -------------------------------------------------------------
  const priced = { ...BASE, step: 4, sku: SKU, serials: MANY, serialText: MANY.join('\n') };

  await openWizard(page, { ...priced, serials: [], serialText: '' }, 'text=What you want to receive');
  await capture(page, `T27-step4-no-serials-${theme}`);

  await openWizard(page, priced, 'text=What you want to receive');
  await capture(page, `T27-step4-no-amount-${theme}`);

  await openWizard(page, { ...priced, netPayoutRupees: '150000' }, '[data-testid="net-payout"]');
  await capture(page, `T27-step4-preview-${theme}`);

  // STUB 1 — the skeleton. A local API answers in 25ms.
  await page.route(PREVIEW, async (route) => {
    await new Promise((r) => setTimeout(r, 20000));
    await route.continue();
  });
  await openWizard(page, { ...priced, netPayoutRupees: '150000' }, '[data-testid="payout-preview"]');
  await page.waitForTimeout(1500);
  await capture(page, `T27-step4-loading-${theme}`);
  await page.unroute(PREVIEW);

  // STUB 2 — the failure. The API cannot be made to fail on demand.
  await page.route(PREVIEW, (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'VALIDATION',
          message:
            'No margin rule covers Grade A on this model, so we cannot work out what you would receive. Tell us and we will add one.',
        },
      }),
    }),
  );
  await openWizard(page, { ...priced, netPayoutRupees: '150000' }, 'role=alert');
  await capture(page, `T27-step4-error-${theme}`);
  await page.unroute(PREVIEW);

  await context.close();
}

/**
 * The batch-size decision, driven for real all the way to the database.
 *
 * `qc.min_units_per_visit` is 25, so three machines is short by 22 and the
 * submit returns DECISION_REQUIRED rather than creating a visit. This leaves one
 * DRAFT listing and three units behind per run, which is what a vendor who
 * abandoned the question would also leave — and the state the listings board
 * shows them as recoverable.
 */
async function decision(browser, theme, stamp) {
  const { page, context } = await openPage(browser, theme);
  await signIn(page);
  const serials = [1, 2, 3].map((n) => `T27${stamp}${n}`);
  await openWizard(
    page,
    {
      ...BASE,
      step: 4,
      sku: SKU,
      serials,
      serialText: serials.join('\n'),
      netPayoutRupees: '42000',
    },
    '[data-testid="net-payout"]',
  );
  await assertTheme(page, theme);
  await page.getByRole('button', { name: /Request the inspection/ }).click();
  await page.waitForSelector('text=is worth', { timeout: 30000 });
  await capture(page, `T27-submit-decision-${theme}`);

  await page.getByRole('button', { name: /inspect now/ }).click();
  await page.waitForSelector('text=Nothing is live yet', { timeout: 30000 });
  await capture(page, `T27-submit-accepted-${theme}`);
  await context.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of process.env.THEME ? [process.env.THEME] : ['dark', 'light']) {
  console.log(`--- ${theme} ---`);
  await run(browser, theme);
  if (process.env.SKIP_WRITES !== '1') {
    await decision(browser, theme, `${theme === 'dark' ? 'D' : 'L'}${Date.now() % 100000}`);
  }
}
await browser.close();
console.log('done');
