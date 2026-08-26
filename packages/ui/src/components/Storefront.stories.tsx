import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import { BRAND } from '@trugrade/config/brand';
import { Money, landedPrice, qualityHeadline } from '@trugrade/contracts';
import { Button, EmptyState } from './primitives';
import { DataTable, Pagination, type Column } from './data';
import { Breadcrumb, Stepper, Tabs, type Step } from './navigation';
import { Modal, ToastProvider, useToast } from './overlays';
import { Checkbox, Chip, Uploader, type UploadedFile } from './forms';
import { OfferGrid, PriceBreakup, landedPriceLines, type SupplyPointOffer } from './commerce';

const meta: Meta = {
  title: `${BRAND.name}/Storefront`,
  parameters: { layout: 'padded' },
};
export default meta;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-3 border-b border-rule-2 py-6">
    <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
    <div className="flex flex-col gap-5">{children}</div>
  </div>
);

/* -------------------------------------------------------------------------- */

const LINES = landedPriceLines(
  landedPrice({
    sellingPrice: Money.parse('24000.00'),
    freight: Money.parse('480.00'),
    gstRatePct: 18,
    deliveryStateCode: '07',
    ourStateCode: '06',
  }),
);

const OFFERS: SupplyPointOffer[] = [
  {
    supplyPointCode: 'A',
    city: 'Gurugram',
    landedPrice: Money.parse('28886.40'),
    priceLines: LINES,
    valuationMethod: 'REGULAR',
    grade: 'A',
    batteryHealthPct: { min: 88, max: 94 },
    quality: qualityHeadline({
      unitsInspected: 412,
      avgQcScore: 91,
      gradeAccuracyPct: 98,
      minSampleForHeadline: 10,
    }),
    totalWarrantyMonths: 12,
    unitsAvailable: 14,
    inspectedOn: '4 Aug 2026',
    qcExpiresOn: '2 Nov 2026',
    qcExpiresInDays: 68,
    dispatchCommitment: 'Ships in 24 h',
  },
  {
    supplyPointCode: 'B',
    city: 'Noida',
    landedPrice: Money.parse('27100.00'),
    priceLines: LINES,
    valuationMethod: 'MARGIN',
    grade: 'A',
    batteryHealthPct: { min: 82, max: 90 },
    quality: qualityHeadline({
      unitsInspected: 3,
      avgQcScore: 100,
      gradeAccuracyPct: 100,
      minSampleForHeadline: 10,
    }),
    totalWarrantyMonths: 12,
    unitsAvailable: 2,
    inspectedOn: '19 Aug 2026',
    qcExpiresOn: '5 Sep 2026',
    qcExpiresInDays: 9,
    dispatchCommitment: 'Ships in 48 h',
  },
];

/**
 * The comparison grid — the screen the whole storefront exists to serve.
 *
 * Read the second row: three inspected units earns the words "New supplier · 3
 * units inspected" rather than a 100% accuracy badge, its inspection expiry is
 * flagged inside the 14-day window, and its MARGIN valuation states the input
 * tax credit consequence inside the break-up. None of the three is an option a
 * caller can switch off.
 */
export const Offers: StoryObj = {
  render: () => (
    <OfferGrid
      offers={OFFERS}
      caption="2 supply points offering Dell Latitude 5320 · i5-1145G7 / 16 GB / 512 GB, sorted by landed price, lowest first. Prices include GST and freight to 110020."
      onAdd={() => {}}
      itcExplainerHref="/legal/margin-scheme"
    />
  ),
};

export const Price: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-8">
      <PriceBreakup
        lines={LINES}
        valuationMethod="REGULAR"
        taxNote="Includes GST and freight to 110020."
      />
      <PriceBreakup
        lines={LINES}
        valuationMethod="MARGIN"
        taxNote="Includes GST and freight to 110020."
        itcExplainerHref="/legal/margin-scheme"
      />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */

interface ListingRow {
  id: string;
  model: string;
  grade: string;
  units: number;
}

const LISTING_COLUMNS: Column<ListingRow>[] = [
  { key: 'model', header: 'Model', cell: (r) => r.model, sortable: true },
  { key: 'grade', header: 'Grade', cell: (r) => r.grade },
  { key: 'units', header: 'Units', cell: (r) => r.units, numeric: true, sortable: true },
];

const LISTING_ROWS: ListingRow[] = [
  { id: '1', model: 'Dell Latitude 5320', grade: 'A', units: 14 },
  { id: '2', model: 'Lenovo ThinkPad T14', grade: 'A+', units: 6 },
  { id: '3', model: 'HP EliteBook 840 G7', grade: 'B', units: 21 },
];

