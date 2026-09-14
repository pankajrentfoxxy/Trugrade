import * as React from 'react';
import { HubPageHeader, EmptyState, Skeleton } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, type VendorFacility } from './api';

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
        <EmptyState title="No facilities" body="Add one in profile." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HubPageHeader title="Facilities" />
      <div className="overflow-x-auto border border-rule bg-sheet">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-sheet-2">
              {['Name', 'Address', 'Dispatch from', 'Units held'].map((h) => (
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
                <td className="px-3 py-2 text-ink-2">
                  {f.line1}, {f.city}{' '}
                  <span className="font-mono tnum">{f.pincode}</span>
                </td>
                <td className={`px-3 py-2 ${f.dispatchFrom ? 'text-ink-2' : 'text-fail'}`}>
                  {f.dispatchFrom ?? '—'}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">{f.unitsHeld}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
