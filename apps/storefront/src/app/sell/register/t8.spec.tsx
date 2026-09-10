/**
 * The two things about steps 4 and 5 that would be silently wrong.
 *
 * None of these asserts that a guard exists. The first counts every checkbox
 * and radio the two steps actually render and fails if any one of them arrives
 * ticked, except the Sunday-closed and copy-hours defaults on step 5. The
 * second saves a dispatch address that differs from the facility address,
 * throws the component away, and rebuilds it from the draft the save actually
 * produced.
 */
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import { emptyPostal } from '../../register/AddressFields';
import { StepCapability } from './StepCapability';
import { StepFacility } from './StepFacility';

jest.mock('../../register/api', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../register/api'),
  lookupPincode: jest.fn(async (pincode: string) => ({
    ok: true as const,
    data: {
      pincode,
      stateCode: pincode.startsWith('12') ? '06' : '07',
      stateName: pincode.startsWith('12') ? 'Haryana' : 'Delhi',
      areas: [{ value: 'Gurugram', label: 'Gurugram' }],
    },
  })),
}));

const GRADES = [
  { grade: 'A_PLUS', customerDescription: 'As new.' },
  { grade: 'A', customerDescription: 'Light wear.' },
  { grade: 'B', customerDescription: 'Visible wear, fully working.' },
];

const noop = (): void => {};
/** Typed with the arguments the step passes, so `mock.calls[0]` has a shape. */
const accept = async (_values: Record<string, unknown>, _completionPct: number): Promise<null> =>
  null;

function renderCapability(overrides: Partial<React.ComponentProps<typeof StepCapability>> = {}) {
  return render(
    <StepCapability
      answers={{}}
      brands={['Dell', 'HP', 'Lenovo']}
      grades={GRADES}
      onSaveDraft={noop}
      onContinue={accept}
      busy={false}
      onFieldFocus={noop}
      {...overrides}
    />,
  );
}

function renderFacility(overrides: Partial<React.ComponentProps<typeof StepFacility>> = {}) {
  return render(
    <StepFacility
      answers={{}}
      registeredOffice={emptyPostal()}
      accountHolder={{ fullName: '', email: '', mobile: '' }}
      onSaveDraft={noop}
      onContinue={accept}
      busy={false}
      onFieldFocus={noop}
      {...overrides}
    />,
  );
}

/* ============================================== r.4(9): nothing is pre-ticked */

describe('nothing arrives ticked', () => {
  it('step 4 renders no checkbox, radio, chip, or SelectTile in a chosen state', () => {
    const { container, unmount } = renderCapability();

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    // Categories and sourcing channels — all native checkboxes.
    expect(checkboxes.length).toBeGreaterThan(2);
    for (const box of checkboxes) {
      expect(box).not.toBeChecked();
      expect(box).not.toHaveAttribute('checked');
    }

    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const radio of radios) expect(radio).not.toBeChecked();

    // Brand chips are `aria-pressed` toggles; none should start selected.
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);

    unmount();
  });

  it('step 5 renders no checkbox and no radio in a chosen state', () => {
    const { container, unmount } = renderFacility();

    const allowedDefaults = new Set([
      ...screen.getAllByRole('checkbox', { name: 'Closed' }).filter((box) => box.checked),
      screen.getByRole('checkbox', { name: /Copy to every open day/ }),
    ]);
    expect(allowedDefaults.size).toBe(2);

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes.length).toBeGreaterThan(3);
    for (const box of checkboxes) {
      if (allowedDefaults.has(box)) continue;
      expect(box).not.toBeChecked();
      expect(box).not.toHaveAttribute('checked');
    }

    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) expect(radio).not.toBeChecked();

    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);

    unmount();
  });
});

/* ===================== a dispatch address that differs survives save-and-resume */

describe('the dispatch address', () => {
  it('survives a save and a cold resume when it differs from the facility address', () => {
    const saved: Record<string, unknown>[] = [];
    const first = renderFacility({ onSaveDraft: (values) => void saved.push(values) });

    const facility = screen.getByTestId('facility');
    fireEvent.change(within(facility).getByLabelText(/Name this site/), {
      target: { value: 'Sector 37 warehouse' },
    });
    fireEvent.change(within(facility).getByLabelText(/^Building and street/), {
      target: { value: 'Unit 214, Vipul Agora' },
    });
    fireEvent.change(within(facility).getAllByLabelText(/^City/)[0]!, {
      target: { value: 'Gurugram' },
    });
    fireEvent.change(within(facility).getAllByLabelText(/^PIN code/)[0]!, {
      target: { value: '122002' },
    });
    fireEvent.change(within(facility).getAllByLabelText(/^State/)[0]!, { target: { value: '06' } });

    // The whole point: goods leave from somewhere other than the address above.
    const dispatch = screen.getByTestId('dispatch');
    fireEvent.click(within(dispatch).getByLabelText(/goods leave from somewhere else/i));

    fireEvent.change(within(dispatch).getByLabelText(/Dispatch building and street/), {
      target: { value: 'Plot 61, Sector 37 Industrial Estate' },
    });
    fireEvent.change(within(dispatch).getByLabelText(/^City/), { target: { value: 'Gurugram' } });
    fireEvent.change(within(dispatch).getByLabelText(/^PIN code/), { target: { value: '122004' } });
    fireEvent.change(within(dispatch).getByLabelText(/^State/), { target: { value: '06' } });
    fireEvent.blur(within(dispatch).getByLabelText(/^PIN code/));

    // The document line is printed back from the address that will be used.
    expect(
      within(dispatch).getByText(/Plot 61, Sector 37 Industrial Estate, Gurugram, 122004, Haryana/),
    ).toBeInTheDocument();

    const draft = saved[saved.length - 1]!;
    first.unmount();

    // Cold resume: a brand-new component, fed only what the save produced.
    renderFacility({ answers: draft });

    const resumedDispatch = screen.getByTestId('dispatch');
    expect(
      within(resumedDispatch).getByLabelText(/goods leave from somewhere else/i),
    ).toBeChecked();
    expect(within(resumedDispatch).getByLabelText(/Dispatch building and street/)).toHaveValue(
      'Plot 61, Sector 37 Industrial Estate',
    );
    expect(within(resumedDispatch).getByLabelText(/^PIN code/)).toHaveValue('122004');
    // And it did not quietly collapse back onto the facility address.
    expect(
      within(screen.getByTestId('facility')).getByLabelText(/^Building and street/),
    ).toHaveValue('Unit 214, Vipul Agora');
  });

  it('refuses the step while the question is unanswered, rather than defaulting to "same"', () => {
    const onContinue = jest.fn(accept);
    renderFacility({ onContinue });

    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/printed as “Dispatch From” on the e-way bill/)).toBeInTheDocument();
    expect(screen.getByText('Not answered — no address will be printed.')).toBeInTheDocument();
  });
});
