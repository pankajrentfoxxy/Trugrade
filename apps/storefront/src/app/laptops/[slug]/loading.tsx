import { Skeleton } from '@trugrade/ui';
import { CategoryStrip } from '../../CategoryStrip';

/**
 * The loading state, in the shape of the thing that is loading.
 *
 * Next renders this while the page above fetches, so it is the real loading
 * state of the real route rather than a spinner bolted on — and it is what a
 * buyer sees on every pincode and grade change. It holds the record geometry so
 * the page does not jump when the board lands: a board that reflows on arrival
 * makes the reader lose the row they had their eye on.
 *
 * No prices, no counts, no placeholder numbers. A skeleton that shows a price
 * while loading has fabricated one, and the reader has already read it.
 */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <CategoryStrip query="" />
      <div className="body">
        <div className="wrap">
          <div className="recskel" aria-hidden="true">
            <Skeleton lines={3} />
          </div>
          <div className="rec">
            <main className="evid">
              <div className="tbl" aria-hidden="true">
                <div className="tbh">
                  <b>Loading this machine…</b>
                </div>
                <div className="whybody">
                  <Skeleton lines={10} />
                </div>
              </div>
            </main>
            <div className="sidep" aria-hidden="true">
              <div className="tbl">
                <div className="tbh">
                  <b>Deliver to</b>
                </div>
                <div className="whybody">
                  <Skeleton lines={5} />
                </div>
              </div>
            </div>
          </div>
          <p className="fnote" role="status">
            Reading the supply points that hold this machine…
          </p>
        </div>
      </div>
    </>
  );
}
