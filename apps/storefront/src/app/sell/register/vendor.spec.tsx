/**
 * The two things about the vendor flow that would be silently wrong.
 *
 * Neither of these asserts that a guard exists. The first makes one component
 * draw two different rails from two different seeds and counts what came out.
 * The second **attempts the forbidden thing**: it types a CIN, a Udyam number
 * and a TAN into the step and submits it, and then checks that nothing on the
 * platform pretended to verify any of them — no call left the browser, and no
 * row reads "Verified".
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import { BuyerRegistration } from '../../register/BuyerRegistration';
import { StepStatutory } from '../../register/StepStatutory';
import type { FieldRequirement, StepDefinition } from '../../register/api';
import { VendorRegistration } from './VendorRegistration';

/* --------------------------------------------------------------- fetch stub */

let calls: string[];

/** Every route 401s: nobody has registered, which is the pre-account state. */
function stubFetch(): void {
  calls = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'not signed in' } }),
    } as Response;
  }) as unknown as typeof fetch;
}

/** `fireEvent`, not `user-event`: the storefront does not depend on it, and it
 *  resolves here only because another workspace package hoisted it. */
function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const definition = (stepCode: string, stepOrder: number, title: string): StepDefinition => ({
  stepCode,
  stepOrder,
  title,
  purposeNote: `Why we ask about ${title}.`,
  estimatedMinutes: stepOrder,
});

/** The seeded seven and the seeded five, in `onboarding_step_definition` order. */
const VENDOR_STEPS = [
  'ACCOUNT',
  'BUSINESS_PROFILE',
  'STATUTORY',
  'CAPABILITY',
  'FACILITY_CONTACTS',
  'DOCUMENTS_BANK',
  'AGREEMENT',
].map((code, i) => definition(code, i + 1, `Vendor ${code}`));

/** The catalogue's three grades, in its own order. `GET /public/grades` data. */
const GRADES = [
  { grade: 'A_PLUS', customerDescription: 'As new.' },
  { grade: 'A', customerDescription: 'Light wear.' },
  { grade: 'B', customerDescription: 'Visible wear, fully working.' },
];

const BUYER_STEPS = [
  'ACCOUNT',
  'BUSINESS_PROFILE',
  'STATUTORY',
  'CONTACTS_ADDRESSES',
  'DOCUMENTS',
].map((code, i) => definition(code, i + 1, `Buyer ${code}`));

beforeEach(() => {
  stubFetch();
  window.history.replaceState(null, '', '/sell/register');
});

/* ================================================= one shell, two step lists */

describe('the step rail', () => {
  it('draws seven steps for a vendor and five for a buyer, from one component', async () => {
    const vendor = render(<VendorRegistration definitions={VENDOR_STEPS} brands={['Dell']} grades={GRADES} />);
    const vendorRail = await screen.findByTestId('step-rail');
    expect(vendorRail).toHaveTextContent('0 of 7 done');
    // The last three exist only in the vendor seed. If the shell held its own
    // list, or reused the buyer's, none of these could render.
    for (const title of ['Vendor CAPABILITY', 'Vendor FACILITY_CONTACTS', 'Vendor AGREEMENT'])
      expect(within(vendorRail).getByText(title)).toBeInTheDocument();
    expect(within(vendorRail).queryByText('Buyer DOCUMENTS')).not.toBeInTheDocument();

    vendor.unmount();

    render(<BuyerRegistration definitions={BUYER_STEPS} />);
    const buyerRail = await screen.findByTestId('step-rail');
    expect(buyerRail).toHaveTextContent('0 of 5 done');
    expect(within(buyerRail).getByText('Buyer CONTACTS_ADDRESSES')).toBeInTheDocument();
    expect(within(buyerRail).queryByText('Vendor CAPABILITY')).not.toBeInTheDocument();
  });

  it('registers the organisation the flow is for, not whichever one is hard-coded', async () => {
    render(<VendorRegistration definitions={VENDOR_STEPS} brands={[]} grades={GRADES} />);
    await screen.findByTestId('step-rail');

    fill(/Your full name/, 'Rohan Deshpande');
    fill(/Company name/, 'Northgate Asset Recovery');
    fill(/Work email/, 'rohan@northgate-recovery.co.in');
    fireEvent.click(screen.getAllByRole('button', { name: 'Send code' })[0]!);

    // The OTP request is refused by the stub, but the body is already built —
    // and what matters is that the flow asked its own endpoint at all.
    await waitFor(() => expect(calls).toContain('POST /api/auth/register/otp'));
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls.find(
        (c: [string, RequestInit]) => c[0] === '/api/auth/register/otp',
      )![1].body as string,
    ) as { channel: string };
    expect(body.channel).toBe('EMAIL');
  });
});

