import * as React from 'react';
import { DataBoard, EmptyState, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import { Board, DateField, NotMeasured, PageHeader, Section, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { Num } from './types';

/**
 * ARCHETYPE B — Board. The audit log, read-only in the strongest sense.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * ## There is no action on this screen, at all
 *
 * Not an edit, not a delete, not a redact, not a bulk anything. `identity.
 * audit_log` is evidence: it is append-only in the database, enforced by
 * `trg_append_only` on UPDATE and DELETE — **a trigger and not a REVOKE**,
 * because a REVOKE cannot bind the table owner and the owner is who the
 * application connects as. The API exposes no write route and this file renders
 * no control that could call one. §3C.7 puts it plainly: no delete action exists
 * in the UI at all.
 *
 * ## An empty table means four different things
 *
 * Nothing happened · your filter excluded everything · the range you asked for
 * predates the earliest partition · the log itself is empty. Only the first is
 * reassuring, and a bare "no rows" gives all four the same face. So every state
 * on this board carries three numbers — the whole log, what the filter matched,
 * and what fits on the page — and the partition bounds that decide whether the
 * range was searchable at all. A filter here never drops a row silently.
 *
 * ## Colour
 *
 * An audit row is not a verdict. A failed login is a recorded fact and not a
 * FAIL; a rejection is somebody's decision, correctly taken, and not a red
 * light. Nothing on this board is green or red. The one amber is the row count,
 * which is a measured value.
 */

interface AuditActor {
  userId: string;
  fullName: string | null;
  email: string | null;
}

interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: AuditActor | null;
  actorOrgId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

interface AuditLog {
  asAt: string;
  rows: AuditRow[];
  counts: {
    total: number;
    matching: number;
    returned: number;
    beyondThisPage: number;
    excludedByFilter: number;
  };
  facets: {
    actions: Array<{ value: string; count: number }>;
    entityTypes: Array<{ value: string; count: number }>;
  };
  coverage: {
    partitionedFrom: string | null;
    partitionedTo: string | null;
    partitions: number;
    hasDefaultPartition: boolean;
    oldestRow: string | null;
    newestRow: string | null;
    rangeIsCovered: boolean;
  };
}

/** `2026-08-30 14:12:07` — a timestamp is a number, so mono and tabular. */
const stamp = (iso: string): string => iso.replace('T', ' ').slice(0, 19);

function When({ row }: { row: AuditRow }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-body-sm tnum text-ink">{stamp(row.occurredAt)}</span>
      <span className="font-mono text-body-sm tnum text-ink-4">#{row.id}</span>
    </div>
  );
}

function Actor({ row }: { row: AuditRow }): React.JSX.Element {
  if (row.actor === null) {
    // Not "System". Nobody was signed in — a scheduled job, or a login attempt
    // that failed before it had an identity — and inventing an actor named
    // "System" would put a name on a row that has none.
    return (
      <NotMeasured
        why="actor_user_id is null on this row: the action had no signed-in user. A job, or an attempt that failed before authentication."
        label="No signed-in actor"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">
        {row.actor.fullName ?? 'Account no longer exists'}
      </span>
      <span className="font-mono text-body-sm text-ink-3">
        {row.actor.email ?? row.actor.userId}
      </span>
    </div>
  );
}

function Entity({ row }: { row: AuditRow }): React.JSX.Element {
  if (row.entityType === null) {
    return (
      <NotMeasured
        why="This action names no entity. Sign-in and sign-out are about the session, not about a record."
        label="No entity"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">{row.entityType}</span>
      {row.entityId !== null && (
        <span className="font-mono text-body-sm text-ink-3">{row.entityId}</span>
      )}
    </div>
  );
}

/**
 * The before/after pair, as JSON, with nothing hidden behind a reveal.
 *
 * There is no masking control because there is nothing to unmask: sensitive keys
 * — PAN, account number, tokens, OTPs, password hashes — are redacted by
 * `AuditService` on the way IN, so this table has never held one in full. A
 * "reveal" button here would be a control that cannot do anything, which is
 * worse than no button.
 */
function Change({ row }: { row: AuditRow }): React.JSX.Element {
  const has = row.before !== null || row.after !== null;
  if (!has) {
    return (
      <NotMeasured
        why="This action recorded no before/after snapshot. It is an event, not a mutation of a stored record."
        label="No snapshot"
      />
    );
  }
  return (
    <details className="max-w-md">
      <summary className="cursor-pointer text-body-sm text-ink-2">
        {row.before !== null && row.after !== null
          ? 'Before and after'
          : row.after !== null
            ? 'After only'
            : 'Before only'}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {row.before !== null && (
          <pre className="overflow-x-auto rounded border border-rule bg-sheet-2 p-3 font-mono text-body-sm text-ink-3">
            {JSON.stringify(row.before, null, 2)}
          </pre>
        )}
        {row.after !== null && (
          <pre className="overflow-x-auto rounded border border-rule bg-sheet-2 p-3 font-mono text-body-sm text-ink-2">
            {JSON.stringify(row.after, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

function Origin({ row }: { row: AuditRow }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {row.ip === null ? (
        <NotMeasured why="No IP was recorded against this row." label="No IP" />
      ) : (
        <span className="font-mono text-body-sm tnum text-ink-2">{row.ip}</span>
      )}
      {row.requestId !== null && (
        <span className="font-mono text-body-sm text-ink-4">{row.requestId}</span>
      )}
    </div>
  );
}

const COLUMNS: ReadonlyArray<Column<AuditRow>> = [
  { key: 'when', header: 'When', cell: (r) => <When row={r} /> },
  {
    key: 'action',
    header: 'Action',
    cell: (r) => <span className="font-mono text-body-sm text-ink">{r.action}</span>,
  },
  { key: 'actor', header: 'Who', cell: (r) => <Actor row={r} /> },
  { key: 'entity', header: 'On what', cell: (r) => <Entity row={r} /> },
  { key: 'change', header: 'What changed', cell: (r) => <Change row={r} /> },
  { key: 'origin', header: 'From', cell: (r) => <Origin row={r} /> },
];

const PAGE = 50;

export function AuditLogRoute(): React.JSX.Element {
  const [action, setAction] = useUrlState('action');
  const [entityType, setEntityType] = useUrlState('entityType');
  const [from, setFrom] = useUrlState('from');
  const [to, setTo] = useUrlState('to');
  const [page, setPage] = useUrlState('page', '1');

  const pageNo = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String((pageNo - 1) * PAGE) });
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, error } = useResource<AuditLog>(
    `/api/admin/audit-log?${params.toString()}`,
    'The audit log did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="The audit log did not load"
        body={`${error}. Nothing has been changed — this screen only ever reads.`}
      />
    );
  }
  if (!data) return <Skeleton lines={12} />;

  const { counts, coverage, facets } = data;
  const filtered = action !== '' || entityType !== '' || from !== '' || to !== '';
  const lastPage = Math.max(1, Math.ceil(counts.matching / PAGE));

  return (
    <div className="tg-stack">
      <PageHeader title="Audit log">
        Every recorded action, with who took it and what it changed.{' '}
        <strong>Append-only and enforced by the database</strong> — a trigger refuses UPDATE and
        DELETE on this table, so nothing here can be edited by anyone, including us. There is no
        action on this screen for the same reason.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <Select
          label="Action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage('1');
          }}
          options={[
            { value: '', label: `Every action (${counts.total})` },
            ...facets.actions.map((a) => ({
              value: a.value,
              label: `${a.value} (${a.count})`,
            })),
          ]}
        />
        <Select
          label="Entity"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage('1');
          }}
          options={[
            { value: '', label: 'Every entity' },
            ...facets.entityTypes.map((e2) => ({
              value: e2.value,
              label: `${e2.value} (${e2.count})`,
            })),
          ]}
        />
        <DateField
          id="audit-from"
          label="From"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage('1');
          }}
        />
        <DateField
          id="audit-to"
          label="To"
          hint="Whole days, inclusive."
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage('1');
          }}
        />
      </div>

      {/*
        The three counts, always. An evidence viewer that shows a page of rows
        without saying what it excluded is the one failure mode that matters
        here: the reader concludes the log is complete when they are looking at
        a slice of it.
      */}
      <p className="text-body-sm text-ink-3">
        Showing <span className="font-mono tnum text-ink">{counts.returned}</span> of{' '}
        <span className="font-mono tnum text-acc-ink">{counts.matching}</span> matching rows, out of{' '}
        <span className="font-mono tnum text-ink">{counts.total}</span> in the whole log.
        {counts.excludedByFilter > 0 && (
          <>
            {' '}
            The filters excluded{' '}
            <span className="font-mono tnum text-ink">{counts.excludedByFilter}</span> rows.
          </>
        )}
        {counts.beyondThisPage > 0 && (
          <>
            {' '}
            <span className="font-mono tnum text-ink">{counts.beyondThisPage}</span> more are beyond
            this page.
          </>
        )}
      </p>

      {!coverage.rangeIsCovered && (
        <p className="max-w-prose rounded-lg border border-rule bg-sheet px-4 py-3 text-body-sm text-warn">
          Part of the range you asked for is outside every partition this table has. The log is
          partitioned by month from{' '}
          <Num>{coverage.partitionedFrom?.slice(0, 10) ?? 'unknown'}</Num> to{' '}
          <Num>{coverage.partitionedTo?.slice(0, 10) ?? 'unknown'}</Num> and there is no DEFAULT
          partition, so a query outside those bounds cannot match anything.{' '}
          <strong>A zero here is not evidence that nothing happened.</strong>
        </p>
      )}

      <Board tableMinWidth={1200}>
        <DataBoard
          caption="Audit log entries, newest first."
          columns={COLUMNS}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title={filtered ? 'No entry matches these filters' : 'The audit log is empty'}
              body={
                filtered ? (
                  <>
                    <span className="block">
                      <span className="font-mono tnum text-ink">{counts.total}</span> entries exist;
                      the filters above matched none of them. Nothing has been hidden from you —
                      widen the range or clear the action.
                    </span>
                    {!coverage.rangeIsCovered && (
                      <span className="mt-3 block text-warn">
                        Your date range also falls partly outside the partitions that exist, so this
                        emptiness is not a measurement.
                      </span>
                    )}
                  </>
                ) : (
                  'No action has ever been recorded on this platform. That is a fact about the log, not about the day.'
                )
              }
            />
          }
        />
      </Board>

      {counts.matching > PAGE && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pageNo <= 1}
            onClick={() => setPage(String(pageNo - 1))}
            className="rounded border border-rule px-4 py-2 text-body-sm text-ink-2 disabled:text-ink-4"
          >
            Newer
          </button>
          <span className="text-body-sm text-ink-3">
            Page <Num>{pageNo}</Num> of <Num>{lastPage}</Num>
          </span>
          <button
            type="button"
            disabled={pageNo >= lastPage}
            onClick={() => setPage(String(pageNo + 1))}
            className="rounded border border-rule px-4 py-2 text-body-sm text-ink-2 disabled:text-ink-4"
          >
            Older
          </button>
        </div>
      )}

      <Section
        title="What this log covers, and what it cannot"
        subtitle="Both are properties of the table rather than of the screen, and an evidence viewer that did not state them would be offering a completeness it cannot back."
        aside={
          <StatusPill
            tone="neutral"
            label={coverage.hasDefaultPartition ? 'Has a DEFAULT partition' : 'No DEFAULT partition'}
          />
        }
      >
        <div className="grid gap-x-7 gap-y-3 sm:grid-cols-2">
          <p className="max-w-prose text-body-sm text-ink-2">
            <span className="font-mono tnum text-ink">{coverage.partitions}</span> monthly partitions
            exist, covering{' '}
            <Num>{coverage.partitionedFrom?.slice(0, 10) ?? 'nothing'}</Num> to{' '}
            <Num>{coverage.partitionedTo?.slice(0, 10) ?? 'nothing'}</Num>. There is no DEFAULT
            partition (schema gap #1): an INSERT outside those bounds fails outright, and a SELECT
            outside them returns nothing without saying why. A nightly job keeps three months ahead;{' '}
            <span className="font-mono">/admin/system/partitions</span> is the human backstop and is
            not built.
          </p>
          <p className="max-w-prose text-body-sm text-ink-2">
            The oldest row present is{' '}
            {coverage.oldestRow === null ? (
              <NotMeasured why="The table has no rows." label="none" />
            ) : (
              <Num>{stamp(coverage.oldestRow)}</Num>
            )}{' '}
            and the newest{' '}
            {coverage.newestRow === null ? (
              <NotMeasured why="The table has no rows." label="none" />
            ) : (
              <Num>{stamp(coverage.newestRow)}</Num>
            )}
            . That is a narrower window than the partitions allow, and the difference is history
            this platform does not have rather than history that was removed.
          </p>
          <p className="max-w-prose text-body-sm text-ink-2">
            Sensitive values never reach this table in full — PAN, bank account numbers, tokens,
            OTPs and password hashes are masked by the writer before the row is created. So there is
            no reveal control here and nothing to audit the use of one, which is the opposite
            trade-off from the notification log, where §3C.7 does require a reveal.
          </p>
          <p className="max-w-prose text-body-sm text-ink-2">
            Export is not built. §3C.7 requires that exporting the log is itself audit-logged, and
            an export button that did not write its own row would be the first unlogged read of the
            log — which is precisely the thing this table exists to make impossible.
          </p>
        </div>
      </Section>
    </div>
  );
}
