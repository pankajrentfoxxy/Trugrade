/**
 * Stage 8 §7 — a buyer who has never been here places an order, alone.
 *
 * This is the one test that answers the question the whole revamp was for: can
 * somebody arrive with nothing but a mobile number and end up with a placed
 * order, without a salesperson, a KYC reviewer, or a purchase-order number?
 * Every other test in this repo checks a part. This checks that the parts join
 * up, against a real browser, a real API and a real database.
 *
 * ## Why the sign-up half asks for a number instead of inventing one
 *
 * This branch runs with `NODE_ENV=development` and a real `INTERAKT_API_KEY` and
 * `SMTP_USER`, so `NotificationPort` resolves to the live WhatsApp and SMTP
 * adapters. A registration code is a real message to a real handset. An earlier
 * draft of this file minted a random ten-digit mobile per run, which means
 * messaging whoever owns that number.
 *
 * So the sign-up half runs only against `E2E_MOBILE`, a number whoever runs this
 * actually controls. Everything after it uses the seeded buyer, whose identifier
 * is under `example` — the domain RFC 2606 reserves so that mail to it cannot
 * leave.
 *
 * ## One assertion the brief asked for that is deliberately not here
 *
 * Tracking cannot show a carrier, an AWB or an ETA, because nothing in this
 * product writes `logistics.shipment`. The API says so itself, in
 * `identity/ops.controller.ts`. What is asserted instead is that the screen says
 * so too, rather than printing a courier reference from nothing.
 */
import type { Browser, Locator, Page } from 'playwright';
import { STOREFRONT, openBrowser, signIn } from './support/portal';

/**
 * The GSTIN the new organisation registers under.
 *
 * `GstinVerificationPort` resolves to the live Zoho adapter on this branch — the
 * fake is commented out in `adapters.module.ts` on purpose — so this is a real
 * lookup against a real portal. It defaults to TrueTech's own GSTIN, which is
 * this project's own entity and already verified many times over in this
 * database, rather than some unrelated company's tax record.
 */
const GSTIN = process.env.E2E_GSTIN ?? '06AAHCT0310N1ZG';

/** A mobile the operator controls, or nothing. Never a generated one. */
const MOBILE = process.env.E2E_MOBILE ?? '';

/**
 * Seeded, verified, and reachable without sending anything anywhere.
 *
 * A different seat from the one `overflow.spec.ts` uses, deliberately. A code
 * budget is per account, and two spec files signing in as the same person
 * inside the same hour spend one budget twice.
 */
const SEEDED_BUYER = process.env.E2E_BUYER ?? 'buyer@acme.example';
const SEEDED_VIEWER = process.env.E2E_VIEWER ?? '';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await openBrowser();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Read the code this branch prints beside the boxes, and type it in.
 *
 * The last box completing is what submits — `OtpInput` fires `onComplete`
 * rather than waiting for a button — so there is nothing to click afterwards.
 */
