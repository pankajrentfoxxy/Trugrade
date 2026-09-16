import type { Permission } from '@trugrade/contracts';
import type { ReactNode } from 'react';

/**
 * A board is data, not a component.
 *
 * Thirteen screens in this console are a list of records. Each one was a
 * hand-written table, a hand-written filter bar, a hand-written pager and a
 * hand-written empty state — the same four things, copied, with the "reset the
 * page when a filter changes" rule present in three files and missing from two.
 * Adding a fourteenth list must not mean writing a fourteenth table.
 *
 * So a screen declares this object and renders `<BoardScreen config={...} />`.
 * Everything below — views, facets, selection, sort, pagination, export,
 * pipeline — is behaviour the one component provides, and a board that wants
 * none of it simply omits the field.
 */

export interface BoardColumn<Row> {
  key: string;
  /** 1–3 words. No verb, no article. Tier 1 copy. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Right-aligned and tabular. Every number on this surface is mono. */
  numeric?: boolean;
  /** Sortable columns send `?sort=<key>`; the server decides what that means. */
  sortable?: boolean;
  /** Dropped below 900px. The columns that survive are the ones that identify a row. */
  secondary?: boolean;
}

export interface BoardBulkAction<Row> {
  key: string;
  /** 1–3 words, imperative. "Dispatch", not "Dispatch the selected POs". */
  label: string;
  /**
   * Held, or the action renders as a lock chip carrying this string.
   *
   * A seat that may export but not dispatch sees Export and a lock where
   * Dispatch would be — rather than a button that 403s, or nothing at all,
   * which teaches them the capability does not exist.
   */
  permission: Permission;
  run: (rows: Row[]) => Promise<BulkOutcome>;
  /** Shown before running when the action cannot be undone. ≤ 12 words. */
  confirm?: string;
}

export interface BulkOutcome {
  ok: number;
  failed: number;
  /** One line per group, e.g. "BlueDart 12 · Porter 3". Rendered as-is. */
  detail?: string;
}

export interface BoardPipelineStage {
  key: string;
  label: string;
  /** Whose move it is at this stage. The question a stuck column has to answer. */
  who: string;
}

export interface BoardPipeline<Row> {
  stages: readonly BoardPipelineStage[];
  stageOf: (row: Row) => string;
  /** Summed per column and rendered under the count. */
  value?: (row: Row) => number;
  card: (row: Row) => ReactNode;
}

export interface BoardConfig<Row> {
  /** Used in the URL, the export filename and the audit row. */
  kind: string;
  title: string;
  /** Where the envelope comes from. Board state is appended as a query string. */
  endpoint: string;
  rowKey: (row: Row) => string;
  /** Opens the record drawer. Absent means the rows are not records. */
  onOpen?: (row: Row) => string;
  columns: readonly BoardColumn<Row>[];
  /** Placeholder for the search box. Names what matches, including the key. */
  searchHint: string;
  facets?: readonly { key: string; label: string }[];
  bulk?: readonly BoardBulkAction<Row>[];
  exportPermission?: Permission;
  pipeline?: BoardPipeline<Row>;
  /** Two lines: what is not here, and — only if structural — why. */
  empty: { head: string; why?: string };
  /** The floor below which the table scrolls rather than wraps. */
  tableMinWidth?: number;
}
