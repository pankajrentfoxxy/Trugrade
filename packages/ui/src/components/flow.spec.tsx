/**
 * Archetype D — StepRail, FormSection, WhyRail.
 *
 * The load-bearing assertion is the save state: a rail that renders nothing
 * when nothing has been saved looks identical to one that has saved, and a
 * seven-step vendor application is abandoned on exactly that ambiguity.
 */

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { FormSection, StepRail, WhyRail } from './flow';
import type { Step } from './navigation';

const STEPS: Step[] = [
  { key: 'contact', label: 'Contact', status: 'complete', href: '/register/1' },
  { key: 'business', label: 'Business', status: 'complete', href: '/register/2' },
  { key: 'statutory', label: 'Statutory', status: 'current' },
  { key: 'capability', label: 'Capability', status: 'upcoming' },
  { key: 'bank', label: 'Bank', status: 'blocked', blockers: ['Add a GSTIN first.'] },
];

describe('StepRail', () => {
  it('counts the completed steps out of the total, in mono', () => {
    render(<StepRail steps={STEPS} label="Vendor application" />);
    const rail = screen.getByTestId('step-rail');
    // "2 of 5 done" — the numerals are their own elements so they can be mono.
    expect(rail).toHaveTextContent(/2\s*of\s*5\s*done/);
    expect(within(rail).getByText('2')).toHaveClass('tnum');
  });

  it('says nothing has been saved rather than implying a draft exists', () => {
    render(<StepRail steps={STEPS} label="Vendor application" />);
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Close this and come back/)).not.toBeInTheDocument();
  });

  it('shows the save state and the resume link once a draft exists', () => {
    render(
      <StepRail steps={STEPS} label="Vendor application" savedAt="2 minutes ago" resumeHref="/r/9" />,
    );
    expect(screen.getByText(/Saved 2 minutes ago/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume link' })).toHaveAttribute('href', '/r/9');
    expect(screen.queryByText(/Nothing saved yet/)).not.toBeInTheDocument();
  });

  it('keeps the Stepper markup rules rather than restating them', () => {
    render(<StepRail steps={STEPS} label="Vendor application" />);
    // A future step is never a disabled <button> — it would drop out of the
    // accessibility tree, and the step would silently stop existing.
    expect(screen.queryByRole('button', { name: /Capability/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Capability/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <StepRail steps={STEPS} label="Vendor application" savedAt="2 minutes ago" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FormSection', () => {
  it('groups its fields under a legend, so every field is re-announced with it', () => {
    render(
      <FormSection title="Registered address" description="As printed on the GST certificate.">
        <label htmlFor="pin">Pincode</label>
        <input id="pin" />
      </FormSection>,
    );
    const group = screen.getByRole('group', { name: /Registered address/ });
    expect(group.tagName).toBe('FIELDSET');
    expect(group).toHaveTextContent('As printed on the GST certificate.');
  });

  it('carries the tick rule under the heading', () => {
    render(
      <FormSection title="Bank account">
        <input aria-label="IFSC" />
      </FormSection>,
    );
    expect(screen.getByTestId('form-section').querySelector('.tickrule')).toBeInTheDocument();
  });

  it('renders no status when none was given, rather than a zero', () => {
    render(
      <FormSection title="Contacts">
        <input aria-label="Name" />
      </FormSection>,
    );
    expect(screen.getByTestId('form-section')).not.toHaveTextContent('0');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <FormSection title="Statutory" status="3 of 5 verified">
        <label htmlFor="gstin">GSTIN</label>
        <input id="gstin" />
      </FormSection>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const WHY = [
  {
    term: 'Primary GSTIN',
    explanation: 'Every invoice we raise for you carries this one. You can change it later.',
  },
  { term: 'PAN', explanation: 'We deduct TDS against it and report it in our quarterly return.' },
];

describe('WhyRail', () => {
  it('pairs each term with its explanation as a definition list', () => {
    render(<WhyRail items={WHY} />);
    const rail = screen.getByRole('complementary', { name: 'Why we ask' });
    expect(within(rail).getByText('Primary GSTIN').tagName).toBe('DT');
    expect(within(rail).getByText(/Every invoice we raise/).tagName).toBe('DD');
  });

  it('marks the active term with weight as well as colour', () => {
    render(<WhyRail items={WHY} activeTerm="PAN" />);
    const pan = screen.getByText('PAN');
    expect(pan).toHaveClass('text-ink');
    expect(screen.getByText('Primary GSTIN')).toHaveClass('text-ink-2');
    expect(pan.parentElement).toHaveClass('border-acc');
  });

  it('has no axe violations', async () => {
    const { container } = render(<WhyRail items={WHY} activeTerm="PAN" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
