import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { LEGAL_DISCLOSURE } from '@trugrade/config';
import { pincodeSchema, type Grade, type QualityHeadline } from '@trugrade/contracts';
import { z } from 'zod';
import { Public } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import type { BoardOffer, OfferBoard } from './internal/offer-board.service';
import { OfferBoardService } from './internal/offer-board.service';

/**
 * The supply-point comparison board, for one SKU (PHASE_05 Task 4).
 *
 * **This is not `GET /public/offers`.** That one is the homepage grid: one row
 * per (SKU, grade), a price RANGE and a COUNT of supply points, aggregated
 * precisely so it cannot name a source. This is the screen where the buyer picks
 * between the sources, so each one gets a row — which makes the anonymity
 * boundary this file's whole job rather than a property it inherits.
 *
 * **Every field below is written out by hand.** Never `return offer`: the shapes
 * this assembles from carry a listing's gst rate, a pickup address id and a
 * freight lane, and the units behind them sit in a view that also holds
 * `vendor_org_id`, `vendor_ask_price` and `purchase_price`. A `@Exclude()`
 * blacklist fails open the day someone adds a column; an allow-list fails
 * closed, and `offer-board.spec.ts` sweeps the serialised JSON for the seeded
 * vendor's identity at any depth to prove it.
 *
 * `Money` serialises through `toJSON()` as a decimal string, deliberately. A
 * price that crosses a network as a float is a price that comes back wrong.
 */

const boardQuerySchema = z.object({
  /**
   * Optional, because a buyer arrives without having typed one — but nothing is
   * priced until it is given. The landed price is our price + GST + freight to a
   * real destination, so a board that quoted a "from" price here and revealed
   * the freight at checkout would be drip pricing, which the CCPA Dark Patterns
   * Guidelines 2023 name outright. No pincode, no prices, and the screen says
   * which of those two it is.
   */
  pincode: pincodeSchema.optional(),
  grade: z.enum(['A_PLUS', 'A', 'B']).optional(),
});

type BoardQueryDto = z.infer<typeof boardQuerySchema>;

/* ==========================================================================
 * The response — the allow-list
 * ======================================================================== */

interface PublicMoneyLine {
  label: string;
  amount: string;
}

interface PublicOfferRow {
  listingId: string;
  supplyPointCode: string;
  city: string;
  label: string;
  grade: Grade;
  landedPrice: string;
  priceLines: PublicMoneyLine[];
  isInterState: boolean;
  valuationMethod: 'REGULAR' | 'MARGIN';
  quality: QualityHeadline;
  batteryHealthPct: { min: number; max: number } | null;
  batteryMeasured: number;
  totalWarrantyMonths: number;
  unitsAvailable: number;
  inspectedOn: string | null;
  qcExpiresOn: string | null;
  qcExpiresInDays: number | null;
  dispatchCommitment: string;
  units: Array<{
    serialNumber: string;
    qcScore: number | null;
    batteryHealthPct: number | null;
    inspectedOn: string | null;
    expiresOn: string | null;
    expiresInDays: number | null;
    valuationMethod: 'REGULAR' | 'MARGIN';
  }>;
}

interface PublicBoard {
  skuId: string;
  grade: Grade;
  grades: Array<{ grade: Grade; unitsAvailable: number; supplyPoints: number; fromPrice: string }>;
  pincode: string | null;
  /**
   * Three arms, not two. "Nobody has told us where to deliver" and "we cannot
   * deliver there" are different statements, and a screen that renders the
   * first as the second tells a buyer in Bengaluru that we refuse them when in
   * fact they have not typed anything yet.
   */
  delivery:
    | { kind: 'NONE' }
    | { kind: 'DELIVERABLE'; etaDays: number }
    | { kind: 'UNSERVICEABLE'; reason: string };
  offers: PublicOfferRow[];
  unitsAvailable: number;
  supplyPoints: number;
  unpricedSupplyPoints: number;
}

@Controller('public')
export class ListingPublicController {
  constructor(private readonly board: OfferBoardService) {}

  /**
   * `GET /api/public/skus/:skuId/offers?pincode=110001&grade=A`
   *
   * Fifteen seconds of cache. Stock moves and a stale board offers machines that
   * are gone; the pincode and grade are in the URL, so two buyers with different
   * destinations never share an entry.
   */
  @Get('skus/:skuId/offers')
  @Public()
  @Header('Cache-Control', 'public, max-age=15')
  async offers(
    @Param('skuId', new ZodValidationPipe(z.string().uuid())) skuId: string,
    @Query(new ZodValidationPipe(boardQuerySchema)) query: BoardQueryDto,
  ): Promise<PublicBoard> {
    const board = await this.board.board({
      skuId,
      grade: query.grade as Grade | undefined,
      pincode: query.pincode,
      ourStateCode: OUR_STATE_CODE,
      deliveryStateCode: query.pincode ? placeOfSupply(query.pincode) : INTER_STATE,
    });
    return present(board);
  }
}

