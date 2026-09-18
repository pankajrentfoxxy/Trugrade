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
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  /*
   * Clicking beside the card.
   *
   * A native <dialog> reports a click on its ::backdrop as a click on the
   * dialog element, and so does a click on its own padding — so the component
   * measures the pointer against the dialog's box instead of comparing
   * targets. jsdom has no layout, so the box is supplied here; without it
   * every rect is 0x0 and the component correctly refuses to guess.
   */
  const withBox = (box: { left: number; top: number; right: number; bottom: number }): void => {
    jest
      .spyOn(HTMLDialogElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        ...box,
        width: box.right - box.left,
        height: box.bottom - box.top,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      } as DOMRect);
  };

  afterEach(() => jest.restoreAllMocks());

  describe('clicking outside the card', () => {
    const OUTSIDE = { clientX: 5, clientY: 5 };
    const INSIDE = { clientX: 200, clientY: 200 };

    it('is ignored unless the modal asked for it', async () => {
      const onClose = jest.fn();
      withBox({ left: 100, top: 100, right: 500, bottom: 400 });
      render(
        <Modal open onClose={onClose} title="Invite a colleague">
          <p>Body</p>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(dialog, OUTSIDE);
      fireEvent.click(dialog, OUTSIDE);
      // The default, and the right one for a dialog holding a half-typed form.
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes a modal that opted in', async () => {
      const onClose = jest.fn();
      withBox({ left: 100, top: 100, right: 500, bottom: 400 });
      render(
        <Modal open onClose={onClose} title="Sign in" dismissOnBackdrop>
          <p>Body</p>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(dialog, OUTSIDE);
      fireEvent.click(dialog, OUTSIDE);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('leaves a click on the card itself alone', async () => {
      const onClose = jest.fn();
      withBox({ left: 100, top: 100, right: 500, bottom: 400 });
      render(
        <Modal open onClose={onClose} title="Sign in" dismissOnBackdrop>
          <p>Body</p>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(dialog, INSIDE);
      fireEvent.click(dialog, INSIDE);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close on a drag that began inside and ended outside', async () => {
      // Selecting a label and releasing past the edge is one press and one
      // release. Closing there throws away what was being read.
      const onClose = jest.fn();
      withBox({ left: 100, top: 100, right: 500, bottom: 400 });
      render(
        <Modal open onClose={onClose} title="Sign in" dismissOnBackdrop>
          <p>Body</p>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(dialog, INSIDE);
      fireEvent.click(dialog, OUTSIDE);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores a click with no pointer position, which is a keyboard activation', async () => {
      const onClose = jest.fn();
      withBox({ left: 100, top: 100, right: 500, bottom: 400 });
      render(
        <Modal open onClose={onClose} title="Sign in" dismissOnBackdrop>
          <p>Body</p>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(dialog, { clientX: 0, clientY: 0 });
      fireEvent.click(dialog, { clientX: 0, clientY: 0 });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('keeps its accessible name when the heading is drawn for screen readers only', () => {
    render(
      <Modal open onClose={() => {}} title="Sign in" titleHidden>
        <p>Body</p>
      </Modal>,
    );
    // The name survives; only the visible repetition goes. A dialog with no
    // heading announces itself as "dialog" and nothing else.
    const heading = screen.getByRole('heading', { name: 'Sign in' });
    expect(heading).toHaveClass('sr-only');
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy();
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
