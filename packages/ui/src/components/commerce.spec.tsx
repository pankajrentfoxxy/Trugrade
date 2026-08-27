/**
 * PriceBreakup and the offer grid.
 *
 * The offer grid is the highest-risk component in the product, so this file does
 * to the rendered markup what `04_TEST_PLAN.md` §3.1 does to an API response:
 * takes a real vendor identity and looks for any part of it at any depth
 * (`findVendorIdentityLeaks`, IDN-080…IDN-094). Asserting on the fields we
 * remembered to check would prove only that we remembered.
 */

import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import {
  Money,
  findVendorIdentityLeaks,
  landedPrice,
  qualityHeadline,
  type VendorIdentity,
} from '@trugrade/contracts';
import {
  OfferGrid,
  PriceBreakup,
  assertSupplyPointOnly,
  landedPriceLines,
  type SupplyPointOffer,
} from './commerce';

/* -------------------------------------------------------------------------- */
/* PriceBreakup                                                               */
/* -------------------------------------------------------------------------- */

const REGULAR_LINES = landedPriceLines(
  landedPrice({
    sellingPrice: Money.parse('24000.00'),
    freight: Money.parse('480.00'),
    gstRatePct: 18,
    deliveryStateCode: '07',
    ourStateCode: '06',
  }),
);

