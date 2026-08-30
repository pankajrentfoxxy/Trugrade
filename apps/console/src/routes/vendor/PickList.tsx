import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Button, EmptyState, SealChip, Skeleton, type SealStatus } from '@trugrade/ui';
import { NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, gradeLabel, onDate, type PickList } from './api';

/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The pick list — `03_UX_SPEC.md` §3B.3, `/vendor/orders/[poId]/packing-list`.
 *
 * **This is a physical document.** Somebody stands in a warehouse holding a
 * laptop in one hand and reads a serial off this screen with the other, then
 * compares a seal code to a sticker. So every identifier is IBM Plex Mono with
 * tabular figures and extra letter-spacing, the rows are tall enough to keep a
 * finger on, and the serial and the seal sit side by side because they are
 * checked as a pair.
 *
 * **It contains no price, at any depth.** Bill-To-Ship-To under s.10(1)(b) IGST
 * means the vendor's invoice value never travels with the goods and neither does
 * ours — a price on a packing list is a compliance defect, not untidiness. The
 * server enforces it: `PickList` and `PurchaseOrderLine` are separate types and
 * only one of them has an amount on it.
 *
 * **There is no barcode.** `Barcode` in `@trugrade/ui` is placeholder geometry
 * that encodes nothing — recorded as such in the build ledger — and putting it
 * beside a real seal code here would invite somebody to scan a bar pattern that
 * decodes to nothing. Real Code 128 with a round-trip decode test is its own
 * task; until then the code is read, not scanned, and the screen does not
 * pretend otherwise.
 */

/**
 * Print rules, scoped to this route.
 *
 * The console's chrome is the shell's, and this is the one screen that has to
 * leave the browser. Rather than give the shell a print mode nothing else would
 * use, the three chrome landmarks are hidden here by the classes they already
 * carry.
 *
 * ponytail: targets the shell's own selectors. Move this into a shared print
 * stylesheet the second a second screen needs to print.
 */
const PRINT_CSS = `
@media print {
  header.tg-chrome, footer.tg-chrome, #section-rail, [data-print="hide"] { display: none !important; }
  body { background: #fff; }
  .tg-picklist, .tg-picklist * { color: #000 !important; background: transparent !important; }
  .tg-picklist tr { break-inside: avoid; }
  .tg-picklist th, .tg-picklist td { border-color: #999 !important; }
}
`;

export function VendorPickListRoute(): React.JSX.Element {
  const { poId = '' } = useParams();
  const { data, error } = useResource<PickList>(
    API.pickList(poId),
    'That pick list is unavailable',
  );

  if (error) {
    return (
      <EmptyState
        title="That pick list did not load"
        body={`${error}. If you followed a link, the purchase order may not be yours.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/orders">
            Back to your purchase orders
          </Link>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex max-w-[820px] flex-col gap-4">
        <Skeleton className="h-9 w-[280px]" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[52px] w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <style>{PRINT_CSS}</style>

      <div className="mb-4 flex flex-wrap items-center gap-4" data-print="hide">
        <Link
          className="text-ink underline underline-offset-4 hover:text-acc-ink"
          to={`/vendor/orders/${poId}`}
        >
          Back to {data.poNumber}
        </Link>
        {/* The one amber control on this screen, and the only thing it does.
            `Button` defaults to `secondary`; the primary is asked for by name. */}
        <Button variant="primary" className="ml-auto" onClick={() => window.print()}>
          Print this list
        </Button>
      </div>

      <article className="tg-picklist rounded-lg border border-rule bg-sheet p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
          <div>
            <h1 className="text-h2 text-ink">Pick list</h1>
            <p className="mt-1 text-body-sm text-ink-2">
              Purchase order{' '}
              <span className="font-mono tnum text-ink">{data.poNumber}</span>, raised{' '}
              <span className="font-mono tnum">{onDate(data.raisedAt)}</span>.
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Machines
            </span>
            <p className="font-mono tnum text-h2 text-ink">{data.units}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Deliver to
            </h2>
            {data.shipTo ? (
              <address className="mt-2 text-body-sm not-italic leading-[1.7] text-ink">
                {data.shipTo.line1}
                <br />
                {data.shipTo.line2 && (
                  <>
                    {data.shipTo.line2}
                    <br />
                  </>
                )}
                {data.shipTo.city}, {data.shipTo.state}{' '}
                <span className="font-mono tnum">{data.shipTo.pincode}</span>
                {data.shipTo.landmark && (
                  <>
                    <br />
                    <span className="text-ink-2">{data.shipTo.landmark}</span>
                  </>
                )}
              </address>
            ) : (
              <p className="mt-2">
                <NotMeasured
                  why="The delivery address on this order could not be resolved"
                  label="Destination unresolved — do not dispatch"
                />
              </p>
            )}
          </div>
          <div>
            <h2 className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Carrier reference
            </h2>
            <p className="mt-2">
              {/* No shipment has been raised for any purchase order on this
                  platform — `logistics.shipment` has no writer yet — so there is
                  no AWB and no pickup task to quote. Saying so is the honest
                  answer; printing a blank line reads as one already filled in. */}
              <NotMeasured
                why="No shipment has been raised against this purchase order yet, so there is no carrier reference"
                label="Not assigned yet"
              />
            </p>
            <p className="mt-2 text-body-sm text-ink-2">
              Quote the purchase-order number above. The rider scans each serial and each seal at
              your door and will not accept a machine that is not on this list.
            </p>
          </div>
        </section>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <caption className="sr-only">
              The {data.units} machines to produce against {data.poNumber}, by serial.
            </caption>
            <thead>
              <tr className="border-b border-rule">
                {['Serial', 'Seal code', 'Grade', 'Machine'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="py-2 pr-4 font-mono text-label uppercase tracking-[0.13em] text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                // 52px minimum: this is ticked off with a finger on a tablet on
                // a warehouse floor, not clicked with a mouse.
                <tr key={l.unitId} className="border-b border-rule-2 last:border-b-0">
                  <td className="py-4 pr-4 align-top">
                    {l.serialNumber ? (
                      <span className="font-mono tnum text-data tracking-[0.08em] text-ink">
                        {l.serialNumber}
                      </span>
                    ) : (
                      <NotMeasured
                        why="This machine is no longer on your stock records"
                        label="Serial unavailable"
                      />
                    )}
                  </td>
                  <td className="py-4 pr-4 align-top">
                    {l.sealCode ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono tnum text-data tracking-[0.08em] text-ink">
                          {l.sealCode}
                        </span>
                        {l.sealStatus && <SealChip status={l.sealStatus as SealStatus} />}
                      </span>
                    ) : (
                      <NotMeasured
                        why="No seal is recorded against this machine"
                        label="No seal recorded"
                      />
                    )}
                  </td>
                  <td className="py-4 pr-4 align-top font-mono tnum text-ink">
                    {gradeLabel(l.gradeAtPo)}
                  </td>
                  <td className="py-4 align-top text-body-sm text-ink-2">
                    {l.title ?? (
                      <NotMeasured
                        why="The catalog entry for this machine could not be read"
                        label="No catalog entry"
                      />
                    )}
                    {l.skuCode && (
                      <span className="mt-1 block font-mono text-body-sm text-ink-3">
                        {l.skuCode}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 border-t border-rule pt-4 text-body-sm text-ink-2">
          No prices appear on this document. Under s.10(1)(b) of the IGST Act the goods travel
          Bill-To-Ship-To, so neither your invoice value nor ours goes in the box.
        </p>
      </article>
    </div>
  );
}
