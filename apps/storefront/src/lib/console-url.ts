/**
 * The supplier console — registration, listings, purchase orders.
 *
 * Buyers stay on the storefront; vendors and staff use the console. Every
 * "Become a supplier" / "Sell on Trugrade" link must land here, not on a
 * storefront route that duplicated the form.
 */
export function consoleUrl(path = ''): string {
  const base = (process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export const consoleSellRegisterUrl = (): string => consoleUrl('/sell/register');
