import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterStrip, REGISTER_SUB_MAX, InfoPopover } from './manifest';

describe('RegisterStrip', () => {
  it('caps sub at 40 characters so a paragraph cannot sneak in', () => {
    const long = 'x'.repeat(REGISTER_SUB_MAX + 12);
    render(<RegisterStrip cells={[{ label: 'Live', value: '34', sub: long }]} />);
    expect(screen.getByText('x'.repeat(REGISTER_SUB_MAX))).toBeTruthy();
    expect(screen.queryByText(long)).toBeNull();
  });

  it('renders the value in mono', () => {
    const { container } = render(
      <RegisterStrip cells={[{ label: 'Live listings', value: '34', sub: 'of 41 submitted' }]} />,
    );
    expect(container.querySelector('.font-mono')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
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
