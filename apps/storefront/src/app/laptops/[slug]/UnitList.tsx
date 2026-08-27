'use client';

import * as React from 'react';
import { DataBoard, type Column } from '@trugrade/ui';
import type { OfferUnit } from '../../../lib/api';

/**
 * The serials behind one supply point, each linking to its unit passport.
 *
 * This is the list that makes the representative photographs above it honest:
 * every machine on offer has a real inspection report, reachable **before**
 * purchase and without an account, which is the r.7(2) and r.7(5) defence for
 * showing a grade photograph rather than a photograph of the exact laptop.
 *
 * `/unit/:serial` is T13 and does not exist yet. It is linked anyway, because
 * the route is the contract — the same call T11 made when it linked to this
 * page before this page existed.
 *
 * A client component because `DataBoard`'s columns carry render functions, and
 * a function is not a serialisable prop. One table component, storefront
 * density — writing a second table here is the failure the density rule exists
 * to prevent.
 */
const NOT_MEASURED = <span className="notmeasured">Not measured</span>;

export function UnitList({
  units,
  label,
}: {
  units: readonly OfferUnit[];
  /** `Supply Point F · Noida`, for the caption a screen reader hears. */
  label: string;
}): React.JSX.Element {
  const columns: ReadonlyArray<Column<OfferUnit>> = [
    {
      key: 'serial',
      header: 'Serial',
      cell: (u) => (
        <a className="ulink mono" href={`/unit/${encodeURIComponent(u.serialNumber)}`}>
          {u.serialNumber}
        </a>
      ),
    },
    {
      key: 'score',
      header: 'Inspection score',
      numeric: true,
      // No score means no number. A cell reading 0 says we opened it and it
      // scored nothing; the truth is that we hold no score for it.
      cell: (u) =>
        u.qcScore === null ? (
          NOT_MEASURED
        ) : (
          <span className="mono">
            {u.qcScore}
            <span className="denom"> / 100</span>
          </span>
        ),
    },
    {
      key: 'battery',
      header: 'Battery health',
      numeric: true,
      // Three of the seeded units genuinely have no battery reading. They must
      // not read as 0% beside a machine that measured 82%.
      cell: (u) =>
        u.batteryHealthPct === null ? (
          NOT_MEASURED
        ) : (
          <span className="mono">{u.batteryHealthPct}%</span>
        ),
    },
    {
      key: 'inspected',
      header: 'Inspected',
      cell: (u) =>
        u.inspectedOn === null ? NOT_MEASURED : <span className="mono">{u.inspectedOn}</span>,
    },
    {
      key: 'expires',
      header: 'Certificate valid to',
      cell: (u) =>
        u.expiresOn === null ? (
          NOT_MEASURED
        ) : (
          <span className="mono">
            {u.expiresOn}
            {u.expiresInDays !== null && u.expiresInDays <= 14 && (
              <span className="expsoon">
                {' '}
                Expires in {u.expiresInDays} day{u.expiresInDays === 1 ? '' : 's'}
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'itc',
      header: 'Tax',
      cell: (u) =>
        u.valuationMethod === 'MARGIN' ? (
          <span className="itc">GST on margin</span>
        ) : (
          <span className="mono">Regular</span>
        ),
    },
    {
      key: 'passport',
      header: 'Passport',
      headerHidden: true,
      cell: (u) => (
        <a className="sel gh" href={`/unit/${encodeURIComponent(u.serialNumber)}`}>
          Read the report
        </a>
      ),
    },
  ];

  return (
    <div className="tbl lview">
      <DataBoard
        caption={`${units.length} sealed unit${units.length === 1 ? '' : 's'} at ${label}, listed by serial.`}
        columns={columns}
        rows={units}
        rowKey={(u) => u.serialNumber}
      />
    </div>
  );
}
