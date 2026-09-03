/**
 * The three things about steps 4 and 5 that would be silently wrong.
 *
 * None of these asserts that a guard exists. The first counts every checkbox
 * and radio the two steps actually render and fails if any one of them arrives
 * ticked. The second **attempts the forbidden thing**: it fills in every other
 * answer on step 4, submits, and expects the step to refuse rather than send a
 * `can_dropship` nobody gave. The third saves a dispatch address that differs
 * from the facility address, throws the component away, and rebuilds it from
 * the draft the save actually produced.
 */
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import { StepCapability } from './StepCapability';
import { StepFacility } from './StepFacility';

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
    // In-house test/repair only — sourcing channels use SelectTile with a
    // checkbox-style indicator, not native inputs.
    expect(checkboxes).toHaveLength(2);
    for (const box of checkboxes) {
      expect(box).not.toBeChecked();
      expect(box).not.toHaveAttribute('checked');
    }

    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) expect(radio).not.toBeChecked();

    // Categories, sourcing, and brand chips are all `aria-pressed` toggles.
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);

    unmount();
  });

  it('step 5 renders no checkbox and no radio in a chosen state', () => {
    const { container, unmount } = renderFacility();

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes.length).toBeGreaterThan(3);
    for (const box of checkboxes) {
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

/* ================================== can_dropship cannot be left unanswered */

describe('can_dropship', () => {
  it('refuses the step rather than sending an answer nobody gave', () => {
    const onContinue = jest.fn(accept);
    renderCapability({ onContinue });

    // Everything else on the step, answered properly.
    fireEvent.click(screen.getByRole('button', { name: /Business laptops/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dell' }));
    fireEvent.change(screen.getByLabelText(/Laptops you can supply in a month/), {
      target: { value: '300' },
    });
    fireEvent.change(screen.getByLabelText('Grade A+'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Grade A'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Grade B'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Corporate buy-back/i }));
    fireEvent.click(screen.getByLabelText(/we can send serials with the offer/i));
    fireEvent.change(screen.getByLabelText(/Lead time, in days/), { target: { value: '2' } });

    // …and `can_dropship` deliberately left alone.
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(
      screen.getByText(/A “no” is a real answer and does not stop your application/),
    ).toBeInTheDocument();

    // Answering it — either way — is what lets the step through.
    fireEvent.click(screen.getByLabelText(/we cannot dispatch to a third party/i));
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0]![0]).toMatchObject({ canDropship: false });
  });

  it('does not treat the column default as an answer on a resumed draft', () => {
    // A draft saved before the question was reached holds no `canDropship` key
    // at all. The column defaults to TRUE; the screen must not.
    renderCapability({ answers: { monthlyCapacity: '300' } });
    const group = screen.getByTestId('yesno-can-dropship');
    expect(within(group).getByText('Not answered yet.')).toBeInTheDocument();
    for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
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
