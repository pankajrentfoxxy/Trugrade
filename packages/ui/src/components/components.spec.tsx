/**
 * Component tests, with axe on every one.
 *
 * The behavioural assertions here are not cosmetic — each of them corresponds to
 * a rule in `08_BRAND_SYSTEM.md` or a liability control in the compliance
 * research. A component that renders a missing value as a passing one, or a
 * listing image without its caption, is a legal problem wearing a UI costume.
 */

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { BRAND } from '@trugrade/config/brand';
import { ToleranceBand } from './ToleranceBand';
import { Evidence } from './Evidence';
import {
  Button,
  Input,
  StatusPill,
  GradeBadge,
  ScoreRing,
  SealChip,
  EmptyState,
  RepresentativeImage,
} from './primitives';
import { Mark, Wordmark } from '../brand/Mark';

describe('ToleranceBand — a missing value must never render as a passing one', () => {
  it('renders the found dot when there is a measurement', () => {
    render(
      <ToleranceBand
        label="Battery · Grade A band"
        bandMin={75}
        bandMax={100}
        declared={90}
        found={91}
        foundLabel="Found 91%"
      />,
    );
    expect(screen.getByTestId('tolerance-found')).toBeInTheDocument();
    expect(screen.getByTestId('tolerance-declared')).toBeInTheDocument();
  });

  it('renders NO dot at all when the value was not measured', () => {
    render(<ToleranceBand label="Thermals" bandMin={0} bandMax={100} foundLabel="Not measured" />);
    expect(screen.queryByTestId('tolerance-found')).not.toBeInTheDocument();
    expect(screen.getByText('Not measured')).toBeInTheDocument();
  });

  it('does not treat a found value of 0 as absent, nor absence as 0', () => {
    const { rerender } = render(
      <ToleranceBand
        label="Battery"
        bandMin={60}
        bandMax={100}
        found={0}
        foundLabel="Found 0%"
        outOfTolerance
      />,
    );
    expect(screen.getByTestId('tolerance-found')).toBeInTheDocument();

    rerender(
      <ToleranceBand label="Battery" bandMin={60} bandMax={100} foundLabel="Not measured" />,
    );
    expect(screen.queryByTestId('tolerance-found')).not.toBeInTheDocument();
  });

  it('describes itself to a screen reader, so colour is never the only signal', () => {
    render(
      <ToleranceBand
        label="Battery"
        bandMin={75}
        bandMax={100}
        found={62}
        foundLabel="Found 62%"
        outOfTolerance
      />,
    );
    expect(
      screen.getByRole('img', {
        name: /Battery: permitted band 75 to 100, Found 62%, outside tolerance/,
      }),
    ).toBeInTheDocument();
  });

  it('says "not measured" to a screen reader too', () => {
    render(<ToleranceBand label="Thermals" bandMin={0} bandMax={100} foundLabel="Not measured" />);
    expect(screen.getByRole('img', { name: /not measured/ })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ToleranceBand
        label="Battery"
        bandMin={75}
        bandMax={100}
        declared={90}
        found={91}
        foundLabel="Found 91%"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Evidence — every number carries its denominator', () => {
  it('shows the value with its sample size', () => {
    render(<Evidence value={98} pct denominator={412} denominatorLabel="units inspected" />);
    expect(screen.getByText('412 units inspected')).toBeInTheDocument();
  });

  it('suppresses the headline number below the sample threshold', () => {
    render(<Evidence value={100} pct denominator={3} denominatorLabel="units inspected" minSample={10} />);
    expect(screen.queryByText(/100/)).not.toBeInTheDocument();
    expect(screen.getByText('New supplier')).toBeInTheDocument();
    expect(screen.getByText('3 units inspected')).toBeInTheDocument();
  });

  it('shows the number once the sample reaches the threshold', () => {
    render(<Evidence value={97} pct denominator={10} minSample={10} />);
    expect(screen.getByTestId('evidence')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Evidence value={98} pct denominator={412} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('GradeBadge — a grade is a position on a scale, not a verdict', () => {
  it('renders neutral for every grade — no semantic colour', () => {
    for (const grade of ['A_PLUS', 'A', 'B'] as const) {
      const { container } = render(<GradeBadge grade={grade} />);
      const badge = container.querySelector('[data-testid="grade-badge"]')!;
      expect(badge.className).toContain('bg-sheet-2');
      expect(badge.className).not.toMatch(/bg-(pass|warn|fail)/);
    }
  });

  it('renders A+ readably rather than A_PLUS', () => {
    render(<GradeBadge grade="A_PLUS" />);
    expect(screen.getByText('A+')).toBeInTheDocument();
  });

  it('a declared grade says so to a screen reader, not only with a dashed border', () => {
    render(<GradeBadge grade="A" variant="declared" />);
    expect(screen.getByText(/declared by the supplier, not yet verified/)).toBeInTheDocument();
  });

  it('a corrected grade shows what it was as well as what it is', () => {
    render(<GradeBadge grade="B" variant="corrected" previousGrade="A" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});

describe('ScoreRing', () => {
  it('renders an em-dash and a dashed track when there is no score', () => {
    render(<ScoreRing value={null} />);
    expect(screen.getByRole('img', { name: 'No inspection score' })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('turns warn below 80 and signal at or above it', () => {
    const { container: low } = render(<ScoreRing value={72} />);
    expect(low.innerHTML).toContain('var(--warn)');
    const { container: high } = render(<ScoreRing value={92} />);
    expect(high.innerHTML).toContain('var(--acc)');
  });

  it('clamps a value outside 0-100 rather than drawing off the ring', () => {
    render(<ScoreRing value={140} />);
    expect(
      screen.getByRole('img', { name: 'Inspection score 100 out of 100' }),
    ).toBeInTheDocument();
  });
});

describe('StatusPill — semantic colour is never the only signal', () => {
  it('always carries its text label', () => {
    render(<StatusPill tone="fail" label="Seal broken" />);
    expect(screen.getByText('Seal broken')).toBeInTheDocument();
  });

  it('has no axe violations across every tone', async () => {
    const { container } = render(
      <>
        <StatusPill tone="neutral" label="Draft" />
        <StatusPill tone="info" label="Awaiting QC" />
        <StatusPill tone="pass" label="Passed" />
        <StatusPill tone="warn" label="Expiring" />
        <StatusPill tone="fail" label="Failed" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SealChip', () => {
  it('shows the code so a person can check it against the sticker in front of them', () => {
    render(<SealChip sealCode="TRG-26HR-0004821" status="INTACT" />);
    expect(screen.getByText('TRG-26HR-0004821')).toBeInTheDocument();
    expect(screen.getByText('Seal intact')).toBeInTheDocument();
  });

  // The failure this guards is claiming a check that nobody performed. APPLIED
  // means we sealed the machine; INTACT means somebody looked afterwards and
  // found it unbroken. Only the second is a verdict, and only the second may be
  // green. unit_is_sellable accepts APPLIED and INTACT alike, so most sellable
  // stock is APPLIED — and the buyer's handover check exists precisely because
  // those seals have NOT been verified yet.
  it('does not paint an unverified seal as a checked one', () => {
    const { container, unmount } = render(<SealChip sealCode="TRG-26HR-0004821" status="APPLIED" />);
    expect(screen.getByText('Sealed')).toBeInTheDocument();
    expect(container.querySelectorAll('.text-pass')).toHaveLength(0);
    unmount();

    // The control: a seal somebody actually checked still reads as a pass, so
    // this cannot be satisfied by draining the colour out of the component.
    const checked = render(<SealChip sealCode="TRG-26HR-0004821" status="INTACT" />);
    expect(checked.container.querySelectorAll('.text-pass')).toHaveLength(1);
    checked.unmount();

    // And the two that stop a handover keep red.
    for (const status of ['BROKEN', 'MISSING'] as const) {
      const stopped = render(<SealChip status={status} />);
      expect(stopped.container.querySelectorAll('.text-fail')).toHaveLength(1);
      stopped.unmount();
    }
  });

  it('distinguishes "no seal" from "seal intact" in words', () => {
    render(<SealChip status="NOT_APPLIED" />);
    expect(screen.getByText('No seal')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('keeps its label while loading and marks itself busy', () => {
    render(<Button loading>Place order</Button>);
    const btn = screen.getByRole('button', { name: /Place order/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('a reason-disabled button stays focusable so the reason can be read', () => {
    render(<Button disabledReason="Add a GSTIN before checking out">Checkout</Button>);
    const btn = screen.getByRole('button', { name: /Checkout/ });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('title', 'Add a GSTIN before checking out');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Input — a verified state shows the resolved entity, never just a tick', () => {
  it('associates its label, hint and error', async () => {
    const { container } = render(
      <Input
        label="GSTIN"
        hint="15 characters, as printed on your certificate"
        defaultValue="06AAFCT1234A1Z5"
        mono
      />,
    );
    expect(screen.getByLabelText('GSTIN')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('announces an error with role=alert and marks the field invalid', () => {
    render(<Input label="GSTIN" error="This GSTIN fails its check-digit test. Please re-enter." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/check-digit/);
    expect(screen.getByLabelText('GSTIN')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the resolved entity on success', () => {
    render(
      <Input
        label="GSTIN"
        verifyState="verified"
        verifyDetail="Active · Alpha Systems Private Limited · Haryana (06)"
      />,
    );
    expect(screen.getByText(/Alpha Systems Private Limited/)).toBeInTheDocument();
  });

  it('is read-only while a verification is in flight', () => {
    render(<Input label="GSTIN" verifyState="verifying" />);
    expect(screen.getByLabelText('GSTIN')).toHaveAttribute('readonly');
  });

  it('puts a field action on the same row as the box, not the label', () => {
    render(
      <Input
        label="Work email"
        hint="This becomes your sign-in address."
        action={<button type="button">Send code</button>}
      />,
    );
    const input = screen.getByLabelText('Work email');
    const button = screen.getByRole('button', { name: 'Send code' });
    expect(input.parentElement).toBe(button.parentElement?.parentElement);
  });
});

describe('RepresentativeImage — the caption cannot be omitted', () => {
  it('always states that the image is representative of the grade', () => {
    render(<RepresentativeImage src="/img.jpg" alt="Dell Latitude 5320, lid" grade="A" />);
    expect(screen.getByText(/Representative image of Grade A condition/)).toBeInTheDocument();
    expect(screen.getByText(/unit passport/)).toBeInTheDocument();
  });

  it('links to the unit passport when one is given, because it must be reachable before purchase', () => {
    render(
      <RepresentativeImage
        src="/img.jpg"
        alt="lid"
        grade="A_PLUS"
        passportHref="/units/5CD1234ABC"
      />,
    );
    expect(screen.getByRole('link', { name: 'unit passport' })).toHaveAttribute(
      'href',
      '/units/5CD1234ABC',
    );
    expect(screen.getByText(/Grade A\+ condition/)).toBeInTheDocument();
  });

  it('requires alt text — a decorative listing image is not a thing', async () => {
    const { container } = render(
      <RepresentativeImage src="/img.jpg" alt="Dell Latitude 5320, lid" grade="B" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('brand', () => {
  it('the mark is labelled and the dot is signal blue', () => {
    const { container } = render(<Mark />);
    expect(screen.getByRole('img', { name: BRAND.name })).toBeInTheDocument();
    expect(container.innerHTML).toContain('var(--acc)');
  });

  it('the wordmark comes from the brand token, not a literal', () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe('trugrade');
  });
});

describe('EmptyState', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <EmptyState title="No inspected stock matches all 6 filters" body="Try removing a filter." />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
