/**
 * The three things about this flow that would be silently wrong.
 *
 * None of these assert that a guard exists — each one makes the flow do the
 * thing and checks what came out: the rail is asked for titles nobody wrote in
 * this repo, the resumed draft is read back out of the rendered inputs, and the
 * pre-ticked box is looked for in both the DOM and the source.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import { BuyerRegistration } from './BuyerRegistration';
import type { StepDefinition } from './api';

/* --------------------------------------------------------------- fetch stub */

interface Reply {
  status: number;
  body?: unknown;
}

let replies: Map<string, Reply>;

/** `METHOD /path` → reply. An unlisted route is a 404, never a silent success. */
function stubFetch(routes: Record<string, Reply>): void {
  replies = new Map(Object.entries(routes));
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    const reply = replies.get(key) ?? { status: 404, body: { error: { message: 'no stub' } } };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? null,
    } as Response;
  }) as unknown as typeof fetch;
}

const definition = (stepCode: string, stepOrder: number, title: string): StepDefinition => ({
  stepCode,
  stepOrder,
  title,
  purposeNote: `Why we ask about ${title}.`,
  estimatedMinutes: stepOrder,
});

const progressRow = (
  d: StepDefinition,
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...d,
  isRequired: true,
  status,
  completionPct: 0,
  blockingReason: null,
  lastSavedAt: null,
  ...extra,
});

beforeEach(() => {
  window.history.replaceState(null, '', '/register');
});

/* ============================================================== the step rail */

describe('the step rail', () => {
  it('renders the steps the API returned, not a list held in the client', async () => {
    // Titles no human would write into this repo. If they render, they can only
    // have come from the props/response.
    const served = [definition('ACCOUNT', 1, 'Kingfisher'), definition('OTHER', 2, 'Marmalade')];
    stubFetch({ 'GET /api/auth/session': { status: 401, body: { error: {} } } });

    render(<BuyerRegistration definitions={served} />);

    const rail = await screen.findByTestId('step-rail');
    expect(within(rail).getByText('Kingfisher')).toBeInTheDocument();
    expect(within(rail).getByText('Marmalade')).toBeInTheDocument();
    // Two steps in, two steps out — a hard-coded five would show up here.
    expect(rail).toHaveTextContent('0 of 2 done');
    expect(rail).not.toHaveTextContent('Statutory');
  });

  it('re-reads the rail from the org’s own steps once there is a session', async () => {
    const served = [definition('ACCOUNT', 1, 'Kingfisher'), definition('OTHER', 2, 'Marmalade')];
    stubFetch({
      'GET /api/auth/session': {
        status: 200,
        body: { userId: 'u1', orgId: 'o1', orgType: 'BUYER', roles: [], permissions: [] },
      },
      'POST /api/onboarding/start': { status: 204 },
      'GET /api/onboarding/steps': {
        status: 200,
        body: {
          orgId: 'o1',
          status: 'REGISTERED',
          progress: {
            steps: [
              progressRow(definition('ACCOUNT', 1, 'Renamed in the database'), 'COMPLETE'),
              progressRow(definition('BUSINESS_PROFILE', 2, 'Also renamed'), 'IN_PROGRESS'),
            ],
            resumeAt: 'BUSINESS_PROFILE',
            completedSteps: 1,
            requiredSteps: 2,
            isSubmittable: false,
          },
          answers: {},
        },
      },
    });

    render(<BuyerRegistration definitions={served} />);

    // The seeded titles win over the ones this render started with.
    const rail = screen.getByTestId('step-rail');
    await waitFor(() => expect(within(rail).getByText('Also renamed')).toBeInTheDocument());
    expect(within(rail).queryByText('Marmalade')).not.toBeInTheDocument();
  });
});

/* ============================================================ save-and-resume */

describe('a resumed session', () => {
  it('lands on the abandoned step with the draft back in the fields', async () => {
    const account = definition('ACCOUNT', 1, 'Account');
    const company = definition('BUSINESS_PROFILE', 2, 'Company');
    stubFetch({
      'GET /api/auth/session': {
        status: 200,
        body: { userId: 'u1', orgId: 'o1', orgType: 'BUYER', roles: [], permissions: [] },
      },
      'POST /api/onboarding/start': { status: 204 },
      'GET /api/onboarding/steps': {
        status: 200,
        body: {
          orgId: 'o1',
          status: 'REGISTERED',
          progress: {
            steps: [
              progressRow(account, 'COMPLETE'),
              progressRow(company, 'IN_PROGRESS', {
                completionPct: 50,
                lastSavedAt: '2026-08-27T05:52:00.000Z',
              }),
            ],
            resumeAt: 'BUSINESS_PROFILE',
            completedSteps: 1,
            requiredSteps: 2,
            isSubmittable: false,
          },
          answers: {
            BUSINESS_PROFILE: {
              legalName: 'Ferrous Works Private Limited',
              tradeName: 'Ferrous',
              constitution: 'LLP',
              industry: 'MANUFACTURING',
              yearEstablished: '2011',
              website: 'https://ferrous.co.in/',
              employeeBand: '',
              annualVolume: '',
            },
          },
        },
      },
    });

    render(<BuyerRegistration definitions={[account, company]} />);

    const legalName = await screen.findByLabelText(/Legal name/);
    expect(legalName).toHaveValue('Ferrous Works Private Limited');
    expect(screen.getByLabelText(/Year established/)).toHaveValue('2011');
    expect(screen.getByLabelText(/Constitution/)).toHaveValue('LLP');
    expect(screen.getByLabelText(/Website/)).toHaveValue('https://ferrous.co.in/');

    // The rail has to say the draft is safe, and say when.
    await waitFor(() => expect(screen.getByTestId('step-rail')).toHaveTextContent(/Saved /));
  });
});

/* ====================================================== CP e-Comm rule 4(9) */

describe('consent', () => {
  it('renders no ticked checkbox anywhere in the flow', async () => {
    const account = definition('ACCOUNT', 1, 'Account');
    stubFetch({ 'GET /api/auth/session': { status: 401, body: { error: {} } } });

    const { container } = render(<BuyerRegistration definitions={[account]} />);
    await screen.findByText('Create account and continue');

    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
  });

  it('has no `defaultChecked` in the storefront source', () => {
    // The DOM assertion above only covers the boxes that exist today. This is
    // what stops one arriving pre-ticked with steps 3 to 5, which is exactly how
    // a pre-ticked consent ships: uncontrolled, defaulted, and never reviewed.
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    let scanned = 0;

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
          scanned += 1;
          if (readFileSync(full, 'utf8').includes('defaultChecked')) offenders.push(full);
        }
      }
    };
    walk(root);

    // A scan that walked nothing passes for the wrong reason.
    expect(scanned).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
