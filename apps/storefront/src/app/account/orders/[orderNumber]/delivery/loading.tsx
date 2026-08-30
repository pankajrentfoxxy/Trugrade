import { Skeleton } from '@trugrade/ui';

/**
 * The route segment's loading state.
 *
 * The screen's own first paint uses its `loading` phase instead, which keeps the
 * heading and the consignment shape on screen while the manifest arrives. This
 * is only what shows before the segment itself has rendered.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <div className="wshead dvhead">
          <Skeleton className="h-9 w-96 rounded" />
        </div>
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-4 h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}
