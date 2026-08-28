'use client';

import * as React from 'react';
import { DataBoard, type Column } from '@trugrade/ui';
import type { PassportArea, PassportAreaStatus } from '../../../lib/api';

/**
 * The twelve functional areas, all twelve of them, always.
 *
 * This component exists because of one specific way this screen could lie. The
 * database stores an unmeasured area as an **absent row**, so a table driven by
 * the rows would render nine areas with nine ticks and simply not mention the
 * other three — and a reader counting ticks would conclude the machine passed
 * twelve checks. The API was changed to state the absence rather than omit it,
 * and this component's whole job is not to undo that: it renders whatever the
 * twelve entries say, and there is no filter anywhere in it.
 *
 * `DataBoard` rather than a hand-rolled grid: an area, a score, a bar and a
 * verdict is a table, and CLAUDE.md allows exactly one table component. A client
 * component because the cells are render functions and a function is not a
 * serialisable prop — the same call `UnitList` made on the product page.
 */

const AREA_LABEL: Record<string, string> = {
  DISPLAY: 'Display',
  KEYBOARD: 'Keyboard and trackpad',
  BATTERY: 'Battery',
  STORAGE: 'Storage',
  MEMORY_CPU: 'Memory and processor',
  PORTS: 'Ports',
  CONNECTIVITY: 'Wi-Fi and Bluetooth',
  CAMERA_AUDIO: 'Camera and audio',
  THERMAL: 'Thermals and fan',
  BIOS_SECURITY: 'BIOS and firmware security',
  DATA_SECURITY: 'Data security',
  PHYSICAL: 'Physical condition',
};

/**
 * PASS and FAIL are the only green and red on this page, and both carry their
 * word as well as their colour. WARN is `--warn`, which is neither — an area
 * that scored below its band is not a failed machine and must not be painted
 * like one.
 */
const STATUS_LABEL: Record<PassportAreaStatus, string> = {
  PASS: 'Pass',
  WARN: 'Attention',
  FAIL: 'Fail',
  NOT_MEASURED: 'Not measured',
};

export function Areas({ areas }: { areas: readonly PassportArea[] }): React.JSX.Element {
  const measured = areas.filter((a) => a.status !== 'NOT_MEASURED').length;

  const columns: ReadonlyArray<Column<PassportArea>> = [
    {
      key: 'area',
      header: 'Area',
      cell: (a) => <span className="areaname">{AREA_LABEL[a.area] ?? a.area}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      numeric: true,
      // No score, no number, and specifically no zero. A `0 / 10` here reads as
      // "we tested it and it failed completely"; the truth is that nobody
      // looked, and those are opposite claims about the same machine.
      cell: (a) =>
        a.score === null || a.maxScore === null ? (
          <span className="notmeasured">Not measured</span>
        ) : (
          <span className="mono">
            {a.score.toFixed(1)}
            <span className="denom"> / {a.maxScore}</span>
          </span>
        ),
    },
    {
      key: 'bar',
      header: 'Against the area maximum',
      // A bar at zero width is still a bar, and a reader scanning the column
      // sees an empty track where a measurement should be. An unmeasured area
      // gets no track at all.
      cell: (a) =>
        a.score === null || a.maxScore === null ? (
          <span className="notmeasured">&mdash;</span>
        ) : (
          <span className="ameter" role="img" aria-label={`${a.score} out of ${a.maxScore}`}>
            <b
              data-status={a.status}
              style={{ width: `${Math.round((a.score / a.maxScore) * 100)}%` }}
            />
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Result',
      cell: (a) => (
        <span className="astat" data-status={a.status}>
          {STATUS_LABEL[a.status]}
        </span>
      ),
    },
  ];

  return (
    <div className="tbl lview areas">
      <DataBoard
        caption={
          measured === areas.length
            ? `All ${areas.length} inspection areas for this machine, in the order they are tested. Every one was measured.`
            : `All ${areas.length} inspection areas for this machine, in the order they are tested. ${measured} of ${areas.length} were measured; the other ${areas.length - measured} were not, and carry no score.`
        }
        columns={columns}
        rows={areas}
        rowKey={(a) => a.area}
      />
    </div>
  );
}
