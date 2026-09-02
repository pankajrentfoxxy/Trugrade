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
 * `cards` is the default on the passport: the evidence column sits beside a
 * sticky panel and a wide table scrolls sideways. `table` remains for tests and
 * any full-width board that needs the shared `DataBoard`.
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

const STATUS_LABEL: Record<PassportAreaStatus, string> = {
  PASS: 'Pass',
  WARN: 'Attention',
  FAIL: 'Fail',
  NOT_MEASURED: 'Not measured',
};

function areaCaption(areas: readonly PassportArea[], measured: number): string {
  return measured === areas.length
    ? `All ${areas.length} inspection areas for this machine, in the order they are tested. Every one was measured.`
    : `All ${areas.length} inspection areas for this machine, in the order they are tested. ${measured} of ${areas.length} were measured; the other ${areas.length - measured} were not, and carry no score.`;
}

function AreaScore({ area }: { area: PassportArea }): React.JSX.Element {
  if (area.score === null || area.maxScore === null) {
    return <span className="notmeasured">Not measured</span>;
  }
  return (
    <span className="mono">
      {area.score.toFixed(1)}
      <span className="denom"> / {area.maxScore}</span>
    </span>
  );
}

function AreaBar({ area }: { area: PassportArea }): React.JSX.Element {
  if (area.score === null || area.maxScore === null) {
    return <span className="notmeasured">&mdash;</span>;
  }
  return (
    <span className="ameter" role="img" aria-label={`${area.score} out of ${area.maxScore}`}>
      <b
        data-status={area.status}
        style={{ width: `${Math.round((area.score / area.maxScore) * 100)}%` }}
      />
    </span>
  );
}

function AreaCard({ area }: { area: PassportArea }): React.JSX.Element {
  return (
    <article className="area-card">
      <div className="area-card-head">
        <h3 className="areaname">{AREA_LABEL[area.area] ?? area.area}</h3>
        <span className="astat" data-status={area.status}>
          {STATUS_LABEL[area.status]}
        </span>
      </div>
      <div className="area-card-grid">
        <div>
          <span className="area-card-label">Score</span>
          <AreaScore area={area} />
        </div>
        <div className="area-card-barcell">
          <span className="area-card-label">Against maximum</span>
          <AreaBar area={area} />
        </div>
      </div>
    </article>
  );
}

export function Areas({
  areas,
  layout = 'cards',
}: {
  areas: readonly PassportArea[];
  layout?: 'cards' | 'table';
}): React.JSX.Element {
  const measured = areas.filter((a) => a.status !== 'NOT_MEASURED').length;
  const caption = areaCaption(areas, measured);

  if (layout === 'table') {
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
        cell: (a) => <AreaScore area={a} />,
      },
      {
        key: 'bar',
        header: 'Against the area maximum',
        cell: (a) => <AreaBar area={a} />,
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
        <DataBoard caption={caption} columns={columns} rows={areas} rowKey={(a) => a.area} />
      </div>
    );
  }

  return (
    <div className="tbl areas areas-cards">
      <div role="status" aria-live="polite" className="sr-only">
        {caption}
      </div>
      <ul className="area-cards">
        {areas.map((area) => (
          <li key={area.area}>
            <AreaCard area={area} />
          </li>
        ))}
      </ul>
    </div>
  );
}
