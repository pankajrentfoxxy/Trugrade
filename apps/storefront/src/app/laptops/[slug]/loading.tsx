import { Skeleton } from '@trugrade/ui';

/**
 * The loading state, in the shape of the thing that is loading.
 *
 * Next renders this while the page above fetches, so it is the real loading
 * state of the real route rather than a spinner bolted on — and it is what a
 * buyer sees on every pincode and grade change. It holds the record geometry
 * — the rail with its frame and strip on the left, the title, the price block
 * and the board on the right — so the page does not jump when the board lands:
 * a board that reflows on arrival makes the reader lose the row they had their
 * eye on.
 *
 * No prices, no counts, no placeholder numbers. A skeleton that shows a price
 * while loading has fabricated one, and the reader has already read it.
 */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <div className="body pdpbody">
        <main className="wrap pdp" aria-busy="true">
          <div className="pdp-top">
            <aside className="rail" aria-hidden="true">
              <div className="pv">
                <div className="pv-img pv-img-skel">
                  <Skeleton className="h-full" />
                </div>
                <ul className="gal-thumbs">
                  {Array.from({ length: 4 }, (_, i) => (
                    <li key={i}>
                      <span className="th th-skel" />
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
            <div className="det" aria-hidden="true">
              <Skeleton className="h-8 w-2/3" />
              <div className="meta-row">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-32 rounded-full" />
                <Skeleton className="h-7 w-28 rounded-full" />
              </div>
              <div className="price-blk">
                <Skeleton className="h-9 w-40" />
              </div>
              <div className="grades">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
              <div className="pin-blk">
                <div className="pin-line">
                  <Skeleton className="h-11 flex-1" />
                  <Skeleton className="h-11 w-36" />
                </div>
              </div>
              <div className="det-cta">
                <div className="pv-actions">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              </div>
            </div>
          </div>
          {/* The board lands under both columns, so its skeleton does too. */}
          <section className="pdp-evidence" aria-hidden="true">
            <div className="tbl-wrap tbl-skel">
              <Skeleton lines={6} />
            </div>
          </section>
        </main>
        <p className="fnote wrap" role="status">
          Reading the supply points that hold this machine…
        </p>
      </div>
    </>
  );
}
