import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
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
  Skeleton,
  RepresentativeImage,
} from './primitives';
import { Logo, Mark, Wordmark } from '../brand/Mark';

const meta: Meta = {
  title: 'Trugrade/Design system',
  parameters: { layout: 'padded' },
};
export default meta;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-3 border-b border-rule-2 py-6">
    <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
    <div className="flex flex-wrap items-center gap-5">{children}</div>
  </div>
);

/* -------------------------------------------------------------------------- */

export const Brand: StoryObj = {
  render: () => (
    <div className="flex flex-col">
      <Row label="Mark — a tolerance gauge">
        <Mark size={16} />
        <Mark size={28} />
        <Mark size={46} />
        <Mark size={72} />
      </Row>
      <Row label="Wordmark">
        <Wordmark />
      </Row>
      <Row label="Lockup">
        <Logo />
      </Row>
    </div>
  ),
};

/**
 * The signature component. Note the third state: **not measured renders no dot
 * at all**. A missing value must never look like a passing one.
 */
export const Tolerance: StoryObj = {
  render: () => (
    <div className="flex max-w-lg flex-col gap-8">
      <ToleranceBand
        label="Battery · Grade A band"
        bandMin={75}
        bandMax={100}
        declared={90}
        found={91}
        foundLabel="Found 91%"
      />
      <ToleranceBand
        label="Battery · Grade A+ band"
        bandMin={85}
        bandMax={100}
        declared={90}
        found={62}
        foundLabel="Found 62%"
        outOfTolerance
      />
      <ToleranceBand label="Thermals" bandMin={0} bandMax={100} foundLabel="Not measured" />
    </div>
  ),
};

export const EvidenceStates: StoryObj = {
  name: 'Evidence — every number carries its denominator',
  render: () => (
    <div className="flex flex-col">
      <Row label="Enough sample to publish a headline number">
        <Evidence value={98} pct denominator={412} denominatorLabel="units" />
        <Evidence value={94} pct denominator={1204} denominatorLabel="units" />
      </Row>
      <Row label="Below the threshold — no headline number at all">
        <Evidence value={100} pct denominator={3} denominatorLabel="units" minSample={10} />
        <Evidence value={100} pct denominator={9} denominatorLabel="units" minSample={10} />
      </Row>
    </div>
  ),
};

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex flex-col">
      <Row label="Variants">
        <Button variant="primary">Place order</Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="link">How we rank</Button>
        <Button variant="danger">Withdraw unit</Button>
      </Row>
      <Row label="Sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Row>
      <Row label="States">
        <Button variant="primary" loading>
          Placing order
        </Button>
        <Button disabled>Disabled</Button>
        <Button disabledReason="Add a GSTIN before checking out">Reason-disabled</Button>
      </Row>
    </div>
  ),
};

export const Inputs: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-6">
      <Input label="Work email" type="email" placeholder="you@company.in" />
      <Input label="GSTIN" mono hint="15 characters, as printed on your certificate" required />
      <Input label="GSTIN" mono defaultValue="06AAFCT1234A1Z5" verifyState="verifying" />
      <Input
        label="GSTIN"
        mono
        defaultValue="06AAFCT1234A1Z5"
        verifyState="verified"
        verifyDetail="Active · Alpha Systems Private Limited · Haryana (06)"
      />
      <Input
        label="GSTIN"
        mono
        defaultValue="06AAFCT1234A1Z9"
        verifyState="rejected"
        error="This GSTIN fails its check-digit test. Please re-enter."
      />
      <Input
        label="Address proof"
        error="This document is dated 12 Jan 2026 — we need one issued in the last 90 days."
      />
    </div>
  ),
};

export const Status: StoryObj = {
  render: () => (
    <div className="flex flex-col">
      <Row label="Outcomes — semantic colour, always with text">
        <StatusPill tone="neutral" label="Draft" />
        <StatusPill tone="info" label="Awaiting QC" />
        <StatusPill tone="pass" label="Passed" />
        <StatusPill tone="warn" label="Expires in 9 days" />
        <StatusPill tone="fail" label="Failed" />
        <StatusPill tone="processing" label="Syncing" />
      </Row>
      <Row label="Grades — neutral, never semantic colour">
        <GradeBadge grade="A_PLUS" />
        <GradeBadge grade="A" />
        <GradeBadge grade="B" />
        <GradeBadge grade="A" variant="declared" />
        <GradeBadge grade="B" variant="corrected" previousGrade="A" />
      </Row>
      <Row label="Seals">
        <SealChip sealCode="TRG-26HR-0004821" status="INTACT" />
        <SealChip sealCode="TRG-26HR-0004822" status="BROKEN" />
        <SealChip status="NOT_APPLIED" />
      </Row>
      <Row label="Inspection score">
        <ScoreRing value={96} label="QC score" />
        <ScoreRing value={72} label="QC score" />
        <ScoreRing value={null} label="QC score" />
        <ScoreRing value={88} size={86} label="Large" />
      </Row>
    </div>
  ),
};

export const ListingImage: StoryObj = {
  name: 'Representative image — the caption is not optional',
  render: () => (
    <div className="max-w-sm">
      <RepresentativeImage
        src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='260'%3E%3Crect width='400' height='260' fill='%23e9ebe7'/%3E%3C/svg%3E"
        alt="Dell Latitude 5320, lid closed"
        grade="A"
        passportHref="/units/5CD1234ABC"
      />
    </div>
  ),
};

export const Placeholders: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Skeleton lines={3} />
      <EmptyState
        title="No inspected stock matches all 6 filters"
        body="Battery health above 90% and Grade A+ together rule out everything currently listed. Try removing one."
        action={<Button variant="primary">Clear filters</Button>}
      />
    </div>
  ),
};