describe('PriceBreakup', () => {
  it('totals its own lines, because a break-up that disagrees with its total is the only way it can be wrong', () => {
    render(<PriceBreakup lines={REGULAR_LINES} valuationMethod="REGULAR" />);
    // 24000 + 480 + 18% IGST on 24480 = 28,886.40
    expect(screen.getByTestId('price-breakup-total')).toHaveTextContent('₹28,886.40');
  });

  it('shows every line at once — no line is behind a "show more"', () => {
    render(<PriceBreakup lines={REGULAR_LINES} valuationMethod="REGULAR" />);
    for (const label of ['Unit price', 'Freight', 'IGST']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('carries the Rule 32(5) narration and the ITC consequence on a MARGIN line', () => {
    render(<PriceBreakup lines={REGULAR_LINES} valuationMethod="MARGIN" />);
    expect(
      screen.getByText(/Value determined under Rule 32\(5\) of the CGST Rules, 2017/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Input tax credit available to you: nil on this line/),
    ).toBeInTheDocument();
  });

  it('says nothing about the margin scheme on a REGULAR line', () => {
    render(<PriceBreakup lines={REGULAR_LINES} valuationMethod="REGULAR" />);
    expect(screen.queryByText(/Rule 32\(5\)/)).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <PriceBreakup
        lines={REGULAR_LINES}
        valuationMethod="MARGIN"
        taxNote="Includes GST and freight to 110020."
        itcExplainerHref="/legal/margin-scheme"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('landedPriceLines', () => {
  it('splits into CGST and SGST within the state, and IGST across it', () => {
    const intra = landedPriceLines(
      landedPrice({
        sellingPrice: Money.parse('10000.00'),
        freight: Money.ZERO,
        gstRatePct: 18,
        deliveryStateCode: '06',
        ourStateCode: '06',
      }),
    );
    expect(intra.map((l) => l.label)).toEqual(['Unit price', 'CGST', 'SGST']);
  });

  it('says UTGST in a union territory, which is the label the invoice must carry', () => {
    const ut = landedPriceLines(
      landedPrice({
        sellingPrice: Money.parse('10000.00'),
        freight: Money.ZERO,
        gstRatePct: 18,
        deliveryStateCode: '04',
        ourStateCode: '04',
      }),
      { deliveryStateCode: '04' },
    );
    expect(ut.map((l) => l.label)).toContain('UTGST');
  });

  it('omits a freight line rather than printing a zero', () => {
    const noFreight = landedPriceLines(
      landedPrice({
        sellingPrice: Money.parse('10000.00'),
        freight: Money.ZERO,
        gstRatePct: 18,
        deliveryStateCode: '07',
        ourStateCode: '06',
      }),
    );
    expect(noFreight.map((l) => l.label)).not.toContain('Freight');
  });
});

/* -------------------------------------------------------------------------- */
/* The offer grid                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A real seeded vendor, in every form their identity could leak in. The sweep
 * below looks for all of it in the rendered HTML.
 */
const VENDOR: VendorIdentity = {
  orgId: '0f3c6a52-9d2b-4f11-9c17-2b8a5e6d4411',
  legalName: 'Northwind Logistics Private Limited',
  tradeName: 'Northwind Refurb',
  gstin: '06AAFCT1234A1Z5',
  pan: 'AAFCT1234A',
  addressLines: ['Plot 41, Sector 34, Industrial Area'],
  phones: ['+91 98100 11122'],
  emails: ['ops@northwind-refurb.co.in'],
  slug: 'northwind-refurb',
};

function offer(overrides: Partial<SupplyPointOffer> = {}): SupplyPointOffer {
  return {
    supplyPointCode: 'A',
    city: 'Gurugram',
    landedPrice: Money.parse('28886.40'),
    priceLines: REGULAR_LINES,
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
    ...overrides,
  };
}

const OFFERS: SupplyPointOffer[] = [
  offer(),
  offer({
    supplyPointCode: 'B',
    city: 'Noida',
    landedPrice: Money.parse('27100.00'),
    valuationMethod: 'MARGIN',
    quality: qualityHeadline({
      unitsInspected: 3,
      avgQcScore: 100,
      gradeAccuracyPct: 100,
      minSampleForHeadline: 10,
    }),
    qcExpiresInDays: 9,
    unitsAvailable: 2,
  }),
];

const CAPTION =
  '2 supply points offering Dell Latitude 5320, sorted by landed price, lowest first. Prices include GST and freight to 110020.';

describe('OfferGrid — the anonymity contract', () => {
  it('leaks no part of a vendor identity into the rendered markup, at any depth', () => {
    const { container } = render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    // The same sweep the API's serialisation test runs, pointed at the DOM:
    // an attribute, a title, a key or a class would all be caught.
    expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
  });

  it('shows the supply point as a label and a city, and nothing finer', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(screen.getAllByText('Supply Point A · Gurugram').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Supply Point B · Noida').length).toBeGreaterThan(0);
  });

  it('refuses a supply-point code that is not the anonymised label', () => {
    expect(() =>
      assertSupplyPointOnly({ supplyPointCode: 'northwind-refurb', city: 'Gurugram' }),
    ).toThrow(/anonymised label/);
  });

  it('refuses a vendor legal name, GSTIN, phone or address smuggled in as a city', () => {
    for (const city of [
      VENDOR.legalName,
      VENDOR.gstin as string,
      VENDOR.phones![0] as string,
      VENDOR.addressLines![0] as string,
      VENDOR.emails![0] as string,
    ]) {
      expect(() => assertSupplyPointOnly({ supplyPointCode: 'A', city })).toThrow(/dispatch city/);
    }
  });

  it('does not echo the offending value in the error, which would leak it again', () => {
    try {
      assertSupplyPointOnly({ supplyPointCode: 'A', city: VENDOR.legalName });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('Northwind');
    }
  });

  it('has no field for a vendor identity or a reputation metric', () => {
    // Reads the type, not an instance: the guarantee is that there is nowhere to
    // put a vendor name, not that this fixture happens not to have one.
    const source = readFileSync(join(__dirname, 'commerce.tsx'), 'utf8');
    const shape = source.slice(
      source.indexOf('export interface SupplyPointOffer {'),
      source.indexOf('const CODE_PATTERN'),
    );
    const fields = shape.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const banned of [
      /vendor/i,
      /gstin/i,
      /\bpan\b/i,
      /orgId/i,
      /legalName/i,
      /address/i,
      /phone/i,
      /email/i,
      /rating/i,
      /tier/i,
      /\bstars?\b/i,
      /sellerSince/i,
      /responseTime/i,
      /askPrice/i,
      /purchasePrice/i,
      /margin/i,
    ]) {
      expect(fields).not.toMatch(banned);
    }
  });

  it('shows the total warranty as one number, never a split', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(screen.getAllByText('12 months').length).toBeGreaterThan(0);
    expect(screen.queryByText(/vendor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/platform-backed/i)).not.toBeInTheDocument();
  });
});

describe('OfferGrid — what the buyer is deciding on', () => {
  it('gives a supply point below the sample threshold words instead of a percentage', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    // 100% grade accuracy computed on three machines is our misrepresentation
    // under CP e-Comm r.7(2), not the supply point's.
    expect(screen.getAllByText('New supplier · 3 units inspected').length).toBeGreaterThan(0);
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('carries the denominator with the quality numbers it does show', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(screen.getAllByText('412 units').length).toBeGreaterThan(0);
  });

  it('labels the lowest landed price neutrally, and only that one', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    // One per rendering (table + card), and never worded as scarcity.
    expect(screen.getAllByText('Lowest landed')).toHaveLength(2);
  });

  it('flags an inspection expiring inside the 14-day window', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(screen.getAllByText('Expires in 9 days').length).toBeGreaterThan(0);
  });

  it('puts the whole break-up one click away, never part of it', async () => {
    render(<OfferGrid offers={[OFFERS[1] as SupplyPointOffer]} caption={CAPTION} />);
    const disclosures = screen.getAllByText('Price break-up');
    await userEvent.click(disclosures[0] as HTMLElement);
    expect(screen.getAllByText(/Rule 32\(5\)/).length).toBeGreaterThan(0);
  });

  it('reports the quantity the buyer chose', async () => {
    const onAdd = jest.fn();
    render(<OfferGrid offers={[offer()]} caption={CAPTION} onAdd={onAdd} />);
    const table = screen.getByRole('table');
    const qty = within(table).getByLabelText('Qty');
    await userEvent.clear(qty);
    await userEvent.type(qty, '3');
    await userEvent.click(
      within(table).getByRole('button', { name: 'Add Supply Point A · Gurugram to cart' }),
    );
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ supplyPointCode: 'A' }), 3);
  });

  it('never adds more units than are sellable', async () => {
    const onAdd = jest.fn();
    render(<OfferGrid offers={[offer({ unitsAvailable: 4 })]} caption={CAPTION} onAdd={onAdd} />);
    const table = screen.getByRole('table');
    const qty = within(table).getByLabelText('Qty');
    await userEvent.clear(qty);
    await userEvent.type(qty, '40');
    await userEvent.click(
      within(table).getByRole('button', { name: 'Add Supply Point A · Gurugram to cart' }),
    );
    expect(onAdd).toHaveBeenCalledWith(expect.anything(), 4);
  });

  it('offers no cart button for a supply point with nothing sellable', () => {
    render(<OfferGrid offers={[offer({ unitsAvailable: 0 })]} caption={CAPTION} onAdd={() => {}} />);
    expect(screen.queryByRole('button', { name: /Add .* to cart/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('No units available').length).toBeGreaterThan(0);
  });

  it('drops table semantics for the card rendering rather than faking them with roles', () => {
    const { container } = render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(container.querySelectorAll('[role="table"], [role="row"], [role="cell"]')).toHaveLength(
      0,
    );
    expect(container.querySelectorAll('article')).toHaveLength(2);
  });

  it('announces the count and the order, because a default sort is invisible otherwise', () => {
    render(<OfferGrid offers={OFFERS} caption={CAPTION} />);
    expect(screen.getByRole('status')).toHaveTextContent('sorted by landed price, lowest first');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <OfferGrid offers={OFFERS} caption={CAPTION} onAdd={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('OfferGrid — one primary action, not ten', () => {
  /**
   * The row used to hard-code variant="primary", so a board of ten supply points
   * painted ten amber buttons. CLAUDE.md allows one primary action per screen,
   * and 09_FRONTEND_LOCKED says why it matters: amber means a primary action, a
   * measured value or an active state, and "the moment it becomes a decorative
   * wash, the QC score chip stops meaning anything". Ten amber buttons beside
   * ten amber QC scores is that wash — and it tells the buyer nothing, because
   * every row shouts equally.
   *
   * Asserted as what a person sees — how many amber buttons are on screen —
   * rather than that a prop exists.
   */
  it('gives the amber to exactly one row however many supply points there are', () => {
    // Scoped to the table. OfferGrid renders BOTH a table and a card list and
    // hides one with display:none per viewport — jsdom applies no CSS, so an
    // unscoped query sees every row twice and "one primary" would read as two.
    const { container } = render(
      <OfferGrid offers={OFFERS} caption={CAPTION} onAdd={() => {}} />,
    );
    const table = container.querySelector('table')!;
    const adds = within(table).getAllByRole('button', { name: /Add .* to cart/ });
    expect(adds.length).toBeGreaterThan(1);
    expect(adds.filter((b) => b.className.includes('bg-acc'))).toHaveLength(1);
  });
});
