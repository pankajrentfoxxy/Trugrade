import * as React from 'react';
import { ClauseHeading, EmptyState, Skeleton } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, type VendorFacility } from './api';

/** ARCHETYPE B — Board. Pickup locations this vendor declared. */

export function VendorFacilitiesRoute(): React.JSX.Element {
  const { data, error } = useResource<VendorFacility[]>(API.facilities, 'Facilities are unavailable');

  if (error) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Facilities" />
        <EmptyState title="Facilities did not load" body={`${error}. Nothing has changed.`} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Facilities" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Facilities" />
        <EmptyState title="No facilities" body="Add a pickup location when you list stock." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ClauseHeading n="01" kicker="Account" title="Facilities" />
      <div className="overflow-x-auto border border-rule bg-sheet">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-sheet-2">
              {['Name', 'City', 'Pincode', 'Dispatch address'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.addressId} className="border-b border-rule-2 last:border-b-0">
                <td className="px-3 py-2 text-ink">{f.label}</td>
                <td className="px-3 py-2 text-ink-2">{f.city}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{f.pincode}</td>
                <td className="px-3 py-2 text-fail">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
