import { Injectable } from '@nestjs/common';
import {
  Money,
  compareOffers,
  supplyPointLabel,
  type Grade,
  type LandedPrice,
  type QualityHeadline,
} from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { ValidationError } from '../../../shared/errors/domain-errors';
import { LogisticsService, type FreightQuote } from '../../logistics';
import { QcService, type SupplyPointQuality } from '../../qc';
import { ListingRepository, type PublicBoardOffer } from './listing.repository';
import { PricingService } from './pricing.service';

/**
 * The supply-point comparison board: one SKU, one grade, every supply point
 * holding it, ranked on landed price (PHASE_05 Task 4).
 *
 * Three properties this file exists to hold, none of which is arithmetic:
 *
 *   1. **The board groups on `(code, city)`, never on `code`.**
 *      `listing.supply_point` is unique on `(vendor_org_id, city)` and on
 *      `(city, code)`, and the letter is assigned per city at random — so "F" is
 *      one vendor in Noida and a different one in Faridabad. Keying on the
 *      letter alone silently welds two vendors into one row.
 *
 *   2. **No vendor identifier is in the answer, at any depth.** The org id is
 *      used once, inside the repository, to resolve the supply point; the
 *      vendor's ask and their share of the warranty never leave the module. What
 *      a buyer gets is a letter, a city, and performance.
 *
 *   3. **A number nobody measured is not rendered.** Under the order-first flow
 *      a listing is a declared quantity with no inspected machines behind it
 *      until a buyer orders, so the per-row battery range, inspection date and
 *      serial list are honestly empty: `null`, zero measured, no units. What a
 *      supply point has earned across its past inspections still arrives from
 *      `qc` as a headline, already suppressed below the small-sample floor.
 */

/** A boxed 14" laptop with its charger. `catalog.sku.weight_kg` is catalog's. */
const BOXED_LAPTOP_GRAMS = 2_500;

export interface BoardQuery {
  skuId: string;
  grade?: Grade;
  /**
   * Optional, and the absence is a distinct answer rather than a default.
   * There is no landed price without a destination, so no pincode returns the
   * board's evidence with no prices on it and `delivery.kind = 'NONE'`.
   */
  pincode?: string;
  /** Our place of supply, from `@trugrade/config`. Not this module's to know. */
  ourStateCode: string;
  deliveryStateCode: string;
}

export interface GradeAvailability {
  grade: Grade;
  unitsAvailable: number;
  supplyPoints: number;
  /** Lowest selling price at this grade, before freight and GST. */
  fromPrice: Money;
}

export interface BoardUnit {
  serialNumber: string;
  qcScore: number | null;
  batteryHealthPct: number | null;
  inspectedOn: string | null;
  expiresOn: string | null;
  expiresInDays: number | null;
  valuationMethod: 'REGULAR' | 'MARGIN';
}

export interface BoardOffer {
  /** What the cart adds. Not a vendor identifier: one listing is one SKU+grade. */
  listingId: string;
  supplyPointCode: string;
  city: string;
  label: string;
  grade: Grade;
  /** Our selling price for one machine, before GST and freight. Always present. */
  unitPrice: Money;
  /** Null when no pincode was given: the row's evidence without its landed price. */
  landed: LandedPrice | null;
  valuationMethod: 'REGULAR' | 'MARGIN';
  quality: QualityHeadline;
  batteryHealthPct: { min: number; max: number } | null;
  /** The denominator on the battery range: how many of the units were measured. */
  batteryMeasured: number;
  totalWarrantyMonths: number;
  unitsAvailable: number;
  inspectedOn: string | null;
  qcExpiresOn: string | null;
  qcExpiresInDays: number | null;
  dispatchHours: number;
  dispatchCommitment: string;
  /**
   * Machines already identified. Empty for a declared listing: the serials are
   * named by the technician after the order, and the screen says so.
   */
  units: BoardUnit[];
}

export type BoardDelivery =
  | { kind: 'NONE' }
  | { kind: 'DELIVERABLE'; etaDays: number }
  | { kind: 'UNSERVICEABLE'; reason: string };

export interface OfferBoard {
  skuId: string;
  grade: Grade;
  grades: GradeAvailability[];
  pincode: string | null;
  delivery: BoardDelivery;
  offers: BoardOffer[];
  unitsAvailable: number;
  supplyPoints: number;
  /** Supply points holding this machine that we could not price to this pincode. */
  unpricedSupplyPoints: number;
}

