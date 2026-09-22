/**
 * The gate, counted rather than asserted.
 *
 * A buyer used to face 27 required fields before a first order, 20 of them in
 * one all-or-nothing card. These tests walk the inputs the cards actually
 * render and count the ones a buyer has to type into — deliberately not reading
 * `sections.config.ts`, because the config is the thing under test.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ResumableOnboarding } from '@trugrade/contracts';
import type { SessionView } from '../../register/api';

jest.mock('../../register/api', () => ({
  ...jest.requireActual('../../register/api'),
  saveStep: jest.fn(),
  completeStep: jest.fn(),
  verifyGstin: jest.fn(),
  lookupPincode: jest.fn(),
  updateMe: jest.fn(),
  sendContactAddCode: jest.fn(),
  verifyContactAddCode: jest.fn(),
}));

import { completeStep, lookupPincode, saveStep, verifyGstin } from '../../register/api';
import { AccountBody } from './sections/AccountBody';
import { DeliveryBody } from './sections/DeliveryBody';
import { PreferencesBody } from './sections/PreferencesBody';
import { TaxBody } from './sections/TaxBody';
import {
  GATING_SECTIONS,
  PROFILE_SECTIONS,
  profileCompletionPct,
  sectionIsDone,
} from './sections.config';

const mockSave = saveStep as jest.MockedFunction<typeof saveStep>;
const mockComplete = completeStep as jest.MockedFunction<typeof completeStep>;
const mockVerify = verifyGstin as jest.MockedFunction<typeof verifyGstin>;
const mockPincode = lookupPincode as jest.MockedFunction<typeof lookupPincode>;

const GSTIN = '06AAHCT0310N1ZG';

const ACCOUNT = { fullName: 'Priya Nair', email: 'priya@acme.example', mobile: '+919876543210' };

const session = (over: Partial<SessionView> = {}): SessionView => ({
  userId: 'u1',
  orgId: 'o1',
  orgType: 'BUYER',
  roles: ['CUSTOMER_OWNER'],
  permissions: ['identity.user.write'],
  mfaRequired: false,
  mobile: ACCOUNT.mobile,
  ...over,
});

const onboarding = (
  statuses: Record<string, 'COMPLETE' | 'NOT_STARTED'>,
  answers: Record<string, Record<string, unknown>> = {},
): ResumableOnboarding =>
  ({
    orgId: 'o1',
    status: 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: true,
    progress: {
      constitution: null,
      steps: Object.entries(statuses).map(([stepCode, status]) => ({
        stepCode,
        status,
        isRequired: true,
        blockingReason: null,
      })),
      resumeAt: null,
      completedSteps: 0,
      requiredSteps: 5,
      isSubmittable: false,
    },
    answers,
  }) as unknown as ResumableOnboarding;

const NOTHING_DONE = {
  ACCOUNT: 'NOT_STARTED',
  STATUTORY: 'NOT_STARTED',
  BUSINESS_PROFILE: 'NOT_STARTED',
  CONTACTS_ADDRESSES: 'NOT_STARTED',
  DOCUMENTS: 'NOT_STARTED',
} as const;

const ok = { ok: true as const, data: null };

const verifiedGst = (state = '06') => ({
  ok: true as const,
  data: {
    id: 'v1',
    checkType: 'GSTIN',
    outcome: 'PASS' as const,
    message: 'Active',
    matchScore: 1,
    attemptNo: 1,
    attemptsRemaining: 3,
    willRetryAutomatically: false,
    resolved: {
      legalName: 'ACME TECHNOLOGIES PRIVATE LIMITED',
      tradeName: 'Acme',
      constitutionType: 'PVT_LTD',
      registrationDate: '2019-01-16',
      stateCode: state,
      registeredAddress: {
        line1: 'Fourth Floor, 429, JMD Megapolis',
        line2: 'Sector 48',
        city: 'GURGAON',
        state,
        pincode: '122018',
      },
    },
  },
});

const noop = (): void => undefined;
const shared = {
  registerSubmit: noop,
  onBusy: noop,
  onFrame: noop,
  onSaved: noop,
};

/**
 * Inputs a buyer must actually type into.
 *
 * Required, editable and empty. A field pre-filled from the account and marked
 * read-only is not a question, and neither is a value confirmed with a tick.
 */
