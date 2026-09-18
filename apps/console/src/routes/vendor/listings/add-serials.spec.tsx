import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddSerialsDialog } from './AddSerialsDialog';

/**
 * Serials typed by hand, and the verdict per serial.
 *
 * `POST /listings/:id/units` writes every serial it can and refuses the rest,
 * so the interesting case is the mixed one — and it is the case a single
 * "saved" or "failed" banner cannot describe without lying about half the
 * batch.
 */

let posted: string[][] = [];
let outcome: unknown = null;

function mockApi(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/units')) {
      posted.push((JSON.parse(String(init?.body ?? '{}')) as { serials: string[] }).serials);
      return Promise.resolve({ ok: true, status: 200, json: async () => outcome } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => null } as Response);
  });
}

const MIXED = {
  added: ['CND4233328', 'CND4233330'],
  batch: {
    accepted: ['CND4233328', 'CND4233330'],
    errors: [
      { line: 2, serial: 'CND4233329', message: 'This serial is already live on another listing.' },
    ],
    warnings: [],
  },
};

function draw(
  onAdded = vi.fn(),
  onClose = vi.fn(),
): { onAdded: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  render(<AddSerialsDialog listingId="l1" open onClose={onClose} onAdded={onAdded} />);
  return { onAdded, onClose };
}

const typeSerials = async (
  user: ReturnType<typeof userEvent.setup>,
  lines: string[],
): Promise<void> => {
  await user.clear(screen.getByLabelText(/Serials, one per line/i));
  await user.type(screen.getByLabelText(/Serials, one per line/i), lines.join('{Enter}'));
};

beforeEach(() => {
  posted = [];
  outcome = MIXED;
  mockApi();
});
afterEach(() => vi.restoreAllMocks());

describe('adding serials by hand', () => {
  it('sends one serial per typed line', async () => {
    const user = userEvent.setup();
    draw();
    await typeSerials(user, ['CND4233328', 'CND4233329', 'CND4233330']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(posted).toEqual([['CND4233328', 'CND4233329', 'CND4233330']]);
  });

  it('colours what was written apart from what was refused', async () => {
    const user = userEvent.setup();
    draw();
    await typeSerials(user, ['CND4233328', 'CND4233329', 'CND4233330']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const results = await screen.findByTestId('serial-results');
    const chip = (serial: string): HTMLElement =>
      within(results)
        .getAllByRole('listitem')
        .find((li) => li.textContent?.trim() === serial)!;

    expect(chip('CND4233328')).toHaveAttribute('data-added', 'true');
    expect(chip('CND4233330')).toHaveAttribute('data-added', 'true');
    expect(chip('CND4233329')).toHaveAttribute('data-added', 'false');
    expect(chip('CND4233328').className).toContain('text-pass');
    expect(chip('CND4233329').className).toContain('text-fail');
  });

  it('quotes the server’s reason under the box, for the refused ones only', async () => {
    const user = userEvent.setup();
    draw();
    await typeSerials(user, ['CND4233328', 'CND4233329', 'CND4233330']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const errors = await screen.findByTestId('serial-errors');
    expect(errors).toHaveTextContent('CND4233329');
    expect(errors).toHaveTextContent('This serial is already live on another listing.');
    // The two that landed are not errors and must not be listed as ones.
    expect(errors).not.toHaveTextContent('CND4233328');
  });

  it('counts the outcome honestly, rather than calling a partial write a success', async () => {
    const user = userEvent.setup();
    draw();
    await typeSerials(user, ['CND4233328', 'CND4233329', 'CND4233330']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('status')).toHaveTextContent('2 of 3 serials were added');
  });

  it('leaves only the failures in the box, so a retry cannot re-add what landed', async () => {
    const user = userEvent.setup();
    draw();
    await typeSerials(user, ['CND4233328', 'CND4233329', 'CND4233330']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const box = screen.getByLabelText(/Serials, one per line/i) as HTMLTextAreaElement;
    expect(box.value).toBe('CND4233329');
  });

  it('holds the reload until close, so the verdicts survive to be read', async () => {
    const user = userEvent.setup();
    const { onAdded } = draw();
    await typeSerials(user, ['CND4233328']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // The route blanks its data while refetching and falls back to a skeleton,
    // which would unmount this dialog and take the results with it.
    await screen.findByTestId('serial-results');
    expect(onAdded).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Done|Cancel/ }));
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('does not reload the board when nothing was written', async () => {
    const user = userEvent.setup();
    outcome = {
      added: [],
      batch: {
        accepted: [],
        errors: [{ line: 1, serial: 'NOPE', message: 'Not a serial.' }],
        warnings: [],
      },
    };
    const { onAdded, onClose } = draw();
    await typeSerials(user, ['NOPE']);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByTestId('serial-errors');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('judges the repeated line, not the serial, when one is typed twice', async () => {
    const user = userEvent.setup();
    // Two lines carry the same serial: the first is written, the third refused.
    // `added` names that serial once, so matching refusals by value instead of
    // by line marks both green and counts "3 of 3" over a batch that wrote two.
    outcome = {
      added: ['TG1A', 'TG1B'],
      batch: {
        accepted: ['TG1A', 'TG1B'],
        errors: [
          { line: 3, serial: 'TG1A', message: 'Duplicate of line 1 in this batch.' },
        ],
        warnings: [],
      },
    };
    draw();
    await typeSerials(user, ['TG1A', 'TG1B', 'TG1A']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const chips = within(await screen.findByTestId('serial-results')).getAllByRole('listitem');
    const marks = chips.slice(0, 3).map((li) => li.getAttribute('data-added'));
    expect(marks).toEqual(['true', 'true', 'false']);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3 serials were added');
    expect(screen.getByTestId('serial-errors')).toHaveTextContent('Duplicate of line 1');
  });

  it('says nothing about a serial it cannot account for, rather than implying success', async () => {
    const user = userEvent.setup();
    // The server wrote one and stayed silent about the other — neither added
    // nor refused by name. Silence is not a machine on the listing.
    outcome = { added: ['CND4233328'], batch: { accepted: ['CND4233328'], errors: [], warnings: [] } };
    draw();
    await typeSerials(user, ['CND4233328', 'GHOST9999']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const errors = await screen.findByTestId('serial-errors');
    expect(errors).toHaveTextContent('GHOST9999');
    expect(errors).toHaveTextContent(/did not say why/);
  });
});
