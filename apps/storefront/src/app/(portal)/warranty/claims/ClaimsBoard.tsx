'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { DataBoard, EmptyState, HubPageHeader, StatusPill, type Column } from '@trugrade/ui';
import type { ApiFailure } from '../../../register/api';
import { getClaims, type ClaimView } from '../api';

/**
 * ARCHETYPE B — Board. Every warranty claim this organisation has raised.
 *
 * **The nine claims nobody could open.** The warranty board's KPI read
 * "Open claims: 2 of 11 raised", and the only link it drew was `m.openClaim` —
 * the server's register query excludes `CLOSED` and `REJECTED` by design, so
 * nine counted claims had no route to them at all. A figure a screen counts and
 * cannot open is a figure that invites a support call.
 *
 * `GET /buyer/warranty/claims` has always returned every claim including the
 * settled ones. Only this screen was missing.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; claims: ClaimView[] };

const problem = (f: ApiFailure): string =>
  f.code === 'UNKNOWN' || f.code === 'NETWORK'
    ? 'We could not reach your claims just now. That is our problem, not yours — nothing about them has changed.'
    : f.message;

/** Settled, in the sense that nothing more is expected from either side. */
const TERMINAL = new Set(['CLOSED', 'REJECTED', 'RESOLVED']);

const TONE: Readonly<Record<string, 'pass' | 'fail' | 'info' | 'neutral'>> = {
  RESOLVED: 'pass',
  CLOSED: 'neutral',
  REJECTED: 'fail',
};

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function ClaimsBoard(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [show, setShow] = React.useState<'all' | 'open' | 'settled'>('all');

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getClaims();
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', claims: result.data.claims });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, []);

  const all = phase.k === 'ready' ? phase.claims : [];
  const open = all.filter((c) => !TERMINAL.has(c.status));
  const rows =
    show === 'open' ? open : show === 'settled' ? all.filter((c) => TERMINAL.has(c.status)) : all;

  const columns: Column<ClaimView>[] = [
    {
      key: 'claimNumber',
      header: 'Claim',
      cell: (c) => (
        <Link className="hub-link" href={`/warranty/claims/${c.claimNumber}` as Route}>
          <span className="font-mono tnum">{c.claimNumber}</span>
        </Link>
      ),
    },
    {
      key: 'serialNumber',
      header: 'Machine',
      cell: (c) => (
        <>
          <span className="font-mono tnum">{c.serialNumber}</span>
          {/* Never an invented title: a withdrawn SKU says nothing here. */}
          {c.title ? <div className="text-body-sm text-ink-3">{c.title}</div> : null}
        </>
      ),
    },
    { key: 'faultArea', header: 'Fault', cell: (c) => c.faultArea.replace(/_/g, ' ') },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <StatusPill
          tone={TONE[c.status] ?? 'info'}
          label={c.status.replace(/_/g, ' ').toLowerCase()}
        />
      ),
    },
    {
      key: 'raisedOn',
      header: 'Raised',
      cell: (c) => <span className="font-mono tnum">{day(c.raisedOn)}</span>,
    },
    {
      key: 'closedOn',
      header: 'Settled',
      // A claim still open says so, in --ink-4. It never reads as a date.
      cell: (c) =>
        c.closedOn ? (
          <span className="font-mono tnum">{day(c.closedOn)}</span>
        ) : (
          <span className="ink4">Still open</span>
        ),
    },
  ];

  if (phase.k === 'error') {
    return (
      <>
        <HubPageHeader title="Warranty claims" />
        <EmptyState title="Your claims did not load" body={phase.message} />
      </>
    );
  }

  return (
    <>
      <HubPageHeader
        title="Warranty claims"
        subtitle={
          phase.k === 'loading'
            ? undefined
            : `${all.length} ${all.length === 1 ? 'claim' : 'claims'}`
        }
      />

      <div className="rbar wtbar">
        <span className="cnt">
          {phase.k === 'loading' ? (
            'Loading…'
          ) : (
            <>
              <b className="mono">{rows.length}</b> of <b className="mono">{all.length}</b>{' '}
              {all.length === 1 ? 'claim' : 'claims'}
            </>
          )}
        </span>
        <div className="r">
          {(
            [
              ['all', 'All claims', all.length],
              ['open', 'Still open', open.length],
              ['settled', 'Settled', all.length - open.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={show === key ? 'chipf on' : 'chipf'}
              aria-pressed={show === key}
              // Disabled only when it is not the current filter: a chip that is
              // both active and disabled reads as broken.
              disabled={phase.k === 'ready' && count === 0 && show !== key}
              onClick={() => setShow(key)}
            >
              {label} <span className="mono">{phase.k === 'loading' ? '—' : count}</span>
            </button>
          ))}
        </div>
      </div>

      {phase.k === 'ready' && rows.length === 0 ? (
        <EmptyState
          title={show === 'all' ? 'No claims raised' : 'Nothing under this filter'}
          body={
            show === 'all'
              ? 'Nobody at your organisation has raised a warranty claim. When a machine under cover develops a fault, start one from the warranty board.'
              : 'Every claim you have raised is under one of the other filters.'
          }
        />
      ) : (
        <DataBoard
          rows={rows}
          columns={columns}
          rowKey={(c) => c.claimNumber}
          loading={phase.k === 'loading'}
          caption={`${rows.length} of ${all.length} warranty claims`}
        />
      )}
    </>
  );
}