@Injectable()
export class OfferBoardService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly pricing: PricingService,
    private readonly qc: QcService,
    private readonly logistics: LogisticsService,
    private readonly clock: ClockPort,
  ) {}

  async board(query: BoardQuery): Promise<OfferBoard> {
    const all = await this.listings.publicBoardOffers(query.skuId);
    const grades = summariseGrades(all);
    if (grades.length === 0) {
      throw new ValidationError('Nothing is on sale for this machine right now.', {
        skuId: 'No live listing holds stock for this SKU.',
      });
    }

    // The requested grade, or the one with the most stock behind it. Asking for
    // a grade nobody holds returns that grade's empty board rather than quietly
    // showing a different grade's prices.
    const grade = query.grade ?? grades[0]!.grade;
    const forGrade = all.filter((o) => o.grade === grade);

    const refusal: BoardDelivery | null = query.pincode
      ? await this.serviceability(query.pincode)
      : null;

    if (refusal) {
      return {
        skuId: query.skuId,
        grade,
        grades,
        pincode: query.pincode ?? null,
        delivery: refusal,
        offers: [],
        unitsAvailable: countUnits(forGrade),
        supplyPoints: countSupplyPoints(forGrade),
        unpricedSupplyPoints: countSupplyPoints(forGrade),
      };
    }
    const pincode = query.pincode ?? null;

    const groups = this.group(forGrade);

    const points = [
      ...new Map(
        groups.map((g) => [`${g.city}|${g.supplyPointCode}`, { code: g.supplyPointCode, city: g.city }]),
      ).values(),
    ];

    const [quality, facts, freightBy] = await Promise.all([
      this.qc.qualityForSupplyPoints(points, { skuId: query.skuId, grade }),
      this.listings.publicPricingFacts([...new Set(groups.map((g) => g.listingId))]),
      pincode === null
        ? Promise.resolve(new Map<string, FreightQuote>())
        : this.quoteLanes(groups, pincode),
    ]);
    const warranties = await this.pricing.customerWarrantyMonths([...facts.values()]);
    const qualityBy = new Map(quality.map((q) => [`${q.city}|${q.supplyPointCode}`, q]));

    const offers: BoardOffer[] = [];
    let unpriced = 0;

    for (const group of groups) {
      const fact = facts.get(group.listingId);
      if (!fact) {
        unpriced += 1;
        continue;
      }
      const q = qualityBy.get(`${group.city}|${group.supplyPointCode}`);

      if (pincode === null) {
        unpriced += 1;
        offers.push(this.toOffer(group, fact.sellingPrice, null, q, warranties.get(group.listingId)));
        continue;
      }

      const lane = freightBy.get(group.pickupLocationId);
      if (!lane || !lane.serviceable) {
        unpriced += 1;
        continue;
      }

      const landed = this.pricing.landedPriceForPublicOffer(fact, {
        deliveryStateCode: query.deliveryStateCode,
        ourStateCode: query.ourStateCode,
        freight: lane.amount,
      });

      offers.push(this.toOffer(group, fact.sellingPrice, landed, q, warranties.get(group.listingId)));
    }

    offers.sort((a, b) =>
      compareOffers(
        { landedPaise: (a.landed?.total ?? a.unitPrice).paise, dispatchHours: a.dispatchHours, id: a.listingId },
        { landedPaise: (b.landed?.total ?? b.unitPrice).paise, dispatchHours: b.dispatchHours, id: b.listingId },
      ),
    );

    return {
      skuId: query.skuId,
      grade,
      grades,
      pincode,
      delivery:
        pincode === null ? { kind: 'NONE' } : { kind: 'DELIVERABLE', etaDays: slowestEta(freightBy) },
      offers,
      unitsAvailable: countUnits(forGrade),
      supplyPoints: countSupplyPoints(forGrade),
      unpricedSupplyPoints: unpriced,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Rows are `(supply point, valuation pool)`; one listing per row.
   *
   * Where one supply point holds two listings of the same machine at the same
   * grade, the cheaper listing is the row and the dearer one is not shown. Two
   * rows reading "Supply Point A · Gurugram" is a worse answer than one.
   */
  private group(offers: readonly PublicBoardOffer[]): PublicBoardOffer[] {
    const byKey = new Map<string, PublicBoardOffer>();
    for (const offer of offers) {
      const key = `${offer.city}|${offer.supplyPointCode}|${offer.valuationMethod}`;
      const existing = byKey.get(key);
      if (!existing || offer.sellingPrice.lt(existing.sellingPrice)) byKey.set(key, offer);
    }
    return [...byKey.values()];
  }

  private async serviceability(pincode: string): Promise<BoardDelivery | null> {
    if (await this.logistics.isServiceable(pincode)) return null;
    return {
      kind: 'UNSERVICEABLE',
      reason: `No carrier we work with delivers to ${pincode} yet. Send us the pincode and we will quote it by hand — most of India is reachable; it is the rate card that has not caught up.`,
    };
  }

  /** Every lane on the board in one batch. */
  private async quoteLanes(
    groups: readonly PublicBoardOffer[],
    toPincode: string,
  ): Promise<Map<string, FreightQuote>> {
    const pickupIds = [...new Set(groups.map((g) => g.pickupLocationId))];
    const pincodes = await this.listings.pickupPincodes(pickupIds);

    const requests = pickupIds.flatMap((id) => {
      const from = pincodes.get(id);
      return from
        ? [{ fromPincode: from, toPincode, weightGrams: BOXED_LAPTOP_GRAMS, units: 1 }]
        : [];
    });
    const quotes = await this.logistics.quoteFreightBatch(requests);

    const out = new Map<string, FreightQuote>();
    for (const id of pickupIds) {
      const from = pincodes.get(id);
      if (!from) continue;
      const quote = quotes.get(`${from}:${toPincode}:${BOXED_LAPTOP_GRAMS}:1`);
      if (quote) out.set(id, quote);
    }
    return out;
  }

  private toOffer(
    group: PublicBoardOffer,
    unitPrice: Money,
    landed: LandedPrice | null,
    quality: SupplyPointQuality | undefined,
    warrantyMonths: number | undefined,
  ): BoardOffer {
    return {
      listingId: group.listingId,
      supplyPointCode: group.supplyPointCode,
      city: group.city,
      label: supplyPointLabel(group.supplyPointCode, group.city),
      grade: group.grade,
      unitPrice,
      landed,
      valuationMethod: group.valuationMethod,
      // No quality row at all means nothing has been inspected under this supply
      // point for this machine — which is the same statement "New supplier" makes.
      quality: quality?.headline ?? {
        kind: 'NEW_SUPPLIER',
        unitsInspected: 0,
        label: 'New supplier · 0 units inspected',
      },
      // Nothing behind a declared listing has been opened yet. Null, and zero
      // measured, so the screen prints "Not measured" rather than a range.
      batteryHealthPct: null,
      batteryMeasured: 0,
      totalWarrantyMonths: warrantyMonths ?? 0,
      unitsAvailable: group.qtyAvailable,
      inspectedOn: null,
      qcExpiresOn: null,
      qcExpiresInDays: null,
      dispatchHours: group.dispatchSlaHours,
      dispatchCommitment: `Ships in ${group.dispatchSlaHours} h`,
      units: [],
    };
  }

  /** Kept for the day a row carries an inspected date again. */
  protected day(value: Date | null): string | null {
    if (!value) return null;
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(value);
  }

  protected daysUntil(value: Date | null): number | null {
    if (!value) return null;
    const today = Date.parse(`${this.clock.todayInIst()}T00:00:00+05:30`);
    const then = Date.parse(`${value.toISOString().slice(0, 10)}T00:00:00+05:30`);
    return Math.round((then - today) / 86_400_000);
  }
}

/* ==========================================================================
 * Pure helpers
 * ======================================================================== */

const GRADE_ORDER: Record<string, number> = { A_PLUS: 0, A: 1, B: 2 };

function summariseGrades(offers: readonly PublicBoardOffer[]): GradeAvailability[] {
  const byGrade = new Map<Grade, PublicBoardOffer[]>();
  for (const offer of offers) {
    const bucket = byGrade.get(offer.grade) ?? [];
    bucket.push(offer);
    byGrade.set(offer.grade, bucket);
  }

  return [...byGrade.entries()]
    .map(([grade, rows]) => ({
      grade,
      unitsAvailable: countUnits(rows),
      supplyPoints: countSupplyPoints(rows),
      fromPrice: rows.reduce(
        (low, r) => (r.sellingPrice.lt(low) ? r.sellingPrice : low),
        rows[0]!.sellingPrice,
      ),
    }))
    // Most stock first, so the default grade is the one the buyer can actually
    // fill an order from; ties fall back to the published grade order.
    .sort(
      (a, b) =>
        b.unitsAvailable - a.unitsAvailable ||
        (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9),
    );
}

function countUnits(offers: readonly PublicBoardOffer[]): number {
  return offers.reduce((n, o) => n + o.qtyAvailable, 0);
}

/** `(code, city)`, always. See the note at the top of the file. */
function countSupplyPoints(offers: readonly PublicBoardOffer[]): number {
  return new Set(offers.map((o) => `${o.city}|${o.supplyPointCode}`)).size;
}

/** The slowest transit band among the lanes that priced. Zero when none did. */
function slowestEta(quotes: ReadonlyMap<string, FreightQuote>): number {
  let days = 0;
  for (const q of quotes.values()) if (q.serviceable) days = Math.max(days, q.etaDays);
  return days;
}
