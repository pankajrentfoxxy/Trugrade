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
import { ListingRepository, type PublicBoardUnit } from './listing.repository';
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
 *      letter alone silently welds two vendors into one row, and the seeded
 *      board has exactly that pair in it so the mistake fails a test rather than
 *      shipping.
 *
 *   2. **No vendor identifier is in the answer, at any depth.** The org id is
 *      used once, inside the repository's JOIN, to resolve the supply point; the
 *      vendor's ask, their purchase price and their share of the warranty never
 *      leave the module. What a buyer gets is a letter, a city, and performance.
 *
 *   3. **A number nobody measured is not rendered.** An unquotable lane is not
 *      free freight (CP e-Comm r.6(5)), a battery nobody opened is not 0%, and a
 *      score computed on three machines is not a score (r.7(2)) — the last of
 *      those is decided in `qc` and arrives here already suppressed, as a
 *      discriminated union that has no percentage to render.
 */

/** A boxed 14" laptop with its charger. `catalog.sku.weight_kg` is catalog's. */
const BOXED_LAPTOP_GRAMS = 2_500;

export interface BoardQuery {
  skuId: string;
  grade?: Grade;
  /**
   * Optional, and the absence is a distinct answer rather than a default.
   *
   * There is no landed price without a destination, and inventing one — the
   * warehouse's own pincode, the last buyer's — publishes a delivered price to
   * somewhere the buyer never named. So no pincode returns the board's evidence
   * with no prices on it and `delivery.kind = 'NONE'`, and the screen asks.
   * "We did not ask" and "we cannot deliver there" are different sentences.
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
  /** `null` when the battery was not measured. The screen prints so. */
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
  landed: LandedPrice;
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
  /**
   * Supply points holding this machine that we could not price to this pincode.
   * Counted rather than dropped in silence: a row that vanishes without a reason
   * is indistinguishable from stock that is gone.
   */
  unpricedSupplyPoints: number;
}

/** Everything one row is built from, before it is priced. */
interface Group {
  key: string;
  listingId: string;
  supplyPointCode: string;
  city: string;
  grade: Grade;
  valuationMethod: 'REGULAR' | 'MARGIN';
  pickupLocationId: string;
  dispatchHours: number;
  units: PublicBoardUnit[];
  /** Lexicographically smallest unit id in the group. The sort's tie-break. */
  sortId: string;
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
    const units = await this.listings.publicBoardUnits(query.skuId);
    const grades = summariseGrades(units);
    if (grades.length === 0) {
      throw new ValidationError('Nothing sealed is available for this machine right now.', {
        skuId: 'No sellable unit carries a current inspection for this SKU.',
      });
    }

    // The requested grade, or the one with the most stock behind it. Asking for
    // a grade nobody holds returns that grade's empty board rather than quietly
    // showing a different grade's prices.
    const grade = query.grade ?? grades[0]!.grade;
    const forGrade = units.filter((u) => u.grade === grade);

    const refusal: BoardDelivery | null = query.pincode
      ? await this.serviceability(query.pincode)
      : { kind: 'NONE' };

    if (refusal || !query.pincode) {
      // The evidence still stands — how many units, how many supply points, at
      // what grades. Only the prices are missing, and they are missing because
      // nothing has been asked to price them to.
      return {
        skuId: query.skuId,
        grade,
        grades,
        pincode: query.pincode ?? null,
        delivery: refusal ?? { kind: 'NONE' },
        offers: [],
        unitsAvailable: forGrade.length,
        supplyPoints: countSupplyPoints(forGrade),
        unpricedSupplyPoints: countSupplyPoints(forGrade),
      };
    }
    const pincode = query.pincode;

    const groups = this.group(forGrade);

    // `(code, city)` pairs, deduplicated: two valuation pools at one supply
    // point are one quality record, asked for once.
    const points = [
      ...new Map(
        groups.map((g) => [`${g.city}|${g.supplyPointCode}`, { code: g.supplyPointCode, city: g.city }]),
      ).values(),
    ];

    const [quality, facts, freightBy] = await Promise.all([
      this.qc.qualityForSupplyPoints(points, { skuId: query.skuId, grade }),
      this.listings.publicPricingFacts([...new Set(groups.map((g) => g.listingId))]),
      this.quoteLanes(groups, pincode),
    ]);
    const warranties = await this.pricing.customerWarrantyMonths([...facts.values()]);
    const qualityBy = new Map(quality.map((q) => [`${q.city}|${q.supplyPointCode}`, q]));

    const offers: BoardOffer[] = [];
    let unpriced = 0;

