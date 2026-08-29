import { Skeleton } from '@trugrade/ui';

/**
 * The cart while it is being read, in the shape of the cart.
 *
 * Shared by two loading states that a buyer cannot tell apart and should not
 * have to: `loading.tsx` covers the route segment, and the screen itself shows
 * this while the authenticated read is in flight — which on a slow connection is
 * the longer of the two by far. One component so the page does not change shape
 * as it crosses from one to the other.
 *
 * No counts, no prices, no placeholder quantities. A skeleton that shows a
 * number has invented one, and on this screen the numbers are the whole point.
 */
export function CartSkeleton(): React.JSX.Element {
  return (
    <>
      <div className="recskel" aria-hidden="true">
        <Skeleton lines={2} />
      </div>
      <div className="rec">
        <main className="evid" aria-hidden="true">
          <div className="tbl">
            <div className="tbh">
              <b>Loading your cart…</b>
            </div>
            <div className="whybody">
              <Skeleton lines={8} />
            </div>
          </div>
        </main>
        <div className="sidep" aria-hidden="true">
          <div className="tbl">
            <div className="tbh">
              <b>This order</b>
            </div>
            <div className="whybody">
              <Skeleton lines={5} />
            </div>
          </div>
        </div>
      </div>
      <p className="fnote" role="status">
        Reading your carts and re-checking what is still available…
      </p>
    </>
  );
}
