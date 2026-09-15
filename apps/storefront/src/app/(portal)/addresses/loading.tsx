import { Skeleton } from '@trugrade/ui';

/** The route segment's loading state. The screen's own read uses the same shape. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <div className="oskel">
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="oskelrec">
            <Skeleton className="h-96 w-full rounded-lg" />
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
