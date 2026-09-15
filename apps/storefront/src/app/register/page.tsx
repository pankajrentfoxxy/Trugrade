import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { resolveConsoleBaseUrl } from '../../lib/console-url';
import { OtpSignIn } from '../sign-in/OtpSignIn';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Creating a buyer account: a mobile number and a code, and the buyer is
 * signed in and on their portal. Everything the five-step wizard used to ask
 * before letting anyone in — name, work email, GSTIN, company, delivery sites,
 * documents — is now filled in from `/profile`, one card at a time, whenever
 * suits. Ordering opens once that profile is verified.
 */

export const metadata: Metadata = {
  title: 'Create a buyer account',
  description:
    'Open a Trugrade buyer account with your mobile number and a code. Finish your company profile from your account whenever suits.',
  robots: { index: false, follow: false },
};

export default async function Page(): Promise<React.JSX.Element> {
  const h = await headers();
  const consoleBase = resolveConsoleBaseUrl(h.get('host'), h.get('x-forwarded-proto') ?? undefined);

  return <OtpSignIn mode="register" sellerRegisterUrl={`${consoleBase}/sell/register`} />;
}
