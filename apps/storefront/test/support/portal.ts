/**
 * The bits both browser tests need: a Chromium, a signed-in buyer, and the list
 * of portal routes.
 *
 * Sign-in goes through the real screen rather than posting to the API and
 * injecting a cookie. The portal's session gate is client-side by design (see
 * the comment at the top of `shell/PortalContext.tsx`), so a test that skips
 * the form is not exercising the thing that actually admits a buyer.
 */
import { chromium, type Browser, type Page } from 'playwright';

export const STOREFRONT = process.env.E2E_STOREFRONT_URL ?? 'http://localhost:3000';
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * Every route under `(portal)`: nineteen `page.tsx` files, seventeen of which
 * predate this work and two of which it added — `/orders/[n]/tracking` and
 * `/warranty/claims`.
 *
 * `:order` and `:approval` are substituted with rows the signed-in buyer really
 * owns, because a 404 body has no layout to overflow and would pass the sweep
 * for the wrong reason.
 *
 * The two case records are the exception, and deliberately so. A return or a
 * claim can only exist against a DELIVERED unit, and no order in this database
 * has been delivered — `platform.return_request` and `platform.warranty_claim`
 * are both empty. So those two are measured at the state a buyer actually
 * reaches by mistyping a case number, which renders the full portal chrome
 * around a refusal. The record body itself is not measured in a browser, and
 * cannot be until something is delivered.
 */
export const PORTAL_ROUTES = [
  '/home',
  '/orders',
  '/orders/:order',
  '/orders/:order/units',
  '/orders/:order/delivery',
  '/orders/:order/documents',
  '/orders/:order/tracking',
  '/approvals',
  '/approvals/:approval',
  '/returns',
  '/returns/new',
  '/returns/RT-00-00000',
  '/warranty',
  '/warranty/claims',
  '/warranty/claims/new',
  '/warranty/claims/WC-00-00000',
  '/addresses',
  '/team',
  '/profile',
] as const;

/** The four the brief names: a wide desktop, a laptop, a tablet, a phone. */
export const WIDTHS = [1700, 1280, 900, 420] as const;

export async function openBrowser(): Promise<Browser> {
  return chromium.launch({ args: ['--disable-dev-shm-usage'] });
}

/** Ask the API for a code the way the screen does, to read it without the DOM. */
export async function requestCode(identifier: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/buyer/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  const body = (await res.json()) as { devCode?: string };
  if (!body.devCode) {
    throw new Error(
      `The API did not return a dev code for ${identifier}. ` +
        'These tests need EXPOSE_OTP_DEV_CODE on, which is how this branch signs in without a phone.',
    );
  }
  return body.devCode;
}

/**
 * Sign a buyer in on the real form and land in the portal.
 *
 * `register` is the mobile-only sign-up; `sign-in` takes a mobile or a work
 * email. Both end at the same code screen, which prints the code on this
 * branch, so the test reads it off the page rather than being told it.
 */
