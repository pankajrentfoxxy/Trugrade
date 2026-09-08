import type { CookieOptions, Request } from 'express';

/** Which first-party client established or is presenting the session. */
export type SessionAudience = 'storefront' | 'console';

/** Org types that can appear in a session token. */
export type PortalOrgType = 'VENDOR' | 'BUYER' | 'PLATFORM';

export const STOREFRONT_ACCESS_COOKIE = 'tg_access';
export const STOREFRONT_REFRESH_COOKIE = 'tg_refresh';
export const CONSOLE_ACCESS_COOKIE = 'tg_co_access';
export const CONSOLE_REFRESH_COOKIE = 'tg_co_refresh';

/**
 * The refresh cookie is scoped to the only paths that may present it. A cookie
 * sent on every API call leaks through every logging proxy and every mis-scoped
 * subresource; this one rides along on four routes.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** Absorbs request latency, so the browser never sends a token the server has just aged out. */
export const ACCESS_COOKIE_SKEW_SECONDS = 30;

/** Explicit client hint — set by the dev proxy when Origin/Referer are absent. */
export const AUDIENCE_HEADER = 'x-trugrade-audience';

export interface SessionCookieNames {
  access: string;
  refresh: string;
}

export function cookieNamesFor(audience: SessionAudience): SessionCookieNames {
  return audience === 'console'
    ? { access: CONSOLE_ACCESS_COOKIE, refresh: CONSOLE_REFRESH_COOKIE }
    : { access: STOREFRONT_ACCESS_COOKIE, refresh: STOREFRONT_REFRESH_COOKIE };
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function parseAudienceHeader(value: string | undefined): SessionAudience | null {
  if (value === 'storefront' || value === 'console') return value;
  return null;
}

/**
 * Decide which cookie namespace applies to this request.
 *
 * localhost shares one host across ports, so the names must differ. In
 * production the hostnames differ too, but matching on Origin keeps the rule
 * explicit and lets integration tests default to the storefront namespace.
 */
export function resolveSessionAudience(
  req: Pick<Request, 'headers'>,
  storefrontUrl: string,
  consoleUrl: string,
): SessionAudience {
  const hinted = parseAudienceHeader(req.headers[AUDIENCE_HEADER] as string | undefined);
  if (hinted) return hinted;

  const storefrontOrigin = originOf(storefrontUrl);
  const consoleOrigin = originOf(consoleUrl);

  const candidates: string[] = [];
  if (req.headers.origin) candidates.push(req.headers.origin);
  if (req.headers.referer) {
    try {
      candidates.push(new URL(req.headers.referer).origin);
    } catch {
      /* malformed referer — skip */
    }
  }

  for (const raw of candidates) {
    try {
      const origin = new URL(raw).origin;
      if (origin === consoleOrigin) return 'console';
      if (origin === storefrontOrigin) return 'storefront';
    } catch {
      /* skip */
    }
  }

  return 'storefront';
}

export function readSessionCookie(
  req: { cookies?: Record<string, string> },
  name: string,
): string | undefined {
  return req.cookies?.[name];
}

export function extractSessionAccessToken(
  req: Pick<Request, 'headers'> & { cookies?: Record<string, string> },
  storefrontUrl: string,
  consoleUrl: string,
): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  const audience = resolveSessionAudience(req, storefrontUrl, consoleUrl);
  const { access } = cookieNamesFor(audience);
  return readSessionCookie(req, access);
}

/**
 * Cookie domain is derived from the client URL in production so buyer and vendor
 * hosts never share a jar. In development the attribute is omitted entirely —
 * separation on localhost is by cookie *name*, not domain.
 */
export function cookieDomainForAudience(
  audience: SessionAudience,
  storefrontUrl: string,
  consoleUrl: string,
  isProduction: boolean,
): string | undefined {
  if (!isProduction) return undefined;
  const url = audience === 'console' ? consoleUrl : storefrontUrl;
  return new URL(url).hostname;
}

export function cookieOptionsForAudience(
  audience: SessionAudience,
  storefrontUrl: string,
  consoleUrl: string,
  isProduction: boolean,
): CookieOptions {
  return {
    httpOnly: true,
    // Lax rather than Strict: Strict drops the cookie on a plain link into the
    // console from an email, which reads to the user as a random signed-out
    // state. Lax still withholds it from every cross-site POST, which is the
    // CSRF case that matters.
    sameSite: 'lax',
    secure: isProduction,
    domain: cookieDomainForAudience(audience, storefrontUrl, consoleUrl, isProduction),
    path: '/',
  };
}

/** Buyers use the storefront; vendors and platform staff use the console. */
export function isOrgTypeAllowedOnAudience(
  orgType: PortalOrgType,
  audience: SessionAudience,
): boolean {
  if (audience === 'storefront') return orgType === 'BUYER';
  return orgType === 'VENDOR' || orgType === 'PLATFORM';
}

export function wrongPortalMessage(
  orgType: PortalOrgType,
  audience: SessionAudience,
  storefrontUrl: string,
  consoleUrl: string,
): string {
  if (audience === 'console' && orgType === 'BUYER') {
    return `This account is for buyers. Sign in at ${storefrontUrl} to shop and manage orders.`;
  }
  if (audience === 'storefront' && (orgType === 'VENDOR' || orgType === 'PLATFORM')) {
    return `This account is for vendors and staff. Sign in at ${consoleUrl} to manage your supplier account.`;
  }
  return 'This account cannot be used on this site.';
}
