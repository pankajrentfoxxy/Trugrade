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
      <div className="body">
        <div className="wrap pdp" aria-busy="true">
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
              <div className="pv-actions">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            </div>
          </aside>
          <main className="det" aria-hidden="true">
            <Skeleton className="h-8 w-2/3" />
            <div className="meta-row">
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-7 w-32 rounded-full" />
              <Skeleton className="h-7 w-28 rounded-full" />
            </div>
            <div className="price-blk">
              <Skeleton className="h-9 w-40" />
              <div className="pin-line">
                <Skeleton className="h-11 flex-1" />
                <Skeleton className="h-11 w-36" />
              </div>
            </div>
            <div className="tbl-wrap tbl-skel">
              <Skeleton lines={6} />
            </div>
          </main>
        </div>
        <p className="fnote wrap" role="status">
          Reading the supply points that hold this machine…
        </p>
      </div>
    </>
  );
}
