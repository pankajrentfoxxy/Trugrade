import { OrderSkeleton } from './OrderRecord';

/** The route segment's loading state. The screen's own read uses the same shape. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <OrderSkeleton />
      </div>
    </div>
  );
}
