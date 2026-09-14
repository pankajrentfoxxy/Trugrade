/**
 * How many reverse proxies stand between the internet and this process.
 *
 * Exactly one: nginx, which appends the connecting address to X-Forwarded-For
 * (`$proxy_add_x_forwarded_for`). Express then takes the rightmost entry as
 * `req.ip`, which is the address nginx itself saw.
 *
 * Unset, `req.ip` was nginx's own 127.0.0.1 for every visitor, so every "per-IP"
 * limit — twenty sign-ins per fifteen minutes, ten registrations a day — was one
 * bucket shared by the whole platform. `true` would be worse than unset: Express
 * would take the LEFTMOST entry, which the client writes, and anyone could mint
 * a fresh rate-limit bucket per request.
 */
export const TRUSTED_PROXY_HOPS = 1;

export function applyTrustedProxy(expressApp: {
  set(setting: string, value: unknown): unknown;
}): void {
  expressApp.set('trust proxy', TRUSTED_PROXY_HOPS);
}
