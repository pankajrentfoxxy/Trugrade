import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Button, EmptyState, GradeBadge, SealChip, Skeleton, type SealStatus } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, gradeLabel, onDate, type PickList, type PickListModelGroup } from './api';

/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The pick list — `03_UX_SPEC.md` §3B.3, `/vendor/orders/[poId]/pick-list`.
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
  .tg-picklist input[type="checkbox"] { accent-color: #000; }
}
`;

function ModelGroupBlock({
  group,
  picked,
  onToggle,
}: {
  group: PickListModelGroup;
  picked: Set<string>;
  onToggle: (unitId: string) => void;
}): React.JSX.Element {
  return (
    <section className="mt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <GradeBadge grade={group.gradeAtPo as Grade} />
          <h2 className="text-body font-medium text-ink">{group.title ?? 'Unknown model'}</h2>
          {group.skuCode && (
            <span className="font-mono text-body-sm text-ink-3">{group.skuCode}</span>
          )}
        </div>
        <span className="font-mono tnum text-body-sm text-ink-2">
          {group.attachedCount} of {group.requiredCount}
        </span>
      </header>

      <table className="mt-2 w-full min-w-[620px] border-collapse text-left">
        <caption className="sr-only">
          {group.title ?? 'Machines'} — grade {gradeLabel(group.gradeAtPo)}
        </caption>
        <thead>
          <tr className="border-b border-rule">
            {['', 'Serial', 'Seal code'].map((h) => (
              <th
                key={h || 'pick'}
                scope="col"
                className="py-2 pr-4 font-mono text-label uppercase tracking-[0.13em] text-ink-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.machines.map((m) => (
            <tr key={m.unitId} className="border-b border-rule-2 last:border-b-0">
              <td className="py-4 pr-3 align-top">
                <input
                  type="checkbox"
                  className="size-4 accent-acc"
                  checked={picked.has(m.unitId)}
                  onChange={() => onToggle(m.unitId)}
                  aria-label={`Picked ${m.serialNumber ?? m.unitId}`}
                />
              </td>
              <td className="py-4 pr-4 align-top">
                {m.serialNumber ? (
                  <span className="font-mono tnum text-data tracking-[0.08em] text-ink">
                    {m.serialNumber}
                  </span>
                ) : (
                  <NotMeasured
                    why="This machine is no longer on your stock records"
                    label="Serial unavailable"
                  />
                )}
              </td>
              <td className="py-4 pr-4 align-top">
                {m.sealCode ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tnum text-data tracking-[0.08em] text-ink">
                      {m.sealCode}
                    </span>
                    {m.sealStatus && <SealChip status={m.sealStatus as SealStatus} />}
                  </span>
                ) : (
                  <NotMeasured
                    why="No seal is recorded against this machine"
                    label="No seal recorded"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function VendorPickListRoute(): React.JSX.Element {
  const { poId = '' } = useParams();
  const { data, error } = useResource<PickList>(
    API.pickList(poId),
    'That pick list is unavailable',
  );
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set());

  function togglePick(unitId: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

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

  const groups =
    data.modelGroups?.length > 0
      ? data.modelGroups
      : [
          {
            title: null,
            skuCode: null,
            gradeAtPo: data.lines[0]?.gradeAtPo ?? 'A',
            attachedCount: data.lines.length,
            requiredCount: data.lines.length,
            machines: data.lines.map((l) => ({
              unitId: l.unitId,
              serialNumber: l.serialNumber,
              sealCode: l.sealCode,
              sealStatus: l.sealStatus,
            })),
          },
        ];

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

        {groups.map((group, i) => (
          <ModelGroupBlock
            key={`${group.skuCode ?? 'sku'}-${group.gradeAtPo}-${i}`}
            group={group}
            picked={picked}
            onToggle={togglePick}
          />
        ))}

        <p className="mt-6 border-t border-rule pt-4 text-body-sm text-ink-2">
          No prices appear on this document. Under s.10(1)(b) of the IGST Act the goods travel
          Bill-To-Ship-To, so neither your invoice value nor ours goes in the box.
        </p>
      </article>
    </div>
  );
}
