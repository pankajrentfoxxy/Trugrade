import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DataBoard, EmptyState, Pagination, type Column } from '@trugrade/ui';
import type { Permission } from '@trugrade/contracts';
import { usePrincipal } from '../lib/auth';
import { Board, Select } from '../lib/controls';
import { useBoard } from './useBoard';
import type { BoardConfig } from './types';

/**
 * Every list screen in this console.
 *
 * One component, thirteen configurations. The parts a board has, in the order
 * they appear down the page: saved views, a filter bar, a bulk bar, the table
 * (or the pipeline), and the pager. A board that wants none of the optional
 * parts omits the field and renders nothing for it.
 *
 * **The default view is never All.** It is the first view the server returns,
 * and the server orders them so the first one is the work: Failed for
 * shipments, Today for pickups, Open for NDR, Packed for purchase orders. A
 * board that opens on everything has handed the filtering back to the operator,
 * which is the exact thing that stops working at a thousand rows.
 */

const nf = new Intl.NumberFormat('en-IN');

export function BoardScreen<Row>({
  config,
  onOpen,
}: {
  config: BoardConfig<Row>;
  /** Opens the record drawer. Absent leaves rows unclickable. */
  onOpen?: (row: Row) => void;
}): React.JSX.Element {
  const principal = usePrincipal();
  const facetKeys = useMemo(() => (config.facets ?? []).map((f) => f.key), [config.facets]);
  const board = useBoard<Row>(config.endpoint, facetKeys);
  const { state, data, error, set, clearFilters, filtered } = board;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<'table' | 'pipeline'>('table');
  const [typed, setTyped] = useState(state.q);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => setTyped(state.q), [state.q]);
  // A page of rows the operator can no longer see is not a selection.
  useEffect(() => setSelected(new Set()), [state.view, state.page, state.q]);

  const held = useCallback(
    (p: Permission) => principal?.permissions.includes(p) ?? false,
    [principal],
  );

  const rows = data?.rows ?? [];
  const view = state.view || data?.views[0]?.key || '';
  const selectedRows = rows.filter((r) => selected.has(config.rowKey(r)));

  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(config.rowKey(r)));

  const columns: Column<Row>[] = useMemo(() => {
    const body = config.columns.map((c) => ({
      key: c.key,
      header: c.header,
      cell: c.cell,
      numeric: c.numeric ?? false,
      sortable: c.sortable ?? false,
    }));
    // Opening a record is a column with a real button in it, not a click
    // handler on the <tr>. DataTable deliberately has no row-activate prop, and
    // a clickable table row is unreachable by keyboard anyway.
    const withOpen = onOpen
      ? [
          ...body,
          {
            key: '__open',
            header: 'Record',
            cell: (row: Row) => (
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="text-body-sm text-acc-ink underline underline-offset-4"
              >
                Open
              </button>
            ),
            numeric: false,
            sortable: false,
          },
        ]
      : body;
    if (!config.bulk?.length) return withOpen;
    return [
      {
        key: '__select',
        header: (
          <input
            type="checkbox"
            checked={allOnPage}
            onChange={() =>
              setSelected(allOnPage ? new Set() : new Set(rows.map((r) => config.rowKey(r))))
            }
            aria-label={allOnPage ? 'Clear this page' : 'Select this page'}
            className="size-4 accent-[var(--acc)]"
          />
        ),
        headerHidden: false,
        cell: (row: Row) => (
          <input
            type="checkbox"
            checked={selected.has(config.rowKey(row))}
            onChange={() => toggle(config.rowKey(row))}
            aria-label={`Select ${config.rowKey(row)}`}
            className="size-4 accent-[var(--acc)]"
          />
        ),
      },
      ...withOpen,
    ];
  }, [config, rows, selected, allOnPage, onOpen]);

  const runBulk = async (key: string): Promise<void> => {
    const action = config.bulk?.find((b) => b.key === key);
    if (!action || !selectedRows.length) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(key);
    setOutcome(null);
    try {
      const result = await action.run(selectedRows);
      setOutcome(
        `${action.label}: ${result.ok} done${result.failed ? `, ${result.failed} refused` : ''}${
          result.detail ? ` · ${result.detail}` : ''
        }`,
      );
      setSelected(new Set());
      board.reload();
    } catch (e) {
      setOutcome((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportHref = `${config.endpoint}/export?${board.query}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-h1 text-ink">{config.title}</h1>
        {data && (
          <span className="mono tnum text-body-sm text-ink-3">
            {nf.format(data.views.find((v) => v.key === view)?.count ?? data.total)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {config.pipeline && (
            <div className="flex rounded border border-rule" role="group" aria-label="Layout">
              {(['table', 'pipeline'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`px-3 py-1.5 text-body-sm capitalize ${
                    mode === m ? 'bg-acc-wash text-acc-ink' : 'text-ink-2'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {config.exportPermission &&
            (held(config.exportPermission) ? (
              <Button size="sm" variant="secondary" onClick={() => window.open(exportHref)}>
                Export
              </Button>
            ) : (
              <LockChip permission={config.exportPermission} />
            ))}
        </div>
      </header>

      {/* 1 · Saved views. Each one is a question somebody actually asks. */}
      {data && data.views.length > 0 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Views">
          {data.views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === view}
              onClick={() => set({ view: v.key })}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-body-sm ${
                v.key === view
                  ? 'bg-acc-wash text-acc-ink'
                  : 'text-ink-2 hover:bg-sheet-2'
              }`}
            >
              {v.label}
              <span className="mono tnum text-caption text-ink-3">{nf.format(v.count)}</span>
            </button>
          ))}
        </div>
      )}

      {/* 2 · Filters. Search matches the row's key as well as its display text. */}
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: typed.trim() });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-caption uppercase tracking-wide text-ink-3">Search</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={config.searchHint}
              className="h-9 w-64 rounded border border-rule bg-sheet px-3 text-body-sm text-ink"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Find
          </Button>
        </form>

        {(config.facets ?? []).map((f) => (
          <Select
            key={f.key}
            label={f.label}
            value={state.facets[f.key] ?? ''}
            onChange={(e) => set({ facets: { [f.key]: e.target.value } })}
            options={[
              { value: '', label: 'Any' },
              ...(data?.facets[f.key] ?? []).map((o) => ({
                value: o.value,
                label: `${o.label} (${nf.format(o.count)})`,
              })),
            ]}
          />
        ))}

        {filtered && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear all
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-caption uppercase tracking-wide text-ink-3">Rows</span>
          <div className="flex rounded border border-rule" role="group" aria-label="Density">
            {(['compact', 'default'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => set({ density: d })}
                aria-pressed={state.density === d}
                className={`px-2 py-1 text-caption ${
                  state.density === d ? 'bg-acc-wash text-acc-ink' : 'text-ink-3'
                }`}
              >
                {d === 'compact' ? 'Tight' : 'Roomy'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3 · Bulk. Only present when something is selected. */}
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-acc-2 bg-acc-wash px-4 py-2">
          <span className="mono tnum text-body-sm text-acc-ink">
            {nf.format(selectedRows.length)} selected
          </span>
          {(config.bulk ?? []).map((action) =>
            held(action.permission) ? (
              <Button
                key={action.key}
                size="sm"
                variant="secondary"
                loading={busy === action.key}
                onClick={() => void runBulk(action.key)}
              >
                {action.label}
              </Button>
            ) : (
              <LockChip key={action.key} permission={action.permission} label={action.label} />
            ),
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {outcome && (
        <p role="status" className="text-body-sm text-ink-2">
          {outcome}
        </p>
      )}

      {error && <EmptyState title="This board did not load" body={error} />}

      {!error && data && rows.length === 0 && (
        <EmptyState
          title={filtered ? 'Nothing matches that filter' : config.empty.head}
          body={filtered ? undefined : config.empty.why}
          action={
            filtered ? (
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Clear the filter
              </Button>
            ) : undefined
          }
        />
      )}

      {!error && (rows.length > 0 || !data) && mode === 'table' && (
        <div data-density={state.density}>
          <Board tableMinWidth={config.tableMinWidth ?? 940}>
            <DataBoard
              caption={`${config.title} — ${view || 'all'}`}
              columns={columns}
              rows={rows}
              rowKey={config.rowKey}
              loading={!data}
              stickyHeader
              {...(state.sort ? { sort: { key: state.sort, direction: state.dir } } : {})}
              onSort={(key) =>
                set({
                  sort: key,
                  dir: state.sort === key && state.dir === 'desc' ? 'asc' : 'desc',
                })
              }
            />
          </Board>
        </div>
      )}

      {!error && rows.length > 0 && mode === 'pipeline' && config.pipeline && (
        <PipelineView config={config} rows={rows} onOpen={onOpen} onStage={(k) => set({ view: k })} />
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="mono tnum text-caption text-ink-3">
            {rows.length === 0
              ? '0 rows'
              : `${nf.format((data.page - 1) * data.per + 1)}–${nf.format(
                  (data.page - 1) * data.per + rows.length,
                )} of ${nf.format(data.total)}`}
            {/* How much the operator narrowed. Without it a filtered board
                looks like an empty platform. */}
            {data.total !== data.grandTotal && ` · ${nf.format(data.grandTotal)} total`}
          </p>
          {data.pages > 1 && (
            <Pagination
              page={data.page}
              pageCount={data.pages}
              onPage={(p) => set({ page: p })}
              label={`${config.title} pages`}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The permission, as a chip.
 *
 * §8.1 allows a permission string in exactly two places, and this is one of
 * them. `logistics.task.assign` beside a lock says what the sentence said in a
 * sixth of the space, and unlike the sentence it is the literal string an
 * administrator needs to grant.
 */
function LockChip({ permission, label }: { permission: Permission; label?: string }): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-rule bg-sheet-2 px-2 py-1 text-caption text-ink-3"
      title={`Needs ${permission}`}
    >
      <LockIcon />
      {label && <span>{label}</span>}
      <code className="mono text-caption">{permission}</code>
    </span>
  );
}

function LockIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * Stages as columns, each with a count, the value standing in it and whose move
 * it is.
 *
 * "How many are stuck at Packed and what are they worth" is a question a table
 * answers badly and a column answers instantly.
 */
function PipelineView<Row>({
  config,
  rows,
  onOpen,
  onStage,
}: {
  config: BoardConfig<Row>;
  rows: readonly Row[];
  onOpen?: (row: Row) => void;
  onStage: (stageKey: string) => void;
}): React.JSX.Element {
  const pipeline = config.pipeline;
  if (!pipeline) return <></>;
  const inr = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {pipeline.stages.map((stage) => {
        const inStage = rows.filter((r) => pipeline.stageOf(r) === stage.key);
        const value = pipeline.value
          ? inStage.reduce((sum, r) => sum + (pipeline.value?.(r) ?? 0), 0)
          : null;
        const shown = inStage.slice(0, 8);
        return (
          <section
            key={stage.key}
            className="flex w-64 shrink-0 flex-col gap-2 rounded border border-rule bg-sheet-2 p-3"
          >
            <header className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-body-sm font-medium text-ink">{stage.label}</h2>
                <span className="mono tnum text-caption text-ink-3">{inStage.length}</span>
              </div>
              <p className="text-caption text-ink-3">{stage.who}</p>
              {value !== null && inStage.length > 0 && (
                <p className="mono tnum text-caption text-ink-2">{inr.format(value)}</p>
              )}
            </header>
            {shown.map((row) => (
              <button
                key={config.rowKey(row)}
                type="button"
                onClick={() => onOpen?.(row)}
                className="rounded border border-rule bg-sheet p-2 text-left text-body-sm hover:border-acc-2"
              >
                {pipeline.card(row)}
              </button>
            ))}
            {inStage.length > shown.length && (
              <button
                type="button"
                onClick={() => onStage(stage.key)}
                className="text-body-sm text-acc-ink underline underline-offset-4"
              >
                {inStage.length - shown.length} more
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