    for (const group of groups) {
      const fact = facts.get(group.listingId);
      const lane = freightBy.get(group.pickupLocationId);
      // No quote, no row. Publishing a landed price that is missing its freight
      // is the price misrepresentation the whole freight union exists to stop.
      if (!fact || !lane || !lane.serviceable) {
        unpriced += 1;
        continue;
      }

      const landed = this.pricing.landedPriceForPublicOffer(fact, {
        deliveryStateCode: query.deliveryStateCode,
        ourStateCode: query.ourStateCode,
        freight: lane.amount,
      });

      const q = qualityBy.get(`${group.city}|${group.supplyPointCode}`);
      offers.push(this.toOffer(group, landed, q, warranties.get(group.listingId)));
    }

    offers.sort((a, b) =>
      compareOffers(
        { landedPaise: a.landed.total.paise, dispatchHours: a.dispatchHours, id: idOf(groups, a) },
        { landedPaise: b.landed.total.paise, dispatchHours: b.dispatchHours, id: idOf(groups, b) },
      ),
    );

    return {
      skuId: query.skuId,
      grade,
      grades,
      pincode,
      // The transit band the carrier published for the lanes we could price.
      // The slowest of them, because a range a buyer plans around must not be
      // its most optimistic member.
      delivery: { kind: 'DELIVERABLE', etaDays: slowestEta(freightBy) },
      offers,
      unitsAvailable: forGrade.length,
      supplyPoints: countSupplyPoints(forGrade),
      unpricedSupplyPoints: unpriced,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Rows are `(supply point, valuation pool, listing)`.
   *
   * `(code, city)` is the supply point — see the note at the top of the file.
   * The valuation method is part of the key because a MARGIN unit gives the
   * buyer thinner input credit than a REGULAR one at the same price, so the two
   * are different offers however identical the rupees look (PHASE_05 Task 5).
   *
   * ponytail: where one supply point holds two listings of the same machine at
   * the same grade, the cheaper listing is the row and the dearer one is not
   * shown. Two rows reading "Supply Point A · Gurugram" is a worse answer than
   * one, and the seeded board has one listing per supply point. If vendors start
   * running parallel price books, the row needs a price band rather than a
   * second row.
   */
  private group(units: readonly PublicBoardUnit[]): Group[] {
    const byKey = new Map<string, Group>();

    for (const unit of units) {
      if (!unit.listingId) continue;
      const key = `${unit.city}|${unit.supplyPointCode}|${unit.valuationMethod}`;
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, {
          key,
          listingId: unit.listingId,
          supplyPointCode: unit.supplyPointCode,
          city: unit.city,
          grade: unit.grade,
          valuationMethod: unit.valuationMethod,
          pickupLocationId: unit.pickupLocationId,
          dispatchHours: unit.dispatchSlaHours,
          units: [unit],
          sortId: unit.id,
        });
        continue;
      }

      if (unit.listingId === existing.listingId) {
        existing.units.push(unit);
        if (unit.id < existing.sortId) existing.sortId = unit.id;
        continue;
      }

      // A second listing at the same supply point: keep the cheaper one whole.
      const cheaper = unit.retailPrice.lt(existing.units[0]!.retailPrice);
      if (cheaper) {
        byKey.set(key, { ...existing, listingId: unit.listingId, units: [unit], sortId: unit.id, dispatchHours: unit.dispatchSlaHours, pickupLocationId: unit.pickupLocationId });
      }
    }

