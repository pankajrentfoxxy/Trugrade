import { CartSkeleton } from './CartSkeleton';

/** The route segment's loading state. The screen's own read uses the same shape. */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <div className="body cartbody">
        <div className="wrap cartpage">
          <CartSkeleton />
        </div>
      </div>
    </>
  );
}
