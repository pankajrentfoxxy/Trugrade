import { redirect } from 'next/navigation';
import { consoleSellRegisterUrl } from '../../../lib/console-url';

/**
 * Vendor registration moved to the console. Any bookmark or old link here is
 * forwarded so cookies and the onboarding API stay on one origin.
 */
export default function Page(): never {
  // Outbound to the supplier console — not a storefront route in typedRoutes.
  redirect(consoleSellRegisterUrl() as never);
}
