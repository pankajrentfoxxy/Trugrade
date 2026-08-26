/**
 * DataTable and Pagination.
 *
 * The assertions that matter here are the ones a sighted developer cannot see
 * failing: `aria-sort` on the active column, a caption that says how the rows
 * are ordered, and a paginator whose edge controls stay reachable.
 */

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataBoard, DataTable, Pagination, pageWindow, type Column } from './data';
import { EmptyState } from './primitives';

interface Row {
  id: string;
  model: string;
  units: number;
}

const ROWS: Row[] = [
  { id: 'u1', model: 'Latitude 5320', units: 12 },
  { id: 'u2', model: 'ThinkPad T14', units: 4 },
];

const COLUMNS: Column<Row>[] = [
  { key: 'model', header: 'Model', cell: (r) => r.model, sortable: true },
  { key: 'units', header: 'Units', cell: (r) => r.units, numeric: true, sortable: true },
  { key: 'action', header: 'Open', headerHidden: true, cell: () => <a href="/x">Open</a> },
];

describe('DataTable', () => {
  it('is a real table with real column headers', () => {
    render(
      <DataTable
        caption="2 listings, sorted by model, A to Z."
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
      />,
    );
    const table = screen.getByRole('table', { name: /2 listings/ });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('marks the sorted column with aria-sort and leaves the others at none', () => {
    render(
      <DataTable
        caption="2 listings, sorted by units, most first."
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ key: 'units', direction: 'desc' }}
        onSort={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Units/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /Model/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('announces the caption politely, so a re-sort is not silent', () => {
    render(
      <DataTable
        caption="12 offers, sorted by landed price, lowest first."
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '12 offers, sorted by landed price, lowest first.',
    );
  });

  it('reports the sort key the header names', async () => {
    const onSort = jest.fn();
    render(
      <DataTable
        caption="2 listings."
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        onSort={onSort}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Units/ }));
    expect(onSort).toHaveBeenCalledWith('units');
  });

  it('keeps the header real while it loads, and shows no rows as data', () => {
    render(
      <DataTable
        caption="Loading listings."
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        loading
        skeletonRows={3}
        empty={<EmptyState title="Nothing here" />}
      />,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    // The empty state must not appear while the answer is still unknown — an
    // empty table and an unloaded one are different facts.
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
  });

  it('shows the empty state once the answer is known to be none', () => {
    render(
      <DataTable
        caption="No listings match all 6 filters."
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No inspected stock matches all 6 filters" />}
      />,
    );
    expect(screen.getByText('No inspected stock matches all 6 filters')).toBeInTheDocument();
  });

  it('names an action column for a screen reader even though the header is invisible', () => {
    render(
      <DataTable caption="2 listings." columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Open' })).toBeInTheDocument();
  });

  it('reads its spacing from the density tokens rather than a hard-coded gap', () => {
    const { container } = render(
      <DataTable caption="2 listings." columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    for (const cell of container.querySelectorAll('td, th')) {
      expect(cell.className).toContain('tg-cell');
    }
  });

  it('keeps its density in the loading and empty states too', () => {
    const { container, rerender } = render(
      <DataTable caption="Loading." columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />,
    );
    for (const cell of container.querySelectorAll('td')) {
      expect(cell.className).toContain('tg-cell');
    }
    rerender(
      <DataTable
        caption="No listings."
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState title="Nothing yet" />}
      />,
    );
    // A row that changes height when it starts loading is a layout jump on
    // every fetch, which is why the skeleton and empty cells take the same
    // class rather than their own padding.
    expect(container.querySelector('td')?.className).toContain('tg-cell');
  });

  /**
   * CLAUDE.md: "One DataBoard component, three settings. Writing a second table
   * component means the system has already failed."
   *
   * The source read is the load-bearing half. `DataBoard === DataTable` proves
   * today's alias; only reading the props stops someone adding `density="compact"`
   * next quarter, which is how thirteen tables end up at eleven densities.
   */
  it('is one component under two names, and takes no density prop', () => {
    expect(DataBoard).toBe(DataTable);
    const source = readFileSync(join(__dirname, 'data.tsx'), 'utf8');
    const props = source.slice(
      source.indexOf('export interface DataTableProps'),
      source.indexOf('const SORT_GLYPH'),
    );
    expect(props).not.toMatch(/density|rowHeight|compact|comfortable/i);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <DataTable
        caption="2 listings, sorted by model, A to Z."
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ key: 'model', direction: 'asc' }}
        onSort={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('pageWindow', () => {
  it('lists every page while they fit', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('collapses a run into one gap', () => {
    expect(pageWindow(5, 20)).toEqual([1, 'gap', 4, 5, 6, 'gap', 20]);
  });

  it('never hides a single page behind an ellipsis, which would cost the same width', () => {
    expect(pageWindow(3, 9)).toEqual([1, 2, 3, 4, 'gap', 9]);
  });

  it('handles the ends without duplicating the first or last page', () => {
    expect(pageWindow(1, 9)).toEqual([1, 2, 'gap', 9]);
    expect(pageWindow(9, 9)).toEqual([1, 'gap', 8, 9]);
  });

  it('renders nothing to paginate for zero or one page', () => {
    expect(pageWindow(1, 0)).toEqual([]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('Pagination', () => {
  it('does not render chrome for a single page', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the current page with aria-current, not with colour alone', () => {
    render(<Pagination page={3} pageCount={9} onPage={() => {}} />);
    expect(screen.getByText('3')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Previous in the DOM at the first page rather than moving every other target', () => {
    render(<Pagination page={1} pageCount={9} onPage={() => {}} />);
    const previous = screen.getByText('Previous');
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).toHaveAttribute('tabindex', '0');
  });

  it('renders real links when given an href builder, because a crawler does not click', () => {
    render(<Pagination page={2} pageCount={5} hrefFor={(p) => `/laptops?page=${p}`} />);
    expect(screen.getByRole('link', { name: 'Page 3' })).toHaveAttribute(
      'href',
      '/laptops?page=3',
    );
  });

  it('intercepts a link click for the client router when onPage is given too', async () => {
    const onPage = jest.fn();
    render(
      <Pagination page={2} pageCount={5} onPage={onPage} hrefFor={(p) => `/laptops?page=${p}`} />,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Page 3' }));
    expect(onPage).toHaveBeenCalledWith(3);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Pagination page={5} pageCount={20} onPage={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
