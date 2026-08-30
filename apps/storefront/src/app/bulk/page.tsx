/**
 * ARCHETYPE D — Flow. Step rail + one step + "why we ask" rail.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Bulk requirement intake — PHASE_05 Task 7. A procurement head has a
 * spreadsheet, not a search query, and this is the screen that turns one into an
 * answer: hand over the list, and get back what we can fill today, what we
 * cannot, and a reference for the rest.
 *
 * Archetype D and not B: there is no result set to filter, sort or page. There
 * is one task with two states — the list going in and the answer coming back —
 * and a rail that says which of the two you are looking at. The two answers
 * themselves are `DataBoard`, the same table every other screen uses, at the
 * storefront's comfortable density.
 *
 * Five rules shape everything on it.
 *
 * **1. No vendor sees any of this, and the screen says so out loud.** Under the
 * merchant-of-record model we buy the machines and sell them on our own invoice,
 * so sourcing against a requirement is *our* job. Circulating a buyer's list to
 * suppliers for quotes would change who the seller is, whose invoice the buyer
 * gets, the anonymity model and the GST treatment all at once — see
 * `RfqIntakeService`'s header, which is explicit that `ordering.rfq_quote`
 * survives from an earlier marketplace design and that nothing writes to it.
 * Nothing on this screen implies a supplier is being asked to quote, and the
 * sentence saying so appears twice: in the rail before the list is sent, and
 * beside the reference afterwards.
 *
 * **2. A row that cannot be parsed is reported, never dropped.** The server
 * returns every rejected row with the line number from the buyer's own file and
 * what was expected of it, and this screen renders all of them in their own
 * panel, under a heading that says they are in neither of the other two lists.
 * A procurement head whose line 47 vanished does not notice until it matters.
 *
 * **3. A file is what its first bytes say it is.** The extension and the
 * browser's `Content-Type` are both the client's to choose, so neither decides
 * anything: the bytes are read, the signature is checked, and an Excel workbook
 * named `list.csv` is refused by name with the conversion that fixes it. The
 * server remains the trust boundary — it takes a capped string and reports every
 * row it could not read — and this check exists so that the person holding the
 * file gets one sentence about the file rather than two hundred about its rows.
 *
 * **4. Nothing here is a price and nothing here is an order.** The intake says
 * what is sellable now; the landed price still belongs to the comparison board,
 * because it depends on the delivery pincode and the tax head. Every matched row
 * links there rather than quoting a figure this screen did not land.
 *
 * **5. Absences render as absences.** A line with no grade says "No preference",
 * not A+. A line with no needed-by date says "Not given". A file that produced
 * no lead reference says "Not issued" — and says that the list should therefore
 * be treated as not yet raised.
 *
 * The screen is a client component: the call is authenticated against the
 * buyer's session cookie, a signed-out visitor is a state it renders rather than
 * a crash, and the file is read in the browser before a byte of it is sent.
 */
import type { Metadata } from 'next';
import { CategoryStrip } from '../CategoryStrip';
import { BulkIntake } from './BulkIntake';

/** One organisation's requirement. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bulk requirement',
  description:
    'Send a requirement list and see what we hold right now, what we do not, and what our sourcing desk picks up.',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<React.JSX.Element> {
  const query = await searchParams;

  return (
    <>
      <CategoryStrip />
      <div className="body">
        <div className="wrap">
          {/* The homepage strip posts `?q=` and the comparison board links here
              with `?pin=` already known. Both prefill the first typed line
              rather than being thrown away — a buyer who typed a requirement
              into the homepage should not have to type it again. */}
          <BulkIntake initialModel={first(query['q'])} initialPincode={first(query['pin'])} />
        </div>
      </div>
    </>
  );
}
