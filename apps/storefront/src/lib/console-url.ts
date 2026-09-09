/**
 * The supplier console — registration, listings, purchase orders.
 *
 * Buyers stay on the storefront; vendors and staff use the console. Every
 * "Become a supplier" / "Sell on Trugrade" link must land here, not on a
 * storefront route that duplicated the form.
 */

const LOCAL_CONSOLE = 'http://localhost:5173';

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function hostnameFromHostHeader(host: string): string {
  return host.split(':')[0] ?? host;
}

function envConsoleBase(): string | undefined {
  const url = process.env.CONSOLE_URL ?? process.env.NEXT_PUBLIC_CONSOLE_URL;
  if (!url) return undefined;
  return url.replace(/\/$/, '');
}

/**
 * Resolve the console origin for a request or browser tab.
 *
 * Order: `CONSOLE_URL` / `NEXT_PUBLIC_CONSOLE_URL`, then `seller.{domain}`
 * when the storefront is not localhost, then the dev default.
 */
export function resolveConsoleBaseUrl(
  host: string | null | undefined,
  protocol: string | undefined = undefined,
): string {
  const fromEnv = envConsoleBase();
  const hostname = host ? hostnameFromHostHeader(host) : undefined;
  const onLocalStorefront = !hostname || isLocalHost(hostname);

  if (fromEnv) {
    const envHost = new URL(fromEnv).hostname;
    // Ignore a baked-in localhost default on a live storefront host.
    if (onLocalStorefront || !isLocalHost(envHost)) {
      return fromEnv;
    }
  }

  if (hostname && !isLocalHost(hostname)) {
    const scheme = protocol?.replace(/:$/, '') || 'https';
    if (hostname.startsWith('seller.')) {
      return `${scheme}://${hostname}`;
    }
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return `${scheme}://seller.${parts.slice(-2).join('.')}`;
    }
  }

  return LOCAL_CONSOLE;
}

/** Console origin with no trailing slash — browser or server without a Host header. */
export function consoleBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return resolveConsoleBaseUrl(window.location.host, window.location.protocol.replace(':', ''));
  }
  return resolveConsoleBaseUrl(undefined);
}

export function consoleUrl(path = ''): string {
  const base = consoleBaseUrl();
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export const consoleSellRegisterUrl = (): string => consoleUrl('/sell/register');
