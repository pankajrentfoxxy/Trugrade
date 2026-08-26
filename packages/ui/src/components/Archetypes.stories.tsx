import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import { BRAND } from '@trugrade/config/brand';
import { StepRail, FormSection, WhyRail } from './flow';
import { RecordHeader, SidePanel, Timeline, AddressCard, type Address } from './record';
import { KpiRow, QueueList, type Kpi, type QueueItem } from './workspace';
import { DocumentViewer, type DocumentPage } from './DocumentViewer';
import { OtpInput } from './forms';
import { DataBoard, type Column } from './data';
import { Button, EmptyState, Input, StatusPill } from './primitives';
import type { Step } from './navigation';

/**
 * The archetype components, one story per state.
 *
 * **Both themes come from the toolbar**, not from duplicated stories: `data-t`
 * lives on `<html>` and the tokens are defined on `:root[data-t=…]`, so a story
 * that wrapped itself in a themed `<div>` would render the default theme and
 * quietly prove nothing. Flip Theme in the toolbar — or open the story with
 * `?globals=theme:light` — and every story in this file re-renders.
 *
 * Density works the same way, which is the point: there is one table, and the
 * toolbar is the only thing that changes its row height.
 */
const meta: Meta = {
  title: `${BRAND.name}/Archetypes`,
  parameters: { layout: 'padded' },
};
export default meta;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-3 border-b border-rule-2 py-6">
    <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
    <div className="flex flex-col gap-5">{children}</div>
  </div>
);

/* ==========================================================================
 * Archetype D — Flow
 * ======================================================================== */

const STEPS: Step[] = [
  {
    key: 'contact',
    label: 'Contact',
    status: 'complete',
    href: '#1',
    summary: 'Rahul M. · +91 98••• ••210',
  },
  { key: 'business', label: 'Business', status: 'complete', href: '#2', summary: 'Pvt Ltd · 2014' },
  { key: 'statutory', label: 'Statutory', status: 'current' },
  { key: 'capability', label: 'Capability', status: 'upcoming' },
  { key: 'facility', label: 'Facility', status: 'upcoming' },
  { key: 'documents', label: 'Documents and bank', status: 'upcoming' },
  {
    key: 'agreement',
    label: 'Agreement and payout',
    status: 'blocked',
    blockers: ['A verified PAN is needed before the agreement can be signed.'],
  },
];

const WHY = [
  {
    term: 'GSTIN',
    explanation:
      'We check it against the GST portal and show you the legal name it returns, so an invoice is never raised to the wrong entity.',
  },
  {
    term: 'Primary GSTIN',
    explanation:
      'Every invoice we raise for you carries this one, and it decides whether the tax splits as IGST or as CGST plus SGST. You can change it later.',
  },
  {
    term: 'PAN',
    explanation:
      'We deduct TDS against it and report it in our quarterly return. A mismatch here shows up as a notice for you, not for us.',
  },
];

export const FlowStepRail: StoryObj = {
  name: 'D · StepRail',
  render: () => (
    <div className="grid max-w-4xl gap-5 md:grid-cols-2">
      <Row label="Draft saved — the normal state">
        <StepRail
          steps={STEPS}
          label="Vendor application"
          savedAt="2 minutes ago"
          resumeHref="#resume"
        />
      </Row>
      <Row label="Nothing saved yet — never dressed up as a save">
        <StepRail steps={STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'current' : 'upcoming' }))} label="Vendor application" />
      </Row>
    </div>
  ),
};

export const FlowStep: StoryObj = {
  name: 'D · one step, with FormSection and WhyRail',
  render: () => (
    <div className="grid max-w-6xl gap-5 lg:grid-cols-[262px_minmax(0,1fr)_280px]">
      <StepRail steps={STEPS} label="Vendor application" savedAt="2 minutes ago" />

      <form className="tg-card flex flex-col gap-7 rounded-lg border border-rule bg-sheet">
        <FormSection
          title="Statutory identifiers"
          description="Each one is verified against the issuing authority before you can continue."
          status="2 of 5 verified"
        >
          <Input
            label="GSTIN"
            mono
            required
            defaultValue="06AABCT1234C1Z5"
            verifyState="verified"
            verifyDetail="TRUETECH SERVICES PRIVATE LIMITED · Private Limited · Haryana"
          />
          <Input
            label="PAN"
            mono
            required
            defaultValue="AABCT1234C"
            verifyState="verifying"
          />
          <Input
            label="Udyam registration"
            mono
            defaultValue="UDYAM-HR-05-000123"
            error="Udyam numbers run UDYAM-XX-00-0000000. This one has six digits after the last dash, not seven."
          />
        </FormSection>

        <FormSection title="Tax deduction">
          <Input label="TAN" mono hint="Ten characters, as issued by the Income Tax Department." />
        </FormSection>

        <div className="flex gap-3">
          <Button variant="primary">Verify and continue</Button>
          <Button variant="ghost">Save and close</Button>
        </div>
      </form>

      <WhyRail items={WHY} activeTerm="Primary GSTIN" />
    </div>
  ),
};

