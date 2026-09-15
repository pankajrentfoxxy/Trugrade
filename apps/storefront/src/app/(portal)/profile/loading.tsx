import { HubPageHeader, Skeleton } from '@trugrade/ui';

/** The route segment's loading state, in the frame the screen itself uses. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="hub-page">
      <HubPageHeader title="Your profile" />
      <Skeleton lines={8} />
    </div>
  );
}
