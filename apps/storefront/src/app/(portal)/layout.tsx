import { PortalShell } from './shell/PortalShell';
import '@trugrade/ui/hub.css';

/**
 * The buyer portal — every screen a signed-in buying organisation works from.
 *
 * One frame for eight routes: `/home`, `/orders`, `/approvals`, `/returns`,
 * `/warranty`, `/addresses`, `/team` and `/profile`. The frame checks the
 * session and sends a visitor without one to sign in; nothing inside it
 * renders for an anonymous request. See `shell/PortalContext.tsx` for why the
 * check lives on the client rather than in a middleware.
 *
 * The inline script below runs before the first paint of anything after it, so
 * the hub tokens are on the root element before the masthead is drawn — the
 * same trick the root layout uses for the theme, and for the same reason: a
 * frame that paints dark and then flips to white is a flash on every reload.
 */
const SURFACE_PREPAINT_SCRIPT = "document.documentElement.setAttribute('data-surface','hub');";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SURFACE_PREPAINT_SCRIPT }} />
      <PortalShell>{children}</PortalShell>
    </>
  );
}