export const Tables: StoryObj = {
  render: () => (
    <div className="flex flex-col">
      <Row label="DataTable — sorted">
        <DataTable
          caption="3 listings, sorted by units, most first."
          columns={LISTING_COLUMNS}
          rows={LISTING_ROWS}
          rowKey={(r) => r.id}
          sort={{ key: 'units', direction: 'desc' }}
          onSort={() => {}}
        />
      </Row>
      <Row label="DataTable — loading, header stays real">
        <DataTable
          caption="Loading listings."
          columns={LISTING_COLUMNS}
          rows={[]}
          rowKey={(r) => r.id}
          loading
        />
      </Row>
      <Row label="DataTable — empty after filtering">
        <DataTable
          caption="No listings match all 6 filters."
          columns={LISTING_COLUMNS}
          rows={[]}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="No inspected stock matches all 6 filters"
              body="Try removing the battery-health filter — it is the one excluding the most units."
              action={<Button>Clear filters</Button>}
            />
          }
        />
      </Row>
      <Row label="Pagination">
        <Pagination page={5} pageCount={20} onPage={() => {}} />
      </Row>
    </div>
  ),
};

/* -------------------------------------------------------------------------- */

const STEPS: Step[] = [
  { key: 'account', label: 'Your details', status: 'complete', href: '#', summary: '+91 98••• ••210' },
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

function TabsDemo(): React.JSX.Element {
  const [value, setValue] = React.useState('spec');
  return (
    <Tabs
      label="Product detail"
      value={value}
      onChange={setValue}
      items={[
        { key: 'spec', label: 'Specification', panel: <p>i5-1145G7 · 16 GB · 512 GB NVMe</p> },
        { key: 'qc', label: 'Inspection', panel: <p>41 checks, 9 areas, per unit.</p> },
        { key: 'warranty', label: 'Warranty', panel: <p>12 months.</p> },
      ]}
    />
  );
}

export const Navigation: StoryObj = {
  render: () => (
    <div className="flex flex-col">
      <Row label="Breadcrumb">
        <Breadcrumb
          items={[
            { label: 'Home', href: '#' },
            { label: 'Dell', href: '#' },
            { label: 'Latitude 5320' },
          ]}
        />
      </Row>
      <Row label="Tabs">
        <TabsDemo />
      </Row>
      <Row label="Stepper — one blocked step">
        <Stepper steps={STEPS} label="Registration progress" />
      </Row>
    </div>
  ),
};

/* -------------------------------------------------------------------------- */

const UPLOADED: UploadedFile[] = [
  { id: '1', name: 'GST-cert.pdf', sizeBytes: 384_512, status: 'accepted' },
  {
    id: '2',
    name: 'udyam.pdf',
    sizeBytes: 91_000,
    status: 'rejected',
    rejectionReason: 'The GSTIN on this certificate does not match the one you entered.',
  },
];

function FormsDemo(): React.JSX.Element {
  const [brands, setBrands] = React.useState<string[]>(['Dell']);
  const [agreed, setAgreed] = React.useState(false);

  return (
    <div className="flex flex-col">
      <Row label="Chips — facet counts, never a scarcity count">
        <div className="flex flex-wrap gap-2">
          {[
            ['Dell', 128],
            ['Lenovo', 96],
            ['HP', 64],
          ].map(([label, count]) => (
            <Chip
              key={label as string}
              label={label as string}
              count={count as number}
              selected={brands.includes(label as string)}
              onToggle={() =>
                setBrands((current) =>
                  current.includes(label as string)
                    ? current.filter((b) => b !== label)
                    : [...current, label as string],
                )
              }
            />
          ))}
        </div>
      </Row>
      <Row label="Checkbox — starts unchecked, and states its consequence">
        <Checkbox
          label="Allow my team to raise orders without approval"
          consequence="Anyone with the Procurer role will be able to place orders on credit, up to your account limit."
          checked={agreed}
          onChange={setAgreed}
        />
      </Row>
      <Row label="Uploader — a real file input, a rejected file that keeps its reason">
        <Uploader
          label="GST registration certificate"
          hint="PDF or JPG, up to 10 MB. The certificate as downloaded from the GST portal, not a photo of a printout."
          accept="application/pdf,image/jpeg"
          maxSizeMb={10}
          files={UPLOADED}
          onSelect={() => {}}
          onRemove={() => {}}
        />
      </Row>
    </div>
  );
}

export const Forms: StoryObj = { render: () => <FormsDemo /> };

/* -------------------------------------------------------------------------- */

function OverlayDemo(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Approve 14 listings
      </Button>
      <Button onClick={() => toast({ tone: 'success', title: 'Listing published' })}>
        Success toast
      </Button>
      <Button
        onClick={() =>
          toast({ tone: 'error', title: 'Payout run failed', body: 'Two beneficiaries were rejected by the bank.' })
        }
      >
        Error toast — does not auto-dismiss
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Approve 14 listings"
        description="Approved listings go live immediately and are visible to buyers."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Approve 14
            </Button>
          </>
        }
      >
        <p className="text-body-sm text-ink-2">
          This cannot be undone from here — an approved listing is withdrawn, not un-approved.
        </p>
      </Modal>
    </div>
  );
}

export const Overlays: StoryObj = {
  render: () => (
    <ToastProvider>
      <OverlayDemo />
    </ToastProvider>
  ),
};
