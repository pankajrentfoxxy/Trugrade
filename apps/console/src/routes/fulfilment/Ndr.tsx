import { useState } from 'react';
import { Button, Drawer } from '@trugrade/ui';
import { BoardScreen } from '../../boards/BoardScreen';
import { ChainStrip } from '../../boards/ChainStrip';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { FULFILMENT_API, day, when, type NdrRow } from './api';

/** Archetype B — board. */

const ALL_ACTIONS = ['REATTEMPT', 'DEFER', 'EDIT_ADDRESS', 'EDIT_PHONE', 'RTO'] as const;

const config: BoardConfig<NdrRow> = {
  kind: 'ndr',
  title: 'NDR',
  endpoint: FULFILMENT_API.ndr,
  rowKey: (r) => r.id,
  searchHint: 'Reason text',
  empty: {
    head: 'No failed deliveries',
    why: 'A row appears here when a carrier reports an attempt that did not deliver.',
  },
  columns: [
    { key: 'awb', header: 'AWB', cell: (r) => <Id>{r.awb ?? '—'}</Id> },
    { key: 'carrier', header: 'Carrier', cell: (r) => r.carrier ?? '—' },
    { key: 'attempt', header: 'Attempt', numeric: true, cell: (r) => r.attemptNo },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (r) => <StatusDot tone={toneOf(r.outcome)} label={word(r.outcome)} />,
    },
    { key: 'reason', header: 'Reason', cell: (r) => r.reason ?? <Unmeasured label="Not given" /> },
    { key: 'at', header: 'Attempted', cell: (r) => day(r.attemptedAt) },
    {
      key: 'next',
      header: 'Next',
      cell: (r) => (r.nextAttemptOn ? day(r.nextAttemptOn) : <Unmeasured label="None set" />),
    },
  ],
};

export default function Ndr(): React.JSX.Element {
  const [open, setOpen] = useState<NdrRow | null>(null);
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={<span className="mono">{open?.awb ?? 'Failed delivery'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.outcome)} label={word(open.outcome)} />
              <span>
                Attempt {open.attemptNo} · {when(open.attemptedAt)}
              </span>
            </span>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-5">
            <ChainStrip orderNumber={null} />
            <p className="text-body-sm text-ink-2">{open.reason ?? 'The carrier gave no reason.'}</p>

            {/*
              Only the actions this carrier's adapter accepts are live.

              Porter has no NDR workflow at all — a failed trip is cancelled and
              re-booked — so every action on a Porter row renders disabled with
              the carrier named. Hiding them instead would leave an operator
              unable to tell "this carrier cannot" from "I may not", and offering
              them enabled would be a button whose only outcome is an error.
            */}
            <section className="flex flex-col gap-2">
              <h3 className="text-caption uppercase tracking-wide text-ink-3">Actions</h3>
              <div className="flex flex-wrap gap-2">
                {ALL_ACTIONS.map((action) => {
                  const allowed = open.legalActions.includes(action);
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant="secondary"
                      {...(allowed
                        ? {}
                        : { disabledReason: `${open.carrier ?? 'This carrier'} does not offer it` })}
                    >
                      {allowed
                        ? action.replace(/_/g, ' ').toLowerCase()
                        : `${open.carrier ?? 'Carrier'} cannot`}
                    </Button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </Drawer>
    </>
  );
}
