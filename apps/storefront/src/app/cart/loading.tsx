import { CategoryStrip } from '../CategoryStrip';
import { CartSkeleton } from './CartSkeleton';

/** The route segment's loading state. The screen's own read uses the same shape. */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <CategoryStrip />
      <div className="body">
        <div className="wrap cartpage">
          <CartSkeleton />
        </div>
      </div>
    </>
  );
}
