import 'server-only';
import { headers } from 'next/headers';
import { resolveConsoleBaseUrl } from './console-url';

/**
 * The console origin, resolved against the request that is actually being
 * served.
 *
 * **Why this exists.** `consoleBaseUrl()` in `./console-url` has to stay
 * client-safe — `AuthModal` imports it — so it cannot reach for `next/headers`.
 * On the server it therefore resolved with *no host at all*, and when
 * `CONSOLE_URL` is missing from the running process there was nothing left to
 * derive from: every "Sell on Trugrade" link fell to `http://localhost:5173`,
 * on a live domain, in front of buyers. `console-url.spec.ts` pins that case.
 *
 * With the Host header in hand the same helper derives `seller.{domain}`, so a
 * missing environment variable degrades to the right host instead of to a
 * machine that is not the buyer's. The environment variable still wins when it
 * is set; this is the floor under it, not a replacement for it.
 *
 * `x-forwarded-proto` first, because in production Next sits behind a proxy
 * that terminates TLS and the origin connection is plain HTTP.
 */
async function baseUrl(): Promise<string> {
  const h = await headers();
  return resolveConsoleBaseUrl(
    h.get('host'),
    h.get('x-forwarded-proto') ?? undefined,
  );
}

export async function consoleUrlFromRequest(path = ''): Promise<string> {
  const base = await baseUrl();
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The console's front door — every "Sell on Trugrade" link. */
export const consoleHomeUrlFromRequest = (): Promise<string> => consoleUrlFromRequest('/');

/** The supplier registration form, for callers that deep-link to it. */
export const consoleSellRegisterUrlFromRequest = (): Promise<string> =>
  consoleUrlFromRequest('/sell/register');