/* ==========================================================================
 * Archetype C — Record
 * ======================================================================== */

const EVENTS = [
  {
    key: 'e4',
    action: 'Grade corrected to B',
    actor: 'Priya N., inspector',
    at: '9 Aug 2026, 11:20',
    dateTime: '2026-08-09T11:20:00+05:30',
    reason: 'Lid dent 12 mm on the top case, not declared at listing.',
    current: true,
  },
  {
    key: 'e3',
    action: 'Inspection completed',
    actor: 'Trugrade',
    at: '9 Aug 2026, 10:02',
    dateTime: '2026-08-09T10:02:00+05:30',
    detail: 'Seal TG-SL-88214 applied.',
  },
  {
    key: 'e2',
    action: 'QC visit scheduled',
    actor: 'Supply Point A · Gurugram',
    at: '6 Aug 2026, 15:41',
    dateTime: '2026-08-06T15:41:00+05:30',
  },
  {
    key: 'e1',
    action: 'Listing created',
    actor: 'Supply Point A · Gurugram',
    at: '4 Aug 2026, 18:04',
    dateTime: '2026-08-04T18:04:00+05:30',
  },
];

export const RecordScreen: StoryObj = {
  name: 'C · RecordHeader, SidePanel and Timeline',
  render: () => (
    <div className="flex max-w-6xl flex-col gap-6">
      <RecordHeader
        title="Dell Latitude 5320"
        subtitle="i5-1135G7 · 16 GB · 512 GB NVMe · 13.3in FHD"
        status={<StatusPill tone="pass" label="Passed" />}
        identifiers={[
          { label: 'Serial', value: 'CN0X1Y2Z3', href: '#unit' },
          { label: 'Seal', value: 'TG-SL-88214' },
          { label: 'Certificate', value: 'DS-2026-0044821', href: '#cert' },
          { label: 'Supply point', value: 'A · Gurugram' },
        ]}
        secondaryActions={<Button variant="ghost">Download report</Button>}
        action={<Button variant="primary">Add to cart</Button>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex flex-col gap-4">
          <h2 className="text-h3 text-ink">History</h2>
          <Timeline events={EVENTS} label="Unit history" />
        </section>

        <SidePanel
          title="Actions"
          description="What you can do with this unit right now."
          footnote="Adding to cart holds this exact serial for 20 minutes. Nothing is charged until checkout."
        >
          <Button variant="primary" block>
            Add to cart
          </Button>
          <Button block>Request a second inspection</Button>
          <Button variant="ghost" block>
            Report a discrepancy
          </Button>
        </SidePanel>
      </div>
    </div>
  ),
};

export const RecordTimelineSparse: StoryObj = {
  name: 'C · Timeline — one event, no recorded reason',
  render: () => (
    <div className="max-w-lg">
      <Timeline
        label="Order timeline"
        events={[
          {
            key: 'only',
            action: 'Order placed',
            actor: 'Anita R., procurement',
            at: '27 Aug 2026, 09:12',
            dateTime: '2026-08-27T09:12:00+05:30',
            current: true,
          },
        ]}
      />
      <p className="mt-4 text-body-sm text-ink-4">
        No &ldquo;Reason: not specified&rdquo;. Nobody recorded one, so nothing is printed.
      </p>
    </div>
  ),
};

const FULL_ADDRESS: Address = {
  label: 'Warehouse 2 — Manesar',
  line1: 'Plot 14, Sector 34',
  line2: 'IMT Manesar',
  city: 'Gurugram',
  state: 'Haryana',
  pincode: '122051',
  landmark: 'Opposite the Maruti gate 3',
  contactName: 'R. Sharma',
  contactMobile: '+919876543210',
  gateInstructions: 'Gate 3 only. Ask for the security desk; commercial vehicles are turned away at gate 1.',
  receivingHours: 'Mon–Sat, 09:30–18:00. Closed on the second Saturday.',
  gstin: '06AABCT1234C1Z5',
};

const SPARSE_ADDRESS: Address = {
  label: 'Billing — head office',
  line1: '2nd floor, Cyber Hub',
  city: 'Gurugram',
  state: 'Haryana',
  pincode: '122002',
  gstin: '06AABCT1234C1Z5',
};

export const RecordAddresses: StoryObj = {
  name: 'C · AddressCard — complete, sparse, selected',
  render: () => (
    <div className="grid max-w-5xl gap-5 md:grid-cols-3">
      <AddressCard address={FULL_ADDRESS} badge={<StatusPill tone="info" label="Default" />} />
      <AddressCard address={SPARSE_ADDRESS} actions={<Button size="sm">Edit</Button>} />
      <AddressCard address={FULL_ADDRESS} selected actions={<Button size="sm">Change</Button>} />
    </div>
  ),
};

/* ==========================================================================
 * Archetype E — Workspace
 * ======================================================================== */

const KPIS: Kpi[] = [
  { key: 'orders', label: 'Orders today', value: 42, unit: 'orders', href: '#orders' },
  { key: 'gmv', label: 'Value dispatched', value: '₹18.4 L', hint: 'Ex-GST, at our sale price.' },
  {
    key: 'accuracy',
    label: 'Grade accuracy',
    pct: 98,
    denominator: 412,
    denominatorLabel: 'units inspected',
    href: '#qc',
  },
  {
    key: 'ontime',
    label: 'On-time dispatch',
    pct: null,
    denominator: 118,
    denominatorLabel: 'orders',
    hint: 'The courier feed has been down since 06:00.',
  },
  { key: 'nps', label: 'Buyer NPS', value: null },
];

const QUEUES: QueueItem[] = [
  {
    key: 'catalog',
    label: 'Catalog requests',
    href: '#catalog',
    count: 9,
    breachedCount: 0,
    oldestWaitHours: 6,
    slaHours: 24,
    description: 'New SKU requests from vendors.',
  },
  {
    key: 'onboarding',
    label: 'Onboarding review',
    href: '#onboarding',
    count: 34,
    breachedCount: 12,
    oldestWaitHours: 61,
    slaHours: 48,
    description: 'Vendor and customer applications awaiting a decision.',
  },
  {
    key: 'returns',
    label: 'Return claims',
    href: '#returns',
    count: 5,
    slaHours: 48,
    description: 'Inside the 48-hour window.',
  },
  {
    key: 'grades',
    label: 'Grade corrections awaiting vendor',
    href: '#grades',
    count: 17,
    breachedCount: 3,
    oldestWaitHours: 55,
    slaHours: 48,
  },
];

export const Workspace: StoryObj = {
  name: 'E · KpiRow and QueueList',
  render: () => (
    <div className="flex max-w-5xl flex-col gap-6">
      <KpiRow items={KPIS} label="Today" />
      <QueueList items={QUEUES} label="What is stuck" />
      <p className="text-body-sm text-ink-4">
        The list is not in the order it was passed in. Onboarding review is first because twelve of
        its items are past a 48-hour promise; Return claims is last because nobody has measured it.
      </p>
    </div>
  ),
};

export const WorkspaceClear: StoryObj = {
  name: 'E · QueueList — everything within SLA',
  render: () => (
    <div className="max-w-3xl">
      <QueueList
        label="What is stuck"
        items={QUEUES.map((q) => ({
          ...q,
          breachedCount: 0,
          oldestWaitHours: 3,
        }))}
      />
    </div>
  ),
};

/* ==========================================================================
 * OtpInput
 * ======================================================================== */

function OtpDemo({ initial, error }: { initial: string; error?: string }): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  return (
    <OtpInput
      value={value}
      onChange={setValue}
      label="Enter the code sent to +91 98••• ••210"
      error={error}
    />
  );
}

