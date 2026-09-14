import * as React from 'react';
import { Link } from 'react-router';
import { DataBoard, EmptyState, HubPageHeader, Skeleton, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, type VendorFacility } from './api';

const COLUMNS: ReadonlyArray<Column<VendorFacility>> = [
  { key: 'name', header: 'Name', cell: (f) => <span className="text-ink">{f.label}</span> },
  {
    key: 'address',
    header: 'Address',
    cell: (f) => (
      <span className="text-ink-2">
        {f.line1}, {f.city} <span className="font-mono tnum">{f.pincode}</span>
      </span>
    ),
  },
  {
    key: 'dispatch',
    header: 'Dispatch from',
    // A missing dispatch address is a gap to fill, not a failure — never red.
    cell: (f) =>
      f.dispatchFrom ?? (
        <NotMeasured label="Not set" why="No dispatch address on this facility yet." />
      ),
  },
  { key: 'units', header: 'Units held', numeric: true, cell: (f) => f.unitsHeld },
];

/** ARCHETYPE B — Board. */

export function VendorFacilitiesRoute(): React.JSX.Element {
  const { data, error } = useResource<VendorFacility[]>(API.facilities, 'Facilities unavailable');

  if (error) {
    return (
      <div>
        <HubPageHeader title="Facilities" />
        <EmptyState title="Did not load" body={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <HubPageHeader title="Facilities" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <HubPageHeader title="Facilities" />
        <EmptyState
          title="No facilities"
          body="Pickup addresses are added in your supplier profile."
          action={
            <Link className="text-acc-ink underline underline-offset-4" to="/vendor/profile">
              Open profile
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HubPageHeader title="Facilities" />
      <Board tableMinWidth={720}>
        <DataBoard
          caption={`${data.length} ${data.length === 1 ? 'facility' : 'facilities'}.`}
          columns={COLUMNS}
          rows={data}
          rowKey={(f) => f.addressId}
        />
      </Board>
    </div>
  );
}