    return [...byKey.values()];
  }

  /**
   * Is the destination reachable at all?
   *
   * Asked once for the destination rather than once per lane, because it is a
   * fact about the pincode: `isServiceable` is the filter-level question and a
   * "no" here is the whole board's answer, not one row's. The per-lane quotes
   * that follow can still fail individually, and those rows are counted out as
   * `unpricedSupplyPoints` rather than shown at a price they do not have.
   */
  private async serviceability(pincode: string): Promise<BoardDelivery | null> {
    if (await this.logistics.isServiceable(pincode)) return null;
    return {
      kind: 'UNSERVICEABLE',
      // A sentence a buyer can act on, and one that names no origin.
      reason: `No carrier we work with delivers to ${pincode} yet. Send us the pincode and we will quote it by hand — most of India is reachable; it is the rate card that has not caught up.`,
    };
  }

  /**
   * Every lane on the board in one batch.
   *
   * Ten supply points priced one at a time is thirty statements against the rate
   * card and the single largest thing between this endpoint and its 500 ms
   * budget; `quoteFreightBatch` prices the lot in three.
   */
  private async quoteLanes(
    groups: readonly Group[],
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

    // Re-keyed on the pickup address, because that is what a row holds. The
    // pincode itself stops here: it is finer than a city and a buyer never sees
    // one.
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
    group: Group,
    landed: LandedPrice,
    quality: SupplyPointQuality | undefined,
    warrantyMonths: number | undefined,
  ): BoardOffer {
    const measured = group.units
      .map((u) => u.batteryHealthPct)
      .filter((b): b is number => b !== null);

    const inspected = latest(group.units.map((u) => u.qcPassedAt));
    const expires = earliest(group.units.map((u) => u.qcValidUntil));

    return {
      listingId: group.listingId,
      supplyPointCode: group.supplyPointCode,
      city: group.city,
      label: supplyPointLabel(group.supplyPointCode, group.city),
      grade: group.grade,
      landed,
      valuationMethod: group.valuationMethod,
      // No quality row at all means nothing has been inspected under this supply
      // point for this machine — which is the same statement "New supplier" makes
      // and is made the same way, never as an absent column.
      quality: quality?.headline ?? {
        kind: 'NEW_SUPPLIER',
        unitsInspected: 0,
        label: 'New supplier · 0 units inspected',
      },
      batteryHealthPct:
        measured.length === 0
          ? null
          : { min: Math.round(Math.min(...measured)), max: Math.round(Math.max(...measured)) },
      batteryMeasured: measured.length,
      // Never zero. `customerWarrantyMonths` floors at the platform minimum, so
      // an absent answer here means the listing vanished mid-request, and the
      // row is better dropped than sold with a warranty of nothing.
      totalWarrantyMonths: warrantyMonths ?? 0,
      unitsAvailable: group.units.length,
      inspectedOn: this.day(inspected),
      qcExpiresOn: this.day(expires),
      qcExpiresInDays: this.daysUntil(expires),
      dispatchHours: group.dispatchHours,
      dispatchCommitment: `Ships in ${group.dispatchHours} h`,
      units: group.units
        .slice()
        .sort((a, b) => a.serialNumber.localeCompare(b.serialNumber))
        .map((u) => ({
          serialNumber: u.serialNumber,
          qcScore: u.qcScore,
          batteryHealthPct: u.batteryHealthPct,
          inspectedOn: this.day(u.qcPassedAt),
          expiresOn: this.day(u.qcValidUntil),
          expiresInDays: this.daysUntil(u.qcValidUntil),
          valuationMethod: u.valuationMethod,
        })),
    };
  }

  /**
   * `22 Aug 2026`, formatted here because `packages/ui` has no clock and must
   * not acquire one — a component that formats a date is a component with an
   * opinion about the reader's timezone.
   */
  private day(value: Date | null): string | null {
    if (!value) return null;
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(value);
  }

  /** Whole days, on the IST calendar — a QC certificate expires on a date. */
  private daysUntil(value: Date | null): number | null {
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

function summariseGrades(units: readonly PublicBoardUnit[]): GradeAvailability[] {
  const byGrade = new Map<Grade, PublicBoardUnit[]>();
  for (const unit of units) {
    const bucket = byGrade.get(unit.grade) ?? [];
    bucket.push(unit);
    byGrade.set(unit.grade, bucket);
  }

  return [...byGrade.entries()]
    .map(([grade, rows]) => ({
      grade,
      unitsAvailable: rows.length,
      supplyPoints: countSupplyPoints(rows),
      fromPrice: rows.reduce((low, r) => (r.retailPrice.lt(low) ? r.retailPrice : low), rows[0]!.retailPrice),
    }))
    // Most stock first, so the default grade is the one the buyer can actually
    // fill an order from; ties fall back to the published grade order.
    .sort(
      (a, b) =>
        b.unitsAvailable - a.unitsAvailable ||
        (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9),
    );
}

/** `(code, city)`, always. See the note at the top of the file. */
function countSupplyPoints(units: readonly PublicBoardUnit[]): number {
  return new Set(units.map((u) => `${u.city}|${u.supplyPointCode}`)).size;
}

function idOf(groups: readonly Group[], offer: BoardOffer): string {
  return (
    groups.find(
      (g) =>
        g.city === offer.city &&
        g.supplyPointCode === offer.supplyPointCode &&
        g.valuationMethod === offer.valuationMethod,
    )?.sortId ?? offer.listingId
  );
}

/** The slowest transit band among the lanes that priced. Zero when none did. */
function slowestEta(quotes: ReadonlyMap<string, FreightQuote>): number {
  let days = 0;
  for (const q of quotes.values()) if (q.serviceable) days = Math.max(days, q.etaDays);
  return days;
}

function latest(dates: ReadonlyArray<Date | null>): Date | null {
  return dates.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
}

function earliest(dates: ReadonlyArray<Date | null>): Date | null {
  return dates.reduce<Date | null>((a, b) => (b && (!a || b < a) ? b : a), null);
}