/* ==========================================================================
 * Place of supply
 * ======================================================================== */

/** Where we are registered. s.10(1)(a) makes the buyer's delivery the other half. */
const OUR_STATE_CODE = LEGAL_DISCLOSURE.registeredOffice.stateCode;

/**
 * The split turns on exactly one fact: is the delivery address in OUR state?
 *
 * Haryana's PIN range is 121001–136999 and no other state's begins 12 or 13, so
 * the first two digits settle it with certainty — and every other prefix is
 * inter-state whatever state it actually is. That is why the fallback below is
 * safe rather than a guess: an unrecognised prefix is provably not ours, and
 * `INTER_STATE` is a sentinel that only ever has to be unequal to `06`. It is
 * never rendered and never returned; `stateTaxLabel` only reads the code on the
 * intra-state branch, where it is Haryana by construction.
 *
 * A real pincode→state table belongs in `@trugrade/contracts` beside the GST
 * state codes (T5 and T6 both reported it missing). Until it exists, this map
 * covers the prefixes our serviceability rows actually contain, which is the
 * only set that can reach a priced row.
 */
const INTER_STATE = 'ZZ';

const STATE_BY_PIN_PREFIX: Readonly<Record<string, string>> = {
  '11': '07', // Delhi
  '12': '06', // Haryana
  '13': '06', // Haryana
  '20': '09', // Uttar Pradesh — Noida, Ghaziabad
  '21': '09',
  '25': '09', // Uttar Pradesh — Meerut
};

function placeOfSupply(pincode: string): string {
  return STATE_BY_PIN_PREFIX[pincode.slice(0, 2)] ?? INTER_STATE;
}

/* ==========================================================================
 * Presentation — one field at a time, on purpose
 * ======================================================================== */

function present(board: OfferBoard): PublicBoard {
  return {
    skuId: board.skuId,
    grade: board.grade,
    grades: board.grades.map((g) => ({
      grade: g.grade,
      unitsAvailable: g.unitsAvailable,
      supplyPoints: g.supplyPoints,
      fromPrice: g.fromPrice.toString(),
    })),
    pincode: board.pincode,
    delivery:
      board.delivery.kind === 'DELIVERABLE'
        ? { kind: 'DELIVERABLE', etaDays: board.delivery.etaDays }
        : board.delivery.kind === 'UNSERVICEABLE'
          ? { kind: 'UNSERVICEABLE', reason: board.delivery.reason }
          : { kind: 'NONE' },
    offers: board.offers.map(presentOffer),
    unitsAvailable: board.unitsAvailable,
    supplyPoints: board.supplyPoints,
    unpricedSupplyPoints: board.unpricedSupplyPoints,
  };
}

function presentOffer(offer: BoardOffer): PublicOfferRow {
  const { landed } = offer;

  // The whole break-up, always, in one answer. `PriceBreakup` in `packages/ui`
  // sums the lines itself and has no `total` prop, so the figure above it and
  // the lines under it cannot disagree — which is why the total is not sent.
  const priceLines: PublicMoneyLine[] = [
    { label: 'Unit price', amount: landed.sellingPrice.toString() },
  ];
  if (!landed.freight.isZero()) {
    priceLines.push({ label: 'Freight', amount: landed.freight.toString() });
  }
  if (landed.isInterState) {
    priceLines.push({ label: 'IGST', amount: landed.igst.toString() });
  } else {
    priceLines.push({ label: 'CGST', amount: landed.cgst.toString() });
    priceLines.push({ label: 'SGST', amount: landed.sgst.toString() });
  }

  return {
    listingId: offer.listingId,
    supplyPointCode: offer.supplyPointCode,
    city: offer.city,
    label: offer.label,
    grade: offer.grade,
    landedPrice: landed.total.toString(),
    priceLines,
    isInterState: landed.isInterState,
    valuationMethod: offer.valuationMethod,
    // Already a discriminated union with the small-sample decision made in `qc`.
    // There is no percentage in the NEW_SUPPLIER arm to leak through here.
    quality: offer.quality,
    batteryHealthPct: offer.batteryHealthPct,
    batteryMeasured: offer.batteryMeasured,
    // The TOTAL only. There is no field here for the vendor's share or ours, and
    // there must never be one (PHASE_05 exit criteria).
    totalWarrantyMonths: offer.totalWarrantyMonths,
    unitsAvailable: offer.unitsAvailable,
    inspectedOn: offer.inspectedOn,
    qcExpiresOn: offer.qcExpiresOn,
    qcExpiresInDays: offer.qcExpiresInDays,
    dispatchCommitment: offer.dispatchCommitment,
    units: offer.units.map((u) => ({
      serialNumber: u.serialNumber,
      qcScore: u.qcScore,
      batteryHealthPct: u.batteryHealthPct,
      inspectedOn: u.inspectedOn,
      expiresOn: u.expiresOn,
      expiresInDays: u.expiresInDays,
      valuationMethod: u.valuationMethod,
    })),
  };
}
