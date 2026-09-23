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
    <div className="hub-page" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
