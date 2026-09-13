import * as React from 'react';
import { ClauseHeading, EmptyState } from '@trugrade/ui';

/** ARCHETYPE B — Board. Statutory files. No document list endpoint exists yet. */

export function VendorDocumentsRoute(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <ClauseHeading n="01" kicker="Account" title="Documents" />
      <EmptyState title="No documents listed" body="Registration files are held on your profile." />
    </div>
  );
}