export const Otp: StoryObj = {
  name: 'OtpInput — empty, filled, expired',
  render: () => (
    <div className="flex max-w-md flex-col">
      <Row label="Empty — paste anywhere fills all six">
        <OtpDemo initial="" />
      </Row>
      <Row label="Filled">
        <OtpDemo initial="418902" />
      </Row>
      <Row label="Rejected — the real reason, not “Invalid input”">
        <OtpDemo initial="418902" error="That code has expired. We have sent a new one." />
      </Row>
    </div>
  ),
};

/* ==========================================================================
 * DocumentViewer
 * ======================================================================== */

/**
 * An inline placeholder page, so the story has no network dependency.
 *
 * THE ONE PLACE LITERAL HEX IS CORRECT, and it is worth saying why rather than
 * leaving it to look like the rule slipped. Everything CLAUDE.md's "no literal
 * hex outside globals.css" governs is *interface*, and interface must follow the
 * theme. This is not interface — it is a stand-in for a PHOTOGRAPH OF PAPER, the
 * scanned GST certificate a reviewer opens in `DocumentViewer`.
 *
 * A scanned page is white in both themes because the paper was white. Painting
 * it with `--sheet` would make the document itself invert when a reviewer
 * switched to dark mode, which no real scan does and which would make a
 * tampered scan harder to spot, not easier. The viewer's chrome around it is
 * tokenised; the page it displays is content.
 */
