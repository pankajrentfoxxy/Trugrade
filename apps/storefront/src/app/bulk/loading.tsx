import { CategoryStrip } from '../CategoryStrip';
import { BulkSkeleton } from './BulkIntake';

/** The route segment's loading state. The screen settles into the same shape. */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <CategoryStrip />
      <div className="body">
        <div className="wrap">
          <BulkSkeleton />
        </div>
      </div>
    </>
  );
}
