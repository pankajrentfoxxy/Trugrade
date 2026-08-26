/**
 * Modal and Toast.
 *
 * `Modal` is a real `<dialog>`, so most of §1.9.3 is the platform's behaviour
 * rather than ours and there is nothing here to assert about it. What is ours,
 * and what is tested: focus landing on the heading rather than on a control that
 * might be destructive, `Esc` reaching `onClose`, and an error toast that never
 * disappears on a timer.
 */

import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Modal, ToastProvider, useToast } from './overlays';
import { Button } from './primitives';

describe('Modal', () => {
  it('puts focus on the heading, not on the first button', () => {
    render(
      <Modal open onClose={() => {}} title="Approve 14 listings">
        <Button variant="danger">Approve</Button>
      </Modal>,
    );
    // A keystroke already in flight when the dialog opens must not land on a
    // destructive action.
    expect(screen.getByRole('heading', { name: 'Approve 14 listings' })).toHaveFocus();
  });

  it('names itself from its heading and its description', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="Approve 14 listings"
        description="Approved listings go live immediately and are visible to buyers."
      >
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Approve 14 listings' });
    expect(dialog).toHaveAccessibleDescription(
      'Approved listings go live immediately and are visible to buyers.',
    );
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="Approve 14 listings">
        <p>Body</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers a close control that names what it closes', async () => {
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="Approve 14 listings">
        <p>Body</p>
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close: Approve 14 listings' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('gives two open modals distinct label ids', () => {
    render(
      <>
        <Modal open onClose={() => {}} title="First">
          <p>a</p>
        </Modal>
        <Modal open onClose={() => {}} title="Second">
          <p>b</p>
        </Modal>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Modal
        open
        onClose={() => {}}
        title="Approve 14 listings"
        description="Approved listings go live immediately."
        footer={<Button variant="primary">Approve</Button>}
      >
        <p>Body</p>
      </Modal>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

function ToastHarness(): React.JSX.Element {
  const toast = useToast();
  return (
    <>
      <Button onClick={() => toast({ tone: 'success', title: 'Listing published' })}>
        Publish
      </Button>
      <Button
        onClick={() => toast({ tone: 'error', title: 'Payout run failed', durationMs: 10 })}
      >
        Payout
      </Button>
    </>
  );
}

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
  afterEach(() => jest.useRealTimers());

  it('announces a success politely and an error assertively', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('status')).toHaveTextContent('Listing published');

    await userEvent.click(screen.getByRole('button', { name: 'Payout' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Payout run failed');
  });

  it('never auto-dismisses an error, whatever duration the caller asked for', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Payout' }));
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    // A message that disappears on a timer is one a slow reader never read.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('dismisses a success on its own', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    act(() => {
      jest.advanceTimersByTime(6_000);
    });
    expect(screen.queryByText('Listing published')).not.toBeInTheDocument();
  });

  it('keeps at most `max` on screen rather than covering the page it reports on', async () => {
    render(
      <ToastProvider max={2}>
        <ToastHarness />
      </ToastProvider>,
    );
    const publish = screen.getByRole('button', { name: 'Publish' });
    await userEvent.click(publish);
    await userEvent.click(publish);
    await userEvent.click(publish);
    expect(screen.getAllByText('Listing published')).toHaveLength(2);
  });

  it('names its dismiss control after the message it dismisses', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Listing published' }));
    expect(screen.queryByText('Listing published')).not.toBeInTheDocument();
  });

  it('refuses to work without a provider rather than silently swallowing a message', () => {
    // A confirmation that goes nowhere is worse than a crash in development.
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ToastHarness />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
