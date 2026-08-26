import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SerialBatch } from '@trugrade/contracts';
import { StepSerials } from './StepSerials';
import { StepCondition } from './StepCondition';
import { EMPTY_DRAFT } from './draft';

/**
 * The two behaviours in this wizard that are decisions rather than markup.
 *
 * Step 3's rule is that a brand-shape mismatch **warns and never blocks** — worn
 * labels are real machines, and a wizard that refuses them is a wizard the
 * warehouse works around. Step 2's rule is that the grade-correction consequence
 * is on the screen before the vendor grades, not in an appeals process after.
 */

function mockFetch(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('step 3 — serials', () => {
  it('accepts a serial the brand pattern does not recognise, and says why it is only a warning', async () => {
    const batch: SerialBatch = {
      accepted: ['7XKQ1P3', 'WORNLABEL9'],
      errors: [],
      warnings: [
        {
          line: 2,
          serial: 'WORNLABEL9',
          message: 'Does not look like a Dell service tag (7 letters and digits).',
        },
      ],
    };
    mockFetch(batch);

    render(
      <MemoryRouter>
        <StepSerials serialText={'7XKQ1P3\nWORNLABEL9'} brandName="Dell" onChange={() => {}} />
      </MemoryRouter>,
    );

    // Both serials are ready. The warned one is NOT held back — that is the rule.
    expect(await screen.findByText('2 serials ready to add', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/none of them stops you/)).toBeInTheDocument();
    expect(
      screen.getByText(/An unrecognised shape usually means a worn or reprinted label/),
    ).toBeInTheDocument();
  });

  it('holds back the serials that are genuinely wrong and names the line', async () => {
    const batch: SerialBatch = {
      accepted: ['7XKQ1P3'],
      errors: [{ line: 2, serial: '7XKQ1P3', message: 'Already listed by another vendor.' }],
      warnings: [],
    };
    mockFetch(batch);

    render(
      <MemoryRouter>
        <StepSerials serialText={'7XKQ1P3\n7XKQ1P3'} brandName="Dell" onChange={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Line 2', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Already listed by another vendor/)).toBeInTheDocument();
  });

  it('accepts nothing when the check could not run, rather than accepting on local rules alone', async () => {
    // Uniqueness and the blacklist are the two checks a browser cannot make.
    // Proceeding without them would put a stolen serial into a listing.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const onChange = vi.fn();

    render(
      <MemoryRouter>
        <StepSerials serialText="7XKQ1P3" onChange={onChange} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      /Nothing has been added/,
    );
    expect(onChange).toHaveBeenLastCalledWith('7XKQ1P3', []);
  });
});

describe('step 2 — declaration', () => {
  it('says we will check this, and what a correction costs, before any field', async () => {
    mockFetch([{ grade: 'A', customerDescription: 'Light marks, nothing through the paint.' }]);

    render(
      <MemoryRouter>
        <StepCondition draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText('We will check this.')).toBeInTheDocument();
    expect(screen.getByText(/grade correction/)).toBeInTheDocument();
    expect(screen.getByText(/lower your\s+grade-accuracy score/)).toBeInTheDocument();

    // Both warranty sentences PHASE_03 Task 3 step 2 requires, in plain words.
    expect(screen.getByText(/longer total term than you offer/)).toBeInTheDocument();
    expect(screen.getByText(/earns you a better price/)).toBeInTheDocument();

    // The platform's own definition, next to the grade it defines — so the
    // vendor grades against the words QC will grade against.
    expect(
      await screen.findByText('Light marks, nothing through the paint.'),
    ).toBeInTheDocument();
  });
});