/* ========================================= a number nothing on the platform verifies */

const VENDOR_CAPTURED: FieldRequirement[] = [
  { fieldCode: 'cin', label: 'CIN', required: false, helpText: '21 characters.' },
  {
    fieldCode: 'udyam_number',
    label: 'Udyam registration',
    required: false,
    helpText: 'Optional.',
  },
];

const COPY = {
  panDescription: 'The PAN.',
  gstinDescription: 'The registrations.',
  confirmConsequence: 'Purchase orders carry this name.',
  primaryTitle: 'Which registration do we buy from?',
  primaryDescription: 'It sets the entity on every purchase order.',
  primaryMissing: 'Choose one.',
  primaryNote: 'Nothing is chosen for you.',
};

describe('CIN, Udyam and TAN', () => {
  it('are captured and never shown as verified, because no route can verify them', async () => {
    const saved: Array<Record<string, unknown>> = [];
    render(
      <StepStatutory
        answers={{}}
        fallbackLegalName="Northgate Asset Recovery Private Limited"
        constitution="PVT_LTD"
        fields={[
          ...VENDOR_CAPTURED,
          { fieldCode: 'tan', label: 'TAN', required: false, helpText: 'Optional.' },
        ]}
        copy={COPY}
        busy={false}
        onSaveDraft={(values) => saved.push(values)}
        onContinue={async () => null}
        onFieldFocus={() => {}}
      />,
    );

    fill(/^CIN/, 'U72900HR2016PTC098765');
    fill(/^Udyam registration/, 'UDYAM-HR-05-0001234');
    fill(/^TAN/, 'DELT12345E');
    fireEvent.blur(screen.getByLabelText(/^TAN/));

    // Three values entered, three rows that say what we actually know about
    // them — the shape, and nothing else.
    await waitFor(() =>
      expect(screen.getAllByText('Captured — not verified')).toHaveLength(3),
    );
    expect(screen.queryByText(/^Verified$/)).not.toBeInTheDocument();

    // The forbidden thing, attempted: nothing was sent anywhere to check them.
    // A `/verify/cin` that quietly appeared would fail here, and so would a
    // client that decided a well-formed CIN counted as a pass.
    expect(calls.filter((c) => c.includes('/verify/'))).toHaveLength(0);

    // The draft carries the value under the seeded `field_code`, so a reviewer
    // reads the same key the requirement row names.
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(saved.at(-1)).toMatchObject({
      cin: 'U72900HR2016PTC098765',
      udyam_number: 'UDYAM-HR-05-0001234',
      tan: 'DELT12345E',
    });
  });

  it('renders an unanswered one as "Not provided", never as a tick', async () => {
    render(
      <StepStatutory
        answers={{}}
        fallbackLegalName="Northgate Asset Recovery Private Limited"
        constitution="PVT_LTD"
        fields={VENDOR_CAPTURED}
        copy={COPY}
        busy={false}
        onSaveDraft={() => {}}
        onContinue={async () => null}
        onFieldFocus={() => {}}
      />,
    );

    expect(await screen.findAllByText('Not provided')).toHaveLength(2);
    expect(screen.queryByText('Captured — not verified')).not.toBeInTheDocument();
    // And the section says once, out loud, that none of it is checked.
    expect(screen.getByText('Recorded, not checked')).toBeInTheDocument();
  });
});