function fieldsToType(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('input, select, textarea'))
    .filter((el): el is HTMLInputElement => {
      const node = el as HTMLInputElement;
      if (node.type === 'checkbox' || node.type === 'radio' || node.type === 'hidden') return false;
      if (node.readOnly || node.disabled) return false;
      if (!node.required) return false;
      return node.value.trim() === '';
    })
    .map((el) => el.getAttribute('aria-label') ?? el.id ?? el.name ?? 'field');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(ok as never);
  mockComplete.mockResolvedValue(ok as never);
  mockVerify.mockResolvedValue(verifiedGst() as never);
  mockPincode.mockResolvedValue({
    ok: true,
    data: {
      pincode: '122018',
      stateCode: '06',
      areas: [
        { value: 'Gurgaon South City', label: 'Gurgaon South City' },
        { value: 'Gurgaon Sector 45', label: 'Gurgaon Sector 45' },
      ],
    },
  } as never);
});

/* ==========================================================================
 * 1. Six typed fields and two confirmations
 * ======================================================================== */

describe('what a fresh buyer is actually asked for', () => {
  it('asks for six typed fields and two confirmations across the gating cards', async () => {
    const typed: string[] = [];
    let confirmations = 0;

    // Account — the name, and the work email a code is sent to.
    const account = render(<AccountBody {...shared} session={session()} onSession={noop} />);
    typed.push(...fieldsToType(account.container));
    account.unmount();

    // Tax — the GSTIN, and the tick that confirms the name it returned.
    const tax = render(
      <TaxBody
        {...shared}
        initial={{}}
        contacts={{}}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    typed.push(...fieldsToType(tax.container));
    await act(async () => {
      fireEvent.change(tax.container.querySelector('input')!, { target: { value: GSTIN } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    await screen.findByTestId('gstin-verified');
    // The tick, and then the billing address which is confirmed rather than typed.
    confirmations += within(screen.getByTestId('gstin-verified')).getAllByRole('checkbox').length;
    tax.unmount();

    // Delivery — name the site, the street, the pincode. Nothing else.
    const delivery = render(
      <DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />,
    );
    typed.push(...fieldsToType(delivery.container));
    delivery.unmount();

    // The billing confirmation, counted on its own card render.
    const billing = render(
      <TaxBody
        {...shared}
        initial={{ gstins: [{ gstin: GSTIN }] }}
        contacts={{
          billing: [
            {
              gstin: GSTIN,
              line1: 'Fourth Floor, 429',
              city: 'GURGAON',
              state: '06',
              pincode: '122018',
            },
          ],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    confirmations += 1; // "Use a different billing address" — the default is to confirm.
    billing.unmount();

    // Six: name, work email, GSTIN, site name, street, pincode.
    expect(typed).toHaveLength(6);
    expect(confirmations).toBe(2);
  });

  it('never asks a buyer to name a finance or IT contact to place an order', () => {
    const delivery = render(
      <DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />,
    );
    expect(screen.queryByText(/Finance contact/i)).toBeNull();
    expect(screen.queryByText(/IT contact/i)).toBeNull();
    expect(screen.queryByLabelText(/Designation/i)).toBeNull();
    delivery.unmount();
  });
});

/* ==========================================================================
 * 2. Partial work is worth something
 * ======================================================================== */

describe('the score', () => {
  it('scores the Account card on its own, rather than nothing until the end', () => {
    const pct = profileCompletionPct(
      onboarding({ ...NOTHING_DONE, ACCOUNT: 'COMPLETE' }),
      session({ fullName: ACCOUNT.fullName, email: ACCOUNT.email }),
    );
    expect(pct).toBe(30);
  });

  it('reaches 100% with nothing uploaded, because Preferences is weight 0', () => {
    const done = {
      ...NOTHING_DONE,
      ACCOUNT: 'COMPLETE',
      STATUTORY: 'COMPLETE',
      BUSINESS_PROFILE: 'COMPLETE',
      CONTACTS_ADDRESSES: 'COMPLETE',
      DOCUMENTS: 'NOT_STARTED',
    } as const;
    const full = session({ fullName: ACCOUNT.fullName, email: ACCOUNT.email });
    expect(profileCompletionPct(onboarding(done), full)).toBe(100);

    const preferences = PROFILE_SECTIONS.find((s) => s.id === 'preferences')!;
    expect(preferences.weight).toBe(0);
    expect(GATING_SECTIONS).not.toContain(preferences);
    expect(sectionIsDone(preferences, onboarding(done), full)).toBe(false);
  });

  it('weights the gating cards to exactly 100', () => {
    expect(GATING_SECTIONS.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });
});

/* ==========================================================================
 * 3. Stop asking for what we already have
 * ======================================================================== */

describe('what the screen fills in for itself', () => {
  it('fills City and State from the pincode and leaves both read-only', async () => {
    render(<DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/PIN code/i), { target: { value: '122018' } });
    });

    await waitFor(() => {
      expect((screen.getByLabelText(/^City/i) as HTMLInputElement).value).toBe(
        'Gurgaon South City',
      );
    });
    expect(screen.getByLabelText(/^City/i)).toHaveAttribute('readonly');
    // State is a select the directory locked, not a question.
    const state = screen.getByLabelText(/^State/i) as HTMLSelectElement;
    expect(state.value).toBe('06');
    expect(state.disabled).toBe(true);
    // The exception is still reachable for a pincode that spans areas.
    expect(screen.getByRole('button', { name: /Not this area/i })).toBeInTheDocument();
  });

  it('sends the account holder as the signatory without asking or restating it', async () => {
    let submit: () => void = () => undefined;
    render(
      <DeliveryBody
        {...shared}
        registerSubmit={(fn) => {
          submit = fn;
        }}
        initial={{
          delivery: [
            {
              label: 'Head office',
              line1: 'Fourth Floor, 429',
              city: 'GURGAON',
              state: '06',
              pincode: '122018',
            },
          ],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    // Neither asked nor echoed back — the card says nothing about who signs.
    expect(screen.queryByText(/Who signs/i)).toBeNull();
    expect(screen.queryByLabelText(/Their mobile/i)).toBeNull();
    expect(screen.queryByText(ACCOUNT.fullName)).toBeNull();

    // It still reaches the API, because `org_address` needs a contact.
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const [, answers] = mockSave.mock.calls[0]!;
    expect((answers as { delivery: Record<string, unknown>[] }).delivery[0]).toMatchObject({
      contactName: ACCOUNT.fullName,
      contactMobile: '+919876543210',
    });
  });

  it('asks the receiving window as one chip carrying its hours, not three empty fields', () => {
    render(<DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />);
    // Pre-selected, so the window is a fact to change rather than a question.
    expect(screen.getByRole('button', { name: 'Mon–Fri 10–6' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All days' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Opens at/i)).toBeNull();
    expect(screen.queryByLabelText(/Closes at/i)).toBeNull();
    expect(screen.queryByLabelText(/Receiving days/i)).toBeNull();
  });

  it('keeps gate instructions with the address, and stops asking for a landmark', () => {
    render(<DeliveryBody {...shared} initial={{}} accountHolder={ACCOUNT} blockingReason={null} />);
    expect(screen.getByLabelText(/Gate instructions/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Landmark/i)).toBeNull();
  });

  it('writes the hours the chosen chip promises, because the API has no chip', async () => {
    let submit: () => void = () => undefined;
    render(
      <DeliveryBody
        {...shared}
        registerSubmit={(fn) => {
          submit = fn;
        }}
        initial={{
          delivery: [
            {
              label: 'Head office',
              line1: 'Fourth Floor, 429',
              city: 'GURGAON',
              state: '06',
              pincode: '122018',
            },
          ],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mon–Sat 9–8' }));
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const [step, answers] = mockSave.mock.calls[0]!;
    expect(step).toBe('CONTACTS_ADDRESSES');
    const [site] = (answers as { delivery: Record<string, unknown>[] }).delivery;
    expect(site).toMatchObject({ days: 'MON_SAT', opensAt: '09:00', closesAt: '20:00' });
    // The chip itself is this card's state, never one of the saved answers.
    expect(site).not.toHaveProperty('windowId');
  });

  it('locks a GSTIN the portal passed, and unlocks it only on a deliberate change', async () => {
    render(
      <TaxBody
        {...shared}
        initial={{}}
        contacts={{}}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    const field = screen.getByLabelText(/GSTIN/i) as HTMLInputElement;
    expect(field).not.toHaveAttribute('readonly');

    await act(async () => {
      fireEvent.change(field, { target: { value: GSTIN } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    await screen.findByTestId('gstin-verified');

    // Read-only, and there is no longer a Verify button to press again.
    expect(field).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.getByText(/Checked against the GST portal/i)).toBeInTheDocument();

    // Typing at it is refused, rather than quietly staling the portal's answer.
    fireEvent.change(field, { target: { value: '29AAHCT0310N1Z9' } });
    expect(field.value).toBe(GSTIN);

    // Changing it is deliberate: the answer is thrown away and re-asked.
    fireEvent.click(screen.getByRole('button', { name: 'Change the GSTIN' }));
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.queryByTestId('gstin-verified')).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('keeps a reopened card verified, rather than re-asking for a check it has', () => {
    render(
      <TaxBody
        {...shared}
        initial={{
          gstins: [{ gstin: GSTIN, confirmed: true, outcome: verifiedGst().data }],
        }}
        contacts={{}}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    expect(screen.getByLabelText(/GSTIN/i)).toHaveAttribute('readonly');
    const block = screen.getByTestId('gstin-verified');
    expect(within(block).getByRole('checkbox')).toBeChecked();
  });

  it('confirms the billing address the GST portal returned, rather than asking for it again', async () => {
    render(
      <TaxBody
        {...shared}
        initial={{}}
        contacts={{}}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: GSTIN } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    const block = await screen.findByTestId('gstin-verified');

    // The evidence behind the tick: the state it is registered in, and the PAN.
    expect(within(block).getByText('State of registration')).toBeInTheDocument();
    expect(within(block).getByText('Haryana')).toBeInTheDocument();
    expect(within(block).getByText('PAN, from the GSTIN')).toBeInTheDocument();
    expect(within(block).getByText('AAHCT0310N')).toBeInTheDocument();
  });

  it('shows the billing address as a confirmation, with no fields to fill', () => {
    render(
      <TaxBody
        {...shared}
        initial={{ gstins: [{ gstin: GSTIN }] }}
        contacts={{
          billing: [
            {
              gstin: GSTIN,
              line1: 'Fourth Floor, 429',
              line2: '',
              city: 'GURGAON',
              state: '06',
              pincode: '122018',
            },
          ],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );
    // Step 2 is reached from step 1, so drive the card there through its own frame.
    expect(screen.getByLabelText(/GSTIN/i)).toHaveValue(GSTIN);
  });
});

/* ==========================================================================
 * 4. A warning, not a refusal
 * ======================================================================== */

describe('a billing state that disagrees with the GSTIN', () => {
  it('warns and offers an edit rather than refusing the portal’s own answer', async () => {
    let saved = false;
    render(
      <TaxBody
        {...shared}
        onSaved={() => {
          saved = true;
        }}
        registerSubmit={(submit) => {
          submitFromCard = submit;
        }}
        initial={{}}
        contacts={{
          // Registered in Haryana (06), billed in Karnataka (29).
          billing: [
            {
              gstin: GSTIN,
              line1: 'Fourth Floor, 429',
              line2: '',
              city: 'Bengaluru',
              state: '29',
              pincode: '560001',
            },
          ],
        }}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: GSTIN } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    await screen.findByTestId('gstin-verified');
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    // Step 1 → step 2.
    await act(async () => {
      submitFromCard();
    });

    const warning = await screen.findByTestId('billing-state-warning');
    expect(warning).toHaveTextContent(/registered in Haryana/i);
    expect(within(warning).getByRole('button', { name: 'Edit the address' })).toBeInTheDocument();

    // And the save still goes through — a warning is not a refusal.
    await act(async () => {
      submitFromCard();
    });
    await waitFor(() => expect(saved).toBe(true));
  });
});

let submitFromCard: () => void = () => undefined;

/* ==========================================================================
 * 5. The purchase-order default
 * ======================================================================== */

describe('the purchase-order answer', () => {
  it('starts false, and is a question rather than a hidden default', () => {
    render(<PreferencesBody {...shared} initial={{}} blockingReason={null} />);
    const box = screen.getByRole('checkbox', {
      name: /Our orders need a purchase order number/i,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/will not ask for a PO number/i)).toBeInTheDocument();
  });

  it('writes what the buyer answered, not a DEFAULTS block they never saw', async () => {
    let submit: () => void = () => undefined;
    render(
      <PreferencesBody
        {...shared}
        registerSubmit={(fn) => {
          submit = fn;
        }}
        initial={{}}
        blockingReason={null}
      />,
    );
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const [step, answers] = mockSave.mock.calls[0]!;
    expect(step).toBe('DOCUMENTS');
    expect((answers as { poRequired: boolean }).poRequired).toBe(false);
  });
});

/* ==========================================================================
 * 5. A message is about what is in the box
 * ======================================================================== */

describe('a field message on the Delivery card', () => {
  it('goes the moment the field is edited, and only that field’s', async () => {
    let submit: () => void = () => undefined;
    render(
      <DeliveryBody
        {...shared}
        registerSubmit={(fn) => {
          submit = fn;
        }}
        initial={{}}
        accountHolder={ACCOUNT}
        blockingReason={null}
      />,
    );

    // Save with nothing typed: every required box says what it needs.
    await act(async () => {
      submit();
    });
    expect(screen.getByText(/Name this site — "Head office"/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name this site/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Building and street/i)).toHaveAttribute('aria-invalid', 'true');

    // Typing into the site name answers its message. It used to stay red
    // under a box that was no longer empty, until the next save.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Name this site/i), {
        target: { value: 'Head office' },
      });
    });
    expect(screen.queryByText(/Name this site — "Head office"/)).toBeNull();
    expect(screen.getByLabelText(/Name this site/i)).not.toHaveAttribute('aria-invalid');

    // The street was not touched, so its message is still true and still there.
    expect(screen.getByLabelText(/Building and street/i)).toHaveAttribute('aria-invalid', 'true');
    expect(mockSave).not.toHaveBeenCalled();
  });
});
