/**
 * The Delivery card offers the billing address as the delivery address.
 *
 * One tick copies the address the Tax card verified into the site and holds
 * those fields read-only; unticked, they are typed like any other. The tick
 * appears only once there is a billing address to copy, and on reopen it
 * reports what was saved rather than being pre-ticked over an empty form.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../register/api', () => ({
  ...jest.requireActual('../../register/api'),
  saveStep: jest.fn(),
  completeStep: jest.fn(),
  lookupPincode: jest.fn(),
}));
import { completeStep, saveStep } from '../../register/api';
import { DeliveryBody } from './sections/DeliveryBody';

const mockSave = saveStep as jest.MockedFunction<typeof saveStep>;
const mockComplete = completeStep as jest.MockedFunction<typeof completeStep>;

const ACCOUNT = { fullName: 'Priya Nair', email: 'priya@acme.example', mobile: '+919876543210' };
const BILLING = {
  gstin: '06AAHCT0310N1ZG',
  line1: 'Fourth Floor, 429, JMD Megapolis',
  line2: 'Sector 48',
  city: 'GURGAON',
  state: '06',
  pincode: '122018',
};
const noop = (): void => undefined;
const shared = { registerSubmit: noop, onBusy: noop, onFrame: noop, onSaved: noop };
const tick = () => screen.getByRole('checkbox', { name: 'Deliver to the billing address' });

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue({ ok: true, data: null } as never);
  mockComplete.mockResolvedValue({ ok: true, data: null } as never);
});

describe('the tick', () => {
  it('is not offered until the Tax card has saved a billing address', () => {
    render(<DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />);
    expect(screen.queryByTestId('same-as-billing')).toBeNull();
  });

  it('shows the billing address under it and starts unticked over an empty site', () => {
    render(
      <DeliveryBody
        {...shared}
        initial={{ billing: [BILLING] }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    expect(tick()).not.toBeChecked();
    expect(screen.getByTestId('same-as-billing')).toHaveTextContent(
      'Fourth Floor, 429, JMD Megapolis, Sector 48, GURGAON, 122018, Haryana',
    );
    expect(screen.getByLabelText(/Building and street/)).toHaveValue('');
    expect(screen.getByLabelText(/Building and street/)).not.toHaveAttribute('readonly');
  });

  it('copies the billing address in and holds those fields read-only', () => {
    render(
      <DeliveryBody
        {...shared}
        initial={{ billing: [BILLING] }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    fireEvent.click(tick());
    expect(tick()).toBeChecked();
    const street = screen.getByLabelText(/Building and street/);
    expect(street).toHaveValue(BILLING.line1);
    expect(street).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Floor, unit or area/)).toHaveValue(BILLING.line2);
    expect(screen.getByLabelText(/Floor, unit or area/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/PIN code/)).toHaveValue(BILLING.pincode);
    expect(screen.getByLabelText(/PIN code/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/^City/)).toHaveValue(BILLING.city);
    expect(screen.getByLabelText(/State/)).toHaveValue(BILLING.state);
    expect(screen.getByLabelText(/State/)).toBeDisabled();
    // The site's name, gate instructions and window are still this card's to ask.
    expect(screen.getByLabelText(/Name this site/)).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Gate instructions/)).not.toHaveAttribute('readonly');
  });

  it('releases the fields when unticked, with the copy left in them to edit', () => {
    render(
      <DeliveryBody
        {...shared}
        initial={{ billing: [BILLING] }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    fireEvent.click(tick());
    fireEvent.click(tick());
    expect(tick()).not.toBeChecked();
    const street = screen.getByLabelText(/Building and street/);
    expect(street).not.toHaveAttribute('readonly');
    expect(street).toHaveValue(BILLING.line1);
    fireEvent.change(street, { target: { value: 'Loading bay, rear of 429' } });
    expect(street).toHaveValue('Loading bay, rear of 429');
    expect(screen.getByLabelText(/State/)).not.toBeDisabled();
  });

  it('drops a street message the moment the copy fills the box', async () => {
    let submit: () => void = noop;
    render(
      <DeliveryBody
        {...shared}
        registerSubmit={(s) => {
          submit = s;
        }}
        initial={{ billing: [BILLING] }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    await act(async () => {
      submit();
    });
    expect(screen.getByLabelText(/Building and street/)).toHaveAccessibleDescription(
      /building|street|line/i,
    );
    fireEvent.click(tick());
    expect(screen.getByLabelText(/Building and street/)).not.toHaveAccessibleDescription(
      /building|street|line/i,
    );
  });

  it('saves the billing address as the site, with billing carried through untouched', async () => {
    let submit: () => void = noop;
    const onSaved = jest.fn();
    render(
      <DeliveryBody
        {...shared}
        onSaved={onSaved}
        registerSubmit={(s) => {
          submit = s;
        }}
        initial={{ billing: [BILLING] }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Name this site/), { target: { value: 'Head office' } });
    fireEvent.click(tick());
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [code, answers] = mockSave.mock.calls[0]!;
    expect(code).toBe('CONTACTS_ADDRESSES');
    expect(answers.billing).toEqual([BILLING]);
    expect(answers.delivery).toEqual([
      expect.objectContaining({
        label: 'Head office',
        line1: BILLING.line1,
        line2: BILLING.line2,
        city: BILLING.city,
        state: BILLING.state,
        pincode: BILLING.pincode,
      }),
    ]);
  });

  it('reopens ticked only when the saved site is the billing address', () => {
    const { unmount } = render(
      <DeliveryBody
        {...shared}
        initial={{
          billing: [BILLING],
          delivery: [{ label: 'Head office', ...BILLING }],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    expect(tick()).toBeChecked();
    expect(screen.getByLabelText(/Building and street/)).toHaveAttribute('readonly');
    unmount();

    render(
      <DeliveryBody
        {...shared}
        initial={{
          billing: [BILLING],
          delivery: [{ ...BILLING, label: 'Warehouse', line1: 'Plot 12, Udyog Vihar' }],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    expect(tick()).not.toBeChecked();
    expect(screen.getByLabelText(/Building and street/)).toHaveValue('Plot 12, Udyog Vihar');
  });
});