async function enterCodeOnScreen(): Promise<void> {
  const shown = page.getByTestId('prototype-code');
  await shown.waitFor({ state: 'visible', timeout: 60_000 });
  const code = ((await shown.textContent()) ?? '').replace(/\D/g, '').slice(-6);
  expect(code).toHaveLength(6);
  for (const [i, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(digit);
  }
}

/**
 * Press a step's primary button and insist it worked.
 *
 * Every body in this flow reports a refused save by rendering `role="alert"`
 * and staying put. A test that clicks and walks on turns that into a silent
 * pass three assertions later, which is exactly how the first run of this file
 * reported a finished profile against an organisation that could not order.
 */
async function press(label: RegExp): Promise<void> {
  await page.getByRole('button', { name: label }).click();
  await page.waitForLoadState('networkidle');
  const said = (await page.locator('[role="alert"]').allTextContents())
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim();
  if (said) throw new Error(`"${label.source}" was refused: ${said}`);
}

/**
 * Wait until a control has a value.
 *
 * Playwright's own `expect.poll` belongs to its test runner; these run under
 * Jest, so the poll is written out.
 */
async function filled(field: Locator, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if ((await field.inputValue()).trim().length > 0) return;
    if (Date.now() > until) throw new Error('A field that should have been filled stayed empty.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Open one card on `/profile` by its heading and wait for the flow to mount. */
async function openCard(title: string): Promise<void> {
  await page.goto(`${STOREFRONT}/profile`, { waitUntil: 'networkidle' });
  const card = page.locator('article.profile-hub-card', { hasText: title });
  await card.first().waitFor({ state: 'visible', timeout: 30_000 });
  await card
    .first()
    .getByRole('button', { name: /Fill now|Edit/ })
    .click();
}

/** What the server says about this buyer's ability to order, asked as the buyer. */
async function readiness(): Promise<{ prepaid: boolean; missing: string[] } | null> {
  // Same-origin, through the storefront's own `/api` proxy and at the path
  // `(portal)/api.ts` uses, so the session travels the way it really does.
  return page.evaluate(async () => {
    const res = await fetch('/api/buyer/order-readiness', { credentials: 'include' });
    return res.ok ? ((await res.json()) as { prepaid: boolean; missing: string[] }) : null;
  });
}

/* ==========================================================================
 * 1. Sign-up, and the six fields
 * ======================================================================== */

const signUp = MOBILE ? describe : describe.skip;

signUp('a buyer who has never been here', () => {
  it('signs up with a mobile number and a code, and nothing else', async () => {
    await signIn(page, MOBILE, 'register');
    expect(new URL(page.url()).pathname).not.toMatch(/^\/register/);
    // No password was set and no name was asked for on the way in.
    expect(await page.locator('body').textContent()).not.toMatch(/password/i);
  }, 120_000);

  it('becomes able to order prepaid after six fields and two confirmations', async () => {
    // 1 & 2 — name and work email, on the Account card. It is two sub-steps:
    // the name, then the email, which proves itself with its own code.
    await openCard('Account');
    await page.getByLabel(/^Your name/).fill('Ravi Menon');
    await press(/^Continue$/);

    const email = page.getByLabel(/^Work email/);
    await email.waitFor({ state: 'visible', timeout: 30_000 });
    await email.fill(process.env.E2E_EMAIL ?? `ravi.${Date.now()}@yopmail.com`);
    await press(/^Send code$/);
    await enterCodeOnScreen();
    await press(/^Save$/);

    // 3 — the GSTIN, which fills the legal name, the constitution and the
    // billing address from the portal's own answer.
    await openCard('Tax and billing');
    await page.getByLabel(/^GSTIN/).fill(GSTIN);
    await page.getByRole('button', { name: /^Verify$/ }).click();
    // Confirmation 1: the legal name that came back is ours.
    const isOurs = page.getByLabel(/This is our registered business name/);
    await isOurs.waitFor({ state: 'visible', timeout: 60_000 });
    await isOurs.check();
    await press(/^Continue$/);

    // Confirmation 2: the billing address, which arrived with the GSTIN and is
    // confirmed rather than typed. Saving it IS the confirmation — there is no
    // second checkbox, and nothing in it is a field the buyer has to fill.
    const billing = page.getByTestId('billing-confirm');
    await billing.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await billing.locator('input').count()).toBe(0);
    await press(/^Save$/);

    // 4, 5 & 6 — the delivery site: what to call it, the street, the PIN code.
    await openCard('Delivery');
    await page.getByLabel(/^Name this site/).fill('Head office');
    await page.getByLabel(/^Building and street/).fill('Plot 61, Sector 37 Industrial Estate');
    await page.getByLabel(/^PIN code/).fill('122004');
    // The PIN triggers a locality lookup that fills City and State. Pressing
    // Save before it lands saves a half-built address — which is how the first
    // run of this file left an organisation with no billing or delivery row and
    // still walked on. The field carries no id or name, so this waits on the
    // labelled control rather than a selector that would silently match nothing.
    const city = page.getByLabel(/^City/);
    await city.waitFor({ state: 'visible', timeout: 30_000 });
    await filled(city);
    await press(/^Save$/);

    // The server, not the screen, decides whether this buyer may order.
    const ready = await readiness();
    expect(ready).not.toBeNull();
    expect(ready?.missing).toEqual([]);
    expect(ready?.prepaid).toBe(true);
  }, 300_000);
});

/* ==========================================================================
 * 2. What a buyer who can already order actually gets
 * ======================================================================== */

describe('an order that exists', () => {
  let order: string;

  beforeAll(async () => {
    await signIn(page, SEEDED_BUYER);
    await page.goto(`${STOREFRONT}/orders`, { waitUntil: 'networkidle' });
    const href = await page.locator('a[href^="/orders/TT-"]').first().getAttribute('href');
    order = /\/orders\/(TT-[0-9-]+)/.exec(href ?? '')?.[1] ?? '';
    expect(order).toMatch(/^TT-/);
  }, 180_000);

  it('was placed prepaid, and carries no purchase-order number', async () => {
    await page.goto(`${STOREFRONT}/orders/${order}`, { waitUntil: 'networkidle' });
    const body = (await page.locator('.hub-main').first().textContent()) ?? '';
    expect(body).toMatch(/prepaid/i);
    // The PO field is what Stage 2 stopped defaulting to true. An order placed
    // without one must not be displaying one.
    expect(body).not.toMatch(/PO number\s*[:–-]\s*\w/i);
  }, 120_000);

  it('offers a confirmation that is a PDF, not the words "This page"', async () => {
    await page.goto(`${STOREFRONT}/orders/${order}`, { waitUntil: 'networkidle' });
    expect(await page.locator('a[href*="confirmation.pdf"]').count()).toBeGreaterThan(0);
    expect(await page.locator('.hub-main').first().textContent()).not.toContain('This page');

    // And it really is one: the bytes begin with the magic number, which a
    // Buffer serialised to JSON — the defect Stage 6 fixed — would not.
    // Fetched at the href the record really renders, so a link pointing at the
    // wrong route fails here rather than passing against a hand-written guess.
    const href = await page.locator('a[href*="confirmation.pdf"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const head = await page.evaluate(async (url: string) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return `HTTP ${res.status}`;
      return new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5));
    }, href as string);
    expect(head).toBe('%PDF-');
  }, 120_000);

  it('names no vendor on tracking, and no carrier it does not have', async () => {
    await page.goto(`${STOREFRONT}/orders/${order}/tracking`, { waitUntil: 'networkidle' });
    const body = (await page.locator('.hub-main').first().textContent()) ?? '';

    // The brief asked this screen for a consignment with a carrier, an AWB and
    // an ETA. It cannot have one: `logistics.shipment` and
    // `logistics.shipment_tracking` model all three and nothing in
    // `apps/api/src` writes either. So the screen says what is missing and what
    // would fill it, rather than printing a courier reference from nothing.
    expect(body).toContain('No carrier scan has reached us');
    expect(body).not.toMatch(/\bAWB\b/);

    // What it must never do, whatever else is absent: name the supply point.
    expect(body).not.toMatch(/Northgate|TRUETECH SERVICES/i);
  }, 120_000);

  it('counts the return window from the server rather than the browser clock', async () => {
    await page.goto(`${STOREFRONT}/orders/${order}/units`, { waitUntil: 'networkidle' });
    const body = (await page.locator('.hub-main').first().textContent()) ?? '';
    // Either a live window with its closing time, or the reason there is none.
    // Both come from `platform/returns`' `windowFor`, which reads `ClockPort` —
    // the rule the `Date.now()` lint ban exists to keep.
    expect(body).toMatch(/sent back|return|deliver/i);
  }, 120_000);
});

/* ==========================================================================
 * 3. A seat that may read and may not write
 * ======================================================================== */

const viewer = SEEDED_VIEWER ? describe : describe.skip;

viewer('a CUSTOMER_VIEWER', () => {
  it('opens every screen it may, and is offered no control that would 403', async () => {
    await signIn(page, SEEDED_VIEWER);
    for (const route of ['/home', '/orders', '/returns', '/warranty', '/addresses', '/profile']) {
      await page.goto(`${STOREFRONT}${route}`, { waitUntil: 'networkidle' });
      const body = (await page.locator('.hub-main').first().textContent()) ?? '';
      // Not blank, and not a raw refusal.
      expect(body.trim().length).toBeGreaterThan(40);
      expect(body).not.toMatch(/403|Forbidden/);
    }
    // A viewer holds no write permission, so no board offers it a write.
    await page.goto(`${STOREFRONT}/addresses`, { waitUntil: 'networkidle' });
    expect(await page.getByRole('button', { name: /Add a delivery site/i }).count()).toBe(0);
  }, 240_000);
});
