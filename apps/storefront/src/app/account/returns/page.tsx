/**
 * ARCHETYPE B — Board. Filter + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Every return this organisation has raised — the list `03_UX_SPEC.md` §3A.4's
 * `/account/returns/[id]` needs in order to be reachable at all. A record screen
 * nothing links to is a screen only its author has ever opened, and the account
 * navigation had nowhere to send anyone before this.
 *
 * **A pending return is not amber and an open one is not green.** Green and red
 * are PASS and FAIL. "We have your machine and are looking at it" is neither, so
 * every state on the way through is neutral; the only red is a rejection, which
 * genuinely is a verdict, and the only green are the two outcomes that gave the
 * buyer their remedy.
 *
 * Board state lives in the URL, as it does everywhere: `?show=open` survives
 * being sent to a colleague.
 */
import type { Metadata } from 'next';
import { ReturnsBoard } from './ReturnsBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your returns',
  robots: { index: false, follow: false },
};

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const search = await searchParams;
  const query = new URLSearchParams(
    Object.entries(search).flatMap(([k, v]) =>
      v === undefined
        ? []
        : Array.isArray(v)
          ? v.map((one) => [k, one] as [string, string])
          : [[k, v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="body">
      <div className="wrap">
        <ReturnsBoard query={query} />
      </div>
    </div>
  );
}
