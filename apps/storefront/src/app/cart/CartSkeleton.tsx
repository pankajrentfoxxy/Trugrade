import { Skeleton } from '@trugrade/ui';

/**
 * The cart while it is being read, in the shape of the cart.
 *
 * Shared by two loading states that a buyer cannot tell apart and should not
 * have to: `loading.tsx` covers the route segment, and the screen itself shows
 * this while the authenticated read is in flight — which on a slow connection is
 * the longer of the two by far. One component so the page does not change shape
 * as it crosses from one to the other: the title, the grouped lines on the left
 * and the summary rail on the right.
 *
 * No counts, no prices, no placeholder quantities. A skeleton that shows a
 * number has invented one, and on this screen the numbers are the whole point.
 */
export function CartSkeleton(): React.JSX.Element {
  return (
    <>
      <div className="cartlayout">
        <main className="cartlayout-lead" aria-hidden="true">
          <h1 className="ct-title">Your cart</h1>
          <section className="grp">
            <div className="grp-h">
              <Skeleton className="w-48" />
            </div>
            <div className="grp-card skel">
              <Skeleton lines={6} />
            </div>
          </section>
        </main>
        <div className="cartlayout-side" aria-hidden="true">
          <div className="sum">
            <h2>This order</h2>
            <div className="skel">
              <Skeleton lines={5} />
            </div>
          </div>
        </div>
      </div>
      <p className="fnote" role="status">
        Reading your cart and re-checking what is still available…
      </p>
    </>
  );
}
