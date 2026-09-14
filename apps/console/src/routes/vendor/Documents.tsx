import * as React from 'react';
import { Link } from 'react-router';
import { DataBoard, EmptyState, HubPageHeader, Skeleton, type Column } from '@trugrade/ui';
import { daysUntil } from '../../lib/clock';
import { Board, NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, onDate, type VendorDocument } from './api';

/** ARCHETYPE B — Board. */

function expiryTone(expiresOn: string | null): 'neutral' | 'warn' | 'fail' {
  if (!expiresOn) return 'neutral';
  const days = daysUntil(expiresOn);
  if (days < 0) return 'fail';
  if (days <= 30) return 'warn';
  return 'neutral';
}

const COLUMNS: ReadonlyArray<Column<VendorDocument>> = [
  { key: 'type', header: 'Type', cell: (d) => <span className="text-ink">{d.label}</span> },
  {
    key: 'file',
    header: 'File',
    cell: (d) =>
      d.originalFilename ?? (
        <NotMeasured label="No file name" why="The upload carried no file name." />
      ),
  },
  { key: 'uploaded', header: 'Uploaded', numeric: true, cell: (d) => onDate(d.uploadedAt) },
  {
    key: 'expires',
    header: 'Expires',
    numeric: true,
    cell: (d) => {
      if (!d.expiresOn)
        return <NotMeasured label="No expiry" why="This document type does not expire." />;
      const tone = expiryTone(d.expiresOn);
      return (
        <span
          className={tone === 'fail' ? 'text-fail' : tone === 'warn' ? 'text-warn' : 'text-ink-2'}
        >
          {onDate(d.expiresOn)}
        </span>
      );
    },
  },
  { key: 'status', header: 'Status', cell: (d) => <span className="text-ink-2">{d.status}</span> },
];

export function VendorDocumentsRoute(): React.JSX.Element {
  const { data, error } = useResource<VendorDocument[]>(API.documents, 'Documents unavailable');

  if (error) {
    return (
      <div>
        <HubPageHeader title="Documents" />
        <EmptyState title="Did not load" body={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <HubPageHeader title="Documents" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <HubPageHeader title="Documents" />
        <EmptyState
          title="No documents"
          body="Documents are uploaded in your supplier profile."
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
      <HubPageHeader title="Documents" />
      <Board tableMinWidth={720}>
        <DataBoard
          caption={`${data.length} ${data.length === 1 ? 'document' : 'documents'}.`}
          columns={COLUMNS}
          rows={data}
          rowKey={(d) => d.id}
        />
      </Board>
    </div>
  );
}
