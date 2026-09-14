import * as React from 'react';
import { ClauseHeading, EmptyState, Skeleton } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, onDate, type VendorDocument } from './api';

/** ARCHETYPE B — Board. */

function expiryTone(expiresOn: string | null): 'neutral' | 'warn' | 'fail' {
  if (!expiresOn) return 'neutral';
  const days = Math.ceil((new Date(expiresOn).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'fail';
  if (days <= 30) return 'warn';
  return 'neutral';
}

export function VendorDocumentsRoute(): React.JSX.Element {
  const { data, error } = useResource<VendorDocument[]>(API.documents, 'Documents unavailable');

  if (error) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Documents" />
        <EmptyState title="Did not load" body={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Documents" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Account" title="Documents" />
        <EmptyState title="No documents" body="Upload on profile." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ClauseHeading n="01" kicker="Account" title="Documents" />
      <div className="overflow-x-auto border border-rule bg-sheet">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-sheet-2">
              {['Type', 'File', 'Uploaded', 'Expires', 'Status'].map((h) => (
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
            {data.map((d) => {
              const tone = expiryTone(d.expiresOn);
              return (
                <tr key={d.id} className="border-b border-rule-2 last:border-b-0">
                  <td className="px-3 py-2 text-ink">{d.label}</td>
                  <td className="px-3 py-2 text-ink-2">{d.originalFilename ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{onDate(d.uploadedAt)}</td>
                  <td
                    className={`px-3 py-2 font-mono tabular-nums ${
                      tone === 'fail' ? 'text-fail' : tone === 'warn' ? 'text-warn' : 'text-ink-2'
                    }`}
                  >
                    {d.expiresOn ? onDate(d.expiresOn) : '—'}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{d.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
