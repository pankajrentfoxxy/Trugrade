/**
 * Breadcrumb, Tabs, Stepper.
 *
 * The Stepper assertions are the load-bearing ones: 03_UX_SPEC.md §1.9.4 spells
 * out markup that looks over-specified until you know why — a future step must
 * not be a disabled `<button>`, and the position must be in words rather than
 * only in the geometry of a rail.
 */

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Breadcrumb, Stepper, Tabs, type Step } from './navigation';

describe('Breadcrumb', () => {
  it('marks the last crumb as the current page and does not link it to itself', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Dell', href: '/brands/dell' },
          { label: 'Latitude 5320' },
        ]}
      />,
    );
    expect(screen.getByText('Latitude 5320')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Latitude 5320' })).not.toBeInTheDocument();
  });

  it('hides the separator from a screen reader', () => {
    const { container } = render(
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Dell' }]} />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('/');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Dell' }]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const TAB_ITEMS = [
  { key: 'spec', label: 'Specification', panel: <p>Declared specification</p> },
  { key: 'qc', label: 'Inspection', panel: <p>What we tested</p> },
  { key: 'warranty', label: 'Warranty', panel: <p>24 months</p> },
];

function TabsHarness(): React.JSX.Element {
  const [value, setValue] = React.useState('spec');
  return <Tabs items={TAB_ITEMS} value={value} onChange={setValue} label="Product detail" />;
}

describe('Tabs', () => {
  it('is one tab stop, with the selected tab the only reachable one', () => {
    render(<TabsHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  });

  it('moves and selects with the arrow keys', async () => {
    render(<TabsHarness />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Inspection' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('What we tested');
  });

  it('wraps at the ends rather than dead-ending', async () => {
    render(<TabsHarness />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Warranty' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the ends with Home and End', async () => {
    render(<TabsHarness />);
    await userEvent.tab();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Warranty' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Specification' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(<TabsHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

const STEPS: Step[] = [
  { key: 'account', label: 'Your details', status: 'complete', href: '/register/account' },
  { key: 'company', label: 'Company & GST', status: 'current' },
  { key: 'statutory', label: 'Statutory', status: 'upcoming' },
  {
    key: 'documents',
    label: 'Documents',
    status: 'blocked',
    blockers: ['Two documents were rejected. Replace them to continue.'],
  },
  { key: 'review', label: 'Review', status: 'upcoming' },
];

describe('Stepper', () => {
  it('is a nav of an ordered list, not a tablist — each step is a real route', () => {
    const { container } = render(<Stepper steps={STEPS} label="Registration progress" />);
    expect(screen.getByRole('navigation', { name: 'Registration progress' })).toBeInTheDocument();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('says the position in words, because a rail communicates it only by geometry', () => {
    render(<Stepper steps={STEPS} label="Registration progress" />);
    expect(screen.getByText('Step 1 of 5, completed:')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 5, current:')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 5, not started:')).toBeInTheDocument();
  });

  it('renders a future step as an aria-disabled span, never a disabled button', () => {
    render(<Stepper steps={STEPS} label="Registration progress" />);
    // A disabled <button> drops out of the accessibility tree in some
    // screen-reader/browser pairs — the step would silently stop existing.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const upcoming = screen.getByText('Step 3 of 5, not started:').parentElement;
    expect(upcoming).toHaveAttribute('aria-disabled', 'true');
  });

  it('links a completed step back and marks the current one with aria-current', () => {
    render(<Stepper steps={STEPS} label="Registration progress" />);
    expect(screen.getByRole('link', { name: /Your details/ })).toHaveAttribute(
      'href',
      '/register/account',
    );
    expect(screen.getByText('Step 2 of 5, current:').parentElement).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('states a blocker as an alert and ties it to the step it blocks', () => {
    render(<Stepper steps={STEPS} label="Registration progress" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Two documents were rejected.');
    expect(screen.getByText('Step 4 of 5, blocked:').parentElement).toHaveAttribute(
      'aria-describedby',
      alert.id,
    );
  });

  it('announces the current step politely', () => {
    render(<Stepper steps={STEPS} label="Registration progress" />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 5. Company & GST.');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Stepper steps={STEPS} label="Registration progress" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