export async function signIn(
  page: Page,
  identifier: string,
  mode: 'sign-in' | 'register' = 'sign-in',
): Promise<void> {
  await page.goto(`${STOREFRONT}/${mode}`, { waitUntil: 'domcontentloaded' });

  // The rendered label carries the required marker — "Mobile number *" — so
  // these are anchored rather than exact.
  const field = mode === 'register' ? /^Mobile number\s*\*?$/ : /^Mobile number or work email/;
  const typed = mode === 'register' ? identifier.replace(/^\+91/, '') : identifier;
  await page.getByLabel(field).fill(typed);

  /**
   * Two budgets sit in front of this, and both will stop a tight loop.
   *
   * Per account, `OTP_POLICY` allows one code a minute, five an hour and twenty
   * a day. Per IP, `ACCOUNT_OTP_IP_LIMIT` allows twenty sends an hour across
   * every account — so re-running this suite a dozen times exhausts the IP
   * budget long before any one account's.
   *
   * The one-minute cooldown is waited out, because two spec files signing in
   * back to back land inside it honestly. The hourly budgets are not: those
   * mean the budget is genuinely spent, and waiting would hide it.
   *
   * A 500 is waited out too, and for a reason worth stating. The seeded buyers
   * live under `acme.example`, a domain RFC 2606 reserves so that nothing can
   * be delivered to it — which is exactly why they are safe to test against.
   * But `NotificationPort` here is the live SMTP adapter, so it periodically
   * fails the send outright and the route answers 500. The code was still
   * issued; only the delivery failed, and the delivery is the part that must
   * not work.
   */
  const shown = page.getByTestId('prototype-code');
  const deadline = Date.now() + 150_000;
  for (;;) {
    await page.getByRole('button', { name: 'Send code' }).click();
    try {
      await shown.waitFor({ state: 'visible', timeout: 20_000 });
      break;
    } catch (cause) {
      const said = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
      // The limiter's own copy, from `RedisRateLimiter.consume`. Matched on
      // that rather than on words a field-validation message also uses.
      const minutes = /try again in (\d+) minute/i.exec(said);
      const cooling = /too many attempts/i.test(said) && Number(minutes?.[1] ?? 0) <= 1;
      const undelivered = /did not go through \(500\)/i.test(said);
      if ((cooling || undelivered) && Date.now() < deadline) {
        await page.waitForTimeout(undelivered ? 3_000 : 20_000);
        continue;
      }
      throw new Error(
        /too many attempts/i.test(said)
          ? `Rate-limited signing in as ${identifier}: "${said.slice(0, 200)}". ` +
            'One code a minute, five an hour and twenty a day to any one account.'
          : `No code appeared for ${identifier}. The screen says: "${said.slice(0, 250)}"`,
        { cause },
      );
    }
  }
  const code = ((await shown.textContent()) ?? '').replace(/\D/g, '').slice(-6);
  if (code.length !== 6) throw new Error(`Could not read the code off the screen: "${code}"`);

  for (const [i, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(digit);
  }

  await page.waitForURL((u) => !u.pathname.startsWith(`/${mode}`), { timeout: 60_000 });
}

/**
 * The first row on a board, taken from its own link rather than the database.
 *
 * `fallback` is what to measure when the board has no row at all. A detail
 * route with nothing to open still renders the full portal chrome around a
 * refusal, and that chrome can overflow exactly like a record can — so the
 * route is swept either way, and the caller is told which it got.
 */
async function firstRowId(
  page: Page,
  board: string,
  pattern: RegExp,
  fallback: string,
): Promise<{ id: string; real: boolean }> {
  await page.goto(`${STOREFRONT}${board}`, { waitUntil: 'networkidle' });
  const link = page.locator(`a[href^="${board}/"]`).first();
  try {
    await link.waitFor({ state: 'attached', timeout: 15_000 });
  } catch {
    return { id: fallback, real: false };
  }
  const href = (await link.getAttribute('href')) ?? '';
  const match = pattern.exec(href);
  return match?.[1] ? { id: match[1], real: true } : { id: fallback, real: false };
}

/** The newest order this buyer owns, read off `/orders`. */
export async function anOrderNumber(page: Page): Promise<string> {
  const { id, real } = await firstRowId(page, '/orders', /\/orders\/(TT-[0-9-]+)/, '');
  if (!real) throw new Error('No order on /orders — the sweep needs a buyer who has ordered.');
  return id;
}

/**
 * An approval to open, and whether it is a real one.
 *
 * Both rows seeded into `ordering.order_approval` expired in early September,
 * and the board excludes expired requests under every filter including
 * "Everything", so an owner signing in today sees none.
 */
export async function anApprovalId(page: Page): Promise<{ id: string; real: boolean }> {
  return firstRowId(
    page,
    '/approvals',
    /\/approvals\/([0-9a-f-]{36})/,
    '00000000-0000-4000-8000-000000000000',
  );
}

/**
 * Whether the page's content runs past the viewport, and by how much.
 *
 * Measured on `body`, not `documentElement`, and that is the whole subtlety.
 * `storefront.css:75` sets `html,body{overflow-x:clip}`, so a page that runs
 * past the right edge does not get a scrollbar — it gets silently cut off. The
 * consequence is that `documentElement.scrollWidth` can never exceed its
 * `clientWidth`, and a check written against it passes on every page whatever
 * the layout does. This one was, and reported zero overflow on nineteen routes
 * at four widths before a deliberately 2000px-wide element failed to move it.
 *
 * `body.scrollWidth` still grows with its content under `clip`, so it measures
 * what is actually there. One pixel of slack absorbs sub-pixel rounding.
 */
export async function overflow(page: Page): Promise<{ over: number; culprit: string | null }> {
  return page.evaluate(() => {
    const root = document.body;
    const over = root.scrollWidth - root.clientWidth;
    if (over <= 1) return { over: 0, culprit: null };

    // Name the widest element that crosses the right edge, so a failure says
    // what to fix rather than only that something is wrong.
    let worst: Element | null = null;
    let worstRight = root.clientWidth;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Anything inside a deliberate horizontal scroller is allowed to be wide.
      let scroller = el.parentElement;
      let inScroller = false;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          inScroller = true;
          break;
        }
        scroller = scroller.parentElement;
      }
      if (inScroller) continue;
      if (box.right > worstRight) {
        worstRight = box.right;
        worst = el;
      }
    }
    const name = worst
      ? `${worst.tagName.toLowerCase()}.${(worst.className || '').toString().split(/\s+/).slice(0, 3).join('.')}`
      : 'unknown';
    return { over, culprit: `${name} reaches ${Math.round(worstRight)}px` };
  });
}