const SCAN_PAPER = '#ffffff';
const SCAN_INK = '#101319';
const SCAN_INK_2 = '#3c444f';
const SCAN_RULE = '#dde0e5';

const page = (n: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="877" viewBox="0 0 620 877">` +
      `<rect width="620" height="877" fill="${SCAN_PAPER}"/>` +
      `<text x="40" y="80" font-family="monospace" font-size="26" fill="${SCAN_INK}">FORM GST REG-06</text>` +
      `<text x="40" y="130" font-family="monospace" font-size="18" fill="${SCAN_INK_2}">Page ${n}</text>` +
      `<rect x="40" y="170" width="540" height="1" fill="${SCAN_RULE}"/>` +
      `</svg>`,
  )}`;

const PAGES: DocumentPage[] = [
  { src: page(1), alt: 'GST registration certificate, page 1 of 2' },
  { src: page(2), alt: 'GST registration certificate, page 2 of 2' },
];

export const Documents: StoryObj = {
  name: 'DocumentViewer — pages, and nothing to render',
  render: () => (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <DocumentViewer
        name="GST registration certificate"
        meta="PDF · 1.2 MB · 4 Aug 2026"
        pages={PAGES}
        downloadHref="#original"
        downloadName="gst-certificate.pdf"
      />
      <DocumentViewer name="Board resolution" pages={[]} downloadHref="#original" />
    </div>
  ),
};

/* ==========================================================================
 * DataBoard — one table, three densities
 * ======================================================================== */

interface Unit {
  id: string;
  serial: string;
  model: string;
  grade: string;
  score: number;
  price: string;
}

const UNIT_ROWS: Unit[] = [
  { id: '1', serial: 'CN0X1Y2Z3', model: 'Latitude 5320', grade: 'A', score: 94, price: '₹28,886' },
  { id: '2', serial: 'CN0X1Y2Z4', model: 'Latitude 5420', grade: 'A+', score: 97, price: '₹31,240' },
  { id: '3', serial: 'CN0X1Y2Z5', model: 'ThinkPad T14', grade: 'B', score: 81, price: '₹24,110' },
  { id: '4', serial: 'CN0X1Y2Z6', model: 'EliteBook 840', grade: 'A', score: 90, price: '₹27,505' },
];

const UNIT_COLUMNS: Column<Unit>[] = [
  { key: 'serial', header: 'Serial', cell: (r) => <span className="tnum">{r.serial}</span> },
  { key: 'model', header: 'Model', cell: (r) => r.model },
  { key: 'grade', header: 'Grade', cell: (r) => <span className="tnum">{r.grade}</span> },
  { key: 'score', header: 'QC', cell: (r) => r.score, numeric: true, sortable: true },
  { key: 'price', header: 'Landed', cell: (r) => r.price, numeric: true, sortable: true },
];

export const Board: StoryObj = {
  name: 'B · DataBoard — flip Density in the toolbar',
  render: () => (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="rounded-lg border border-rule bg-sheet">
        <DataBoard
          caption="4 units, sorted by landed price, lowest first."
          columns={UNIT_COLUMNS}
          rows={UNIT_ROWS}
          rowKey={(r) => r.id}
          sort={{ key: 'price', direction: 'asc' }}
          onSort={() => {}}
        />
      </div>
      <p className="text-body-sm text-ink-4">
        60px comfortable · 46px default · 34px compact, from <code>data-density</code> on the root.
        No prop changes here — there is one table, and this is it.
      </p>
    </div>
  ),
};

export const BoardStates: StoryObj = {
  name: 'B · DataBoard — loading and empty',
  render: () => (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="rounded-lg border border-rule bg-sheet">
        <DataBoard
          caption="Loading units."
          columns={UNIT_COLUMNS}
          rows={[]}
          rowKey={(r: Unit) => r.id}
          loading
        />
      </div>
      <div className="rounded-lg border border-rule bg-sheet">
        <DataBoard
          caption="No units match these filters."
          columns={UNIT_COLUMNS}
          rows={[]}
          rowKey={(r: Unit) => r.id}
          empty={
            <EmptyState
              title="No units match these filters"
              body="Battery health above 95% and Grade B together return nothing. Widen one of them."
              action={<Button>Clear battery filter</Button>}
            />
          }
        />
      </div>
    </div>
  ),
};
