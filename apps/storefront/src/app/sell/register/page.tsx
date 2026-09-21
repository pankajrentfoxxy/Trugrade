import { redirect } from 'next/navigation';
import { consoleSellRegisterUrlFromRequest } from '../../../lib/console-url.server';

/**
 * Vendor registration moved to the console. Any bookmark or old link here is
 * forwarded so cookies and the onboarding API stay on one origin.
 */
export default async function Page(): Promise<never> {
  // Outbound to the supplier console — not a storefront route in typedRoutes.
  redirect((await consoleSellRegisterUrlFromRequest()) as never);
}
