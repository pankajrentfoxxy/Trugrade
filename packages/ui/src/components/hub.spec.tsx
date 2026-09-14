import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HubKpiRow, KPI_SUB_MAX, InfoPopover, PermissionGrid } from './hub';

describe('HubKpiRow', () => {
  it('caps sub at 40 characters so a paragraph cannot sneak in', () => {
    const long = 'x'.repeat(KPI_SUB_MAX + 12);
    render(<HubKpiRow cells={[{ label: 'Live', value: '34', sub: long }]} />);
    expect(screen.getByText('x'.repeat(KPI_SUB_MAX))).toBeTruthy();
    expect(screen.queryByText(long)).toBeNull();
  });

  it('renders the value in mono', () => {
    const { container } = render(
      <HubKpiRow cells={[{ label: 'Live listings', value: '34', sub: 'of 41 submitted' }]} />,
    );
    expect(container.querySelector('.font-mono')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
  });

  it('says a missing figure is not measured, and never prints "undefined"', () => {
    const { container } = render(
      <HubKpiRow
        cells={[
          { label: 'Live listings', value: null },
          { label: 'Units on sale', value: '1' },
        ]}
      />,
    );
    expect(screen.getByText('Not measured')).toBeTruthy();
    expect(container.textContent).not.toContain('undefined');
    // Dimmed and sans, so it cannot be skimmed as a real measurement.
    expect(container.querySelector('.hub-strip__value--none')).toBeTruthy();
  });
});

describe('InfoPopover', () => {
  it('opens on click and closes on Escape, returning focus', async () => {
    const user = userEvent.setup();
    render(
      <InfoPopover label="About live listings">
        Live means inspected, sealed and orderable.
      </InfoPopover>,
    );
    const button = screen.getByRole('button', { name: 'About live listings' });
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'About live listings' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('PermissionGrid', () => {
  const rows = [{ capability: 'Create listings', marks: ['full', 'limited', 'none'] }] as const;
  const columns = ['Owner', 'Operations', 'Finance'];

  it('washes the column named by highlightRole', () => {
    render(<PermissionGrid rows={rows} columns={columns} highlightRole="Operations" />);
    expect(screen.getByRole('columnheader', { name: 'Operations' }).className).toContain('bg-acc-wash');
    expect(screen.getByRole('columnheader', { name: 'Owner' }).className).not.toContain('bg-acc-wash');
  });

  it('washes nothing when highlightRole names no column', () => {
    const { container } = render(
      <PermissionGrid rows={rows} columns={columns} highlightRole="Auditor" />,
    );
    expect(container.querySelectorAll('.bg-acc-wash')).toHaveLength(0);
  });
});
