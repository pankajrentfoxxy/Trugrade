'use client';

import { usePathname } from 'next/navigation';

import { SiteFooter } from './SiteFooter';
import { isPortalPath } from './(portal)/shell/nav';

/**
 * Focus auth screens fill the viewport, and the buyer portal draws a footer of
 * its own inside its frame; the legal footer stays on every other route.
 */
const FOOTER_HIDDEN = new Set(['/sign-in', '/register', '/invite/accept']);

export function FooterGate(): React.JSX.Element | null {
  const pathname = usePathname();
  if (FOOTER_HIDDEN.has(pathname) || isPortalPath(pathname)) return null;
  return <SiteFooter />;
}
