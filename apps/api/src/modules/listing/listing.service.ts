import { Injectable } from '@nestjs/common';
import { LISTING_QTY, Money, moneyFromDb, type Grade, type SerialBatch } from '@trugrade/contracts';
import { PrismaService } from '../../shared/db/prisma.service';
import {
  IllegalStateTransitionError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/domain-errors';
import {
  ListingRepository,
  type CreateDraftInput,
  type ListingFilter,
  type ListingRow,
  type ListingStatus,
  type Page,
  type UnitRow,
  type UpdateDraftInput,
} from './internal/listing.repository';
import { SerialService, type SerialCsvReport } from './internal/serial.service';

/**
 * `warranty_duration` in months, for the only two bands a buyer filters on.
 * `D7`/`D30` are day-scale bands and deliberately map to nothing: rounding a
 * seven-day warranty up to "6 months" is a misrepresentation, not a rounding.
 */
const WARRANTY_MONTHS: Readonly<Record<string, number | null>> = {
  NONE: null,
  D7: null,
  D30: null,
  M3: 3,
  M6: 6,
  M12: 12,
};

/**
 * The row types travel with the service, not out of `internal/` directly — the
 * barrel names one file, and a sibling module importing "the repository's
 * types" is one refactor away from importing the repository.
 */
export type {
  CreateDraftInput,
  ListingFilter,
  ListingRow,
  ListingStatus,
  Page,
  TierPriceRow,
  UnitRow,
  UpdateDraftInput,
} from './internal/listing.repository';

/**
 * The public interface of the `listing` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `listing` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: listings, units (serials), tier prices, stock movements, price history, grade corrections
 *
 * Other modules reach this through `src/modules/listing` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 *
 * **Submit, pricing and sourcing are deliberately not here.** They are separate
 * services in this module: submit is the transition that requests an inspection
 * instead of going live, pricing is the engine that turns the vendor's ask into
 * a retail price, sourcing is the GST and anti-theft declaration. What this
 * service owns is the wizard — everything that happens before the vendor presses
 * the button.
 */

/**
 * What a vendor is allowed to see about their own listing.
 *
 * A hand-written whitelist, not `Omit<ListingRow, 'unitPrice'>`, for one reason:
 * **the vendor never sees the retail price.** `listing.unit_price` becomes that
 * price at activation, `price_band_median` is derived from other vendors'
 * prices, and a floor override is an ops decision about our own margin. A view
 * built by subtraction silently gains every column somebody adds to the row
 * later; this one gains nothing it was not handed.
 */
export interface VendorListingView {
  id: string;
  skuId: string;
  grade: string;
  conditionType: string;
  functionalStatus: string;
  batteryHealthBand: string;
  partsStatus: string;
  partsReplaced: string[];
  repairHistory: string;
  dataWipeStatus: string;
  sellerWarranty: string;
  oemWarrantyRemaining: string;
  vendorWarrantyMonths: number;
  vendorWarrantyScope: unknown;
  /** Their own number, the one they typed. Never ours. */
  vendorAskPrice: Money | null;
  moq: number;
  dispatchSlaHours: number;
  pickupLocationId: string;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  qtyAwaitingQc: number;
  qtyQcFailed: number;
  status: ListingStatus;
  /**
   * The price-band check fired and a human is looking. The vendor is told that
   * much and no more — the median it was compared against is other vendors'
   * pricing, and VR-099 does not stop being true because the number is an
   * aggregate.
   */
  underPriceReview: boolean;
  gradeCorrectedFrom: string | null;
  qcRequestedAt: Date | null;
  qcCompletedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One physical laptop, as its owner sees it. Also free of any selling price. */
export interface VendorUnitView {
  id: string;
  serialNumber: string;
  gradeDeclared: string;
  gradeActual: string | null;
  status: string;
  isSellable: boolean;
  location: string;
  vendorAskPrice: Money | null;
  /**
   * This machine's payout is settled and cannot be repriced. `purchase_price` is
   * frozen by `trg_lock_purchase_price` once a purchase order names the serial.
   */
  payoutLocked: boolean;
  qcPassedAt: Date | null;
  qcValidUntil: Date | null;
  createdAt: Date;
}

/** One row from `listing.stock_movement`, as the unit's owner may read it. */
export interface VendorUnitMovementView {
  at: string;
  fromStatus: string | null;
  toStatus: string;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string | null;
}

export interface VendorImageView {
  id: string;
  fileKey: string;
  imageType: string;
  uploadedAt: Date;
}

export interface AddUnitsOutcome {
  added: string[];
  /** Every verdict, so the wizard can show what it refused and why. */
  batch: SerialBatch;
}

export interface IListingService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  createDraft(input: CreateDraftInput): Promise<VendorListingView>;
  updateDraft(id: string, patch: UpdateDraftInput): Promise<VendorListingView>;
  getForVendor(id: string): Promise<VendorListingView>;
  listForVendor(
    filter: ListingFilter,
    page: { page: number; pageSize: number },
  ): Promise<Page<VendorListingView>>;

  /**
   * Validate serials and attach the ones that pass.
   *
   * The verdicts come back whichever way it goes: a paste of fifty with three
   * duplicates attaches forty-seven and names the three. Refusing the batch
   * because part of it is wrong is how ten minutes becomes an hour.
   */
  addUnits(
    listingId: string,
    serials: readonly string[],
    brandName?: string | null,
  ): Promise<AddUnitsOutcome>;

  /** The live "already listed" check the wizard runs as the vendor types. */
  validateSerials(serials: readonly string[], brandName?: string | null): Promise<SerialBatch>;

  /**
   * The full row, for sibling modules — submit, pricing, ordering, QC.
   *
   * It carries `unitPrice`, which is why it is a separate method rather than a
   * flag on `getForVendor`. A flag is one wrong argument away from putting the
   * retail price in a vendor response.
   */
  getListing(id: string): Promise<ListingRow | null>;

  /**
   * Stock counts for the storefront's public figures.
   *
   * Here rather than in a caller's query because `v_sellable_unit` is THE
   * definition of sellable (a stored flag AND the live expiry predicate), and a
   * public page that counts `listing.unit` by status instead would quietly
   * publish a different definition than the one the buyer's search obeys.
   */
  publicStockCounts(): Promise<{ sellable: number; returnedToVendor: number }>;

  /**
   * Sellable units per SKU, for callers that own the SKU->something mapping.
   *
   * The caller joins in memory rather than in SQL: the brand of a SKU is
   * catalog's fact and the stock behind it is listing's, and neither module is
   * allowed to read the other's tables to put them side by side.
   */
  countSellableBySku(): Promise<Map<string, number>>;

  /**
   * The buyer-facing offer list: one row per (SKU, inspected grade), built only
   * from `v_sellable_unit`.
   *
   * Aggregated on purpose. A buyer chooses a machine, then chooses a supply
   * point; a flat list of every serial is the wrong shape for the first
   * decision. It also means the row carries a price RANGE rather than one
   * vendor's number, which is the anonymity boundary doing its job.
   */
  publicOffers(limit: number): Promise<PublicOffer[]>;

  /**
   * Live sellable stock and the buyer-facing dispatch label, per listing.
   *
   * Ordering's cart calls this on every cart view and on every checkout entry,
   * and it is here rather than in a cart query for the reason PHASE_05 Task 3
   * gives: `v_sellable_unit` is THE definition of sellable. A cart that counted
   * `listing.unit` by status, or that trusted the denormalised `qty_available`
   * on the listing row, would keep offering a machine whose QC expired at
   * midnight — the view re-evaluates the expiry and seal predicates on read, and
   * a stored count by construction cannot.
   *
   * `supplyPointCode` and `city` come back because the cart groups its lines by
   * dispatch point, and that pair is the *only* thing about the source a buyer is
   * ever shown (`supplyPointLabel()` renders it). The vendor org id that resolves
   * them never leaves this module, which is the whole point of answering here
   * instead of handing ordering a join.
   */
  availabilityByListing(listingIds: readonly string[]): Promise<Map<string, ListingAvailability>>;

  /**
   * Every sellable unit, reduced to the facts a buyer's search may know.
   *
   * The storefront's faceted search needs unit measurements (grade, battery,
   * score, price) beside catalogue specification (brand, memory, screen), and
   * those two live in two schemas that may not be joined. So this answers the
   * listing half and the caller composes on `sku_id`, exactly as `publicOffers`
   * and `brands` already do.
   *
   * Reads `v_sellable_unit`, so a unit whose QC expired at midnight or whose
   * seal was broken is not in the answer — the search never re-states the
   * predicate, which is the only way there stays one definition of sellable.
   */
  sellableUnitFacts(): Promise<SellableUnitFacts[]>;
}

/**
 * One buyer-facing offer row.
 *
 * Contains no vendor identifier of any kind: not the org id, not the ask price,
 * not the margin. `supplyPoints` is a COUNT, because how many independent
 * sources hold a model is useful to a buyer and which ones they are is not.
 */
export interface PublicOffer {
  skuId: string;
  grade: Grade;
  /** Lowest retail price across sellable units, as a decimal string. */
  fromPrice: string;
  unitsAvailable: number;
  supplyPoints: number;
  avgQcScore: number;
  batteryMin: number;
  batteryMax: number;
  /** One real serial, so the viewfinder brackets are vouching for something. */
  sampleSerial: string;
}

/**
 * One sellable unit as a buyer's search may see it.
 *
 * `vendor_org_id` resolves the supply point and then stays in this module: the
 * pair (`supplyPointCode`, `city`) is the ONLY thing about the source that ever
 * leaves it, and `supplyPointLabel()` is what renders it.
 */
export interface SellableUnitFacts {
  skuId: string;
  grade: Grade;
  /** Decimal string. A search that sorts on price must not sort on a float. */
  retailPrice: string;
  /** `null` when the battery was not measured — never rendered as zero. */
  batteryHealthPct: number | null;
  qcScore: number | null;
  supplyPointCode: string | null;
  city: string | null;
  dispatchSlaHours: number | null;
  /** Our own warranty on the unit, in months. `null` when none is offered. */
  warrantyMonths: number | null;
  serialNumber: string;
}

/**
 * What a customer-facing caller may know about a listing: enough to render an
 * offer and a cart line, and nothing that identifies who is behind it.
 *
 * This is the single buyer-facing read of a listing. `getForVendor` is scoped to
 * the owning vendor by design, so under a buyer principal it returns nothing at
 * all - which is correct for a vendor screen and useless for a cart. Rather than
 * loosening that scope (a vendor-scoped read that sometimes is not is the worst
 * of both), the buyer's facts live here, where the query decides exactly which
 * columns a buyer may see.
 *
 * Absent on purpose: `vendor_org_id`, `vendor_ask_price`, `purchase_price` and
 * every margin field. The vendor's number is not the buyer's business, and the
 * supply point pair below is the only thing about the source anyone is shown.
 */
export interface ListingAvailability {
  /** Units that are sellable *right now*, counted through `v_sellable_unit`. */
  availableQty: number;
  /** `A`, `B`, … - the anonymised label, never derived from the vendor UUID. */
  supplyPointCode: string | null;
  city: string | null;
  skuId: string;
  grade: Grade;
  /**
   * OUR selling price for this listing. Never the vendor ask.
   *
   * `listing.unit_price` is the buyer-facing figure the offers grid ranks on;
   * `unit.retail_price` is its per-serial counterpart and they are constrained to
   * agree. A cart line quotes the listing-level price because that is the offer
   * the buyer accepted.
   */
  unitPrice: Money;
  moq: number;
  dispatchSlaHours: number;
  /**
   * Whether the listing is open for sale at all.
   *
   * Deliberately separate from `availableQty`. A listing can be PAUSED with stock
   * sitting behind it, and a listing can be ACTIVE with every unit reserved -
   * those are different refusals and a buyer deserves the right one.
   */
  purchasable: boolean;
}

@Injectable()
export class ListingService implements IListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingRepository,
    private readonly serials: SerialService,
  ) {}

  /**
   * `uq_unit_active_serial` is the most important index in the database — the
   * only thing stopping the same laptop being sold twice, by two vendors, at
   * once. It is also *partial*, and a partial index is the kind that can be
   * rebuilt wrong and leave every query still working while the duplicate
   * quietly succeeds. Worth failing a health check over rather than finding out
   * during a dispute.
   */
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n
        FROM pg_indexes
       WHERE schemaname = 'listing' AND indexname = 'uq_unit_active_serial'`;
    return Number(row?.n ?? 0) === 1
      ? { ok: true }
      : {
          ok: false,
          detail:
            'uq_unit_active_serial is missing. Duplicate live serials would be accepted silently.',
        };
  }

  // -------------------------------------------------------------------------
  // Public read surface (storefront figures)
  // -------------------------------------------------------------------------

  async publicStockCounts(): Promise<{ sellable: number; returnedToVendor: number }> {
    const [row] = await this.prisma.$queryRaw<Array<{ sellable: bigint; returned: bigint }>>`
      SELECT (SELECT count(*) FROM listing.v_sellable_unit)                     AS sellable,
             (SELECT count(*) FROM listing.unit WHERE status = 'RETURNED_TO_VENDOR') AS returned`;
    return {
      sellable: Number(row?.sellable ?? 0),
      returnedToVendor: Number(row?.returned ?? 0),
    };
  }

  /**
   * ponytail: one row per SKU that currently has stock, materialised into a Map.
   * That is bounded by SKUs actually in stock rather than by the catalogue, and
   * the only caller caches for a minute. If it ever stops fitting comfortably,
   * the upgrade is a `skuIds` argument so the caller asks about the page it is
   * rendering instead of the whole platform.
   */
  async countSellableBySku(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ sku_id: string; n: bigint }>>`
      SELECT sku_id, count(*) AS n FROM listing.v_sellable_unit GROUP BY sku_id`;
    return new Map(rows.map((r) => [r.sku_id, Number(r.n)]));
  }

  /**
   * The count comes from the view; the label comes from the table.
   *
   * Those two halves are deliberately different sources. Counting through
   * `v_sellable_unit` is what makes an expired or unsealed unit disappear the
   * moment it expires. But the *label* has to survive a listing going
   * temporarily empty — a cart line that shows "0 of 5 available" still has to
   * say which dispatch point it belonged to, or the buyer cannot tell which of
   * their lines just went away. So the query drives off `listing.unit`, which is
   * legitimate here (this is listing's own table, read inside listing) and joins
   * the view in to do the counting.
   *
   * The supply point is resolved on `(vendor_org_id, code)` rather than on the
   * unit's city, because `listing.supply_point` is the register of assignments
   * and `unit.supply_point_code` is a denormalised copy of it —
   * `v_supply_point_drift` is the thing that proves the two agree.
   */
  async availabilityByListing(
    listingIds: readonly string[],
  ): Promise<Map<string, ListingAvailability>> {
    if (listingIds.length === 0) return new Map();

    // Driven off `listing.listing`, not `listing.unit`. A listing whose last
    // sellable unit just went is still a listing, and a cart line that vanishes
    // rather than saying "0 of 5 available" leaves the buyer unable to tell
    // which of their lines disappeared.
    const rows = await this.prisma.$queryRaw<
      Array<{
        listing_id: string;
        sku_id: string;
        grade: string;
        unit_price: unknown;
        moq: number;
        dispatch_sla_hours: number;
        purchasable: boolean;
        available: bigint;
        code: string | null;
        city: string | null;
      }>
    >`
      SELECT l.id                        AS listing_id,
             l.sku_id,
             l.grade::text               AS grade,
             l.unit_price,
             l.moq,
             l.dispatch_sla_hours,
             (l.status IN ('ACTIVE','PARTIALLY_ACTIVE')) AS purchasable,
             count(sv.id)::bigint        AS available,
             min(u.supply_point_code)    AS code,
             min(sp.city)                AS city
        FROM listing.listing l
        LEFT JOIN listing.unit u            ON u.listing_id = l.id
        LEFT JOIN listing.v_sellable_unit sv ON sv.id = u.id
        LEFT JOIN listing.supply_point sp
               ON sp.vendor_org_id = u.vendor_org_id
              AND sp.code = u.supply_point_code
       WHERE l.id = ANY(${[...listingIds]}::uuid[])
       GROUP BY l.id, l.sku_id, l.grade, l.unit_price, l.moq, l.dispatch_sla_hours, l.status`;

    return new Map(
      rows.map((r) => [
        r.listing_id,
        {
          availableQty: Number(r.available),
          supplyPointCode: r.code,
          city: r.city,
          skuId: r.sku_id,
          grade: r.grade as Grade,
          // NUMERIC arrives as a Decimal. Number() here would be a float bug on
          // the one field a buyer is charged against.
          unitPrice: moneyFromDb(r.unit_price as string)!,
          moq: Number(r.moq),
          dispatchSlaHours: Number(r.dispatch_sla_hours),
          purchasable: r.purchasable,
        },
      ]),
    );
  }

  async publicOffers(limit: number): Promise<PublicOffer[]> {
    // Reads v_sellable_unit, never listing.unit: the view re-evaluates the QC
    // expiry and seal predicates on read, so a machine whose inspection lapsed
    // at midnight leaves the storefront at midnight rather than whenever a job
    // next runs.
    //
    // It also touches ONLY the listing schema. The brand, model and
    // specification behind a sku_id are catalog's facts, and joining to them
    // here would be a second definition of what a SKU is — the caller composes
    // the two halves on sku_id, which is what the JOIN was doing anyway.
    const rows = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade: string;
        from_price: unknown;
        units: bigint;
        supply_points: bigint;
        avg_score: unknown;
        batt_min: number | null;
        batt_max: number | null;
        sample_serial: string;
      }>
    >`
      SELECT u.sku_id,
             u.grade_actual::text AS grade,
             min(u.retail_price)  AS from_price,
             count(*)::bigint     AS units,
             count(DISTINCT u.supply_point_code)::bigint AS supply_points,
             round(avg(u.qc_score))    AS avg_score,
             min(u.battery_health_pct) AS batt_min,
             max(u.battery_health_pct) AS batt_max,
             min(u.serial_number)      AS sample_serial
        FROM listing.v_sellable_unit u
       WHERE u.retail_price IS NOT NULL
       GROUP BY u.sku_id, u.grade_actual
       ORDER BY min(u.retail_price)
       LIMIT ${limit}`;

    return rows.map((r) => ({
      skuId: r.sku_id,
      grade: r.grade as Grade,
      // NUMERIC through moneyFromDb, never Number(): this is the figure a buyer
      // is charged against.
      fromPrice: (moneyFromDb(r.from_price as string) ?? Money.ZERO).toString(),
      unitsAvailable: Number(r.units),
      supplyPoints: Number(r.supply_points),
      avgQcScore: Number(r.avg_score ?? 0),
      batteryMin: Number(r.batt_min ?? 0),
      batteryMax: Number(r.batt_max ?? 0),
      sampleSerial: r.sample_serial,
    }));
  }

  async sellableUnitFacts(): Promise<SellableUnitFacts[]> {
    // ponytail: every sellable unit in one read, filtered and faceted in the
    // caller. At 48 units that is free and it keeps the two schemas apart; past
    // a few thousand this becomes a filtered query per request with the facet
    // counts computed in SQL over a materialised view.
    //
    // The supply point is resolved through `vendor_org_id`, which is why the
    // join is here rather than in the caller: the org id is the thing that must
    // not leave this module, and the code/city pair is what replaces it.
    const rows = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade: string;
        retail_price: unknown;
        battery_health_pct: unknown;
        qc_score: number | null;
        supply_point_code: string | null;
        city: string | null;
        dispatch_sla_hours: number | null;
        warranty: string | null;
        serial_number: string;
      }>
    >`
      SELECT u.sku_id,
             u.grade_actual::text        AS grade,
             u.retail_price,
             u.battery_health_pct,
             u.qc_score,
             u.supply_point_code,
             sp.city,
             l.dispatch_sla_hours,
             l.truetech_warranty::text   AS warranty,
             u.serial_number
        FROM listing.v_sellable_unit u
        LEFT JOIN listing.supply_point sp
               ON sp.vendor_org_id = u.vendor_org_id
              AND sp.code = u.supply_point_code
        LEFT JOIN listing.listing l ON l.id = u.listing_id
       WHERE u.retail_price IS NOT NULL
         AND u.grade_actual IS NOT NULL`;

    return rows.map((r) => ({
      skuId: r.sku_id,
      grade: r.grade as Grade,
      retailPrice: (moneyFromDb(r.retail_price as string) ?? Money.ZERO).toString(),
      // A unit whose battery was never measured stays null all the way to the
      // screen, where it reads "Not measured". Coercing it to 0 here would make
      // an unmeasured machine look like a dead one.
      batteryHealthPct: r.battery_health_pct === null ? null : Number(r.battery_health_pct),
      qcScore: r.qc_score === null ? null : Number(r.qc_score),
      supplyPointCode: r.supply_point_code,
      city: r.city,
      dispatchSlaHours: r.dispatch_sla_hours === null ? null : Number(r.dispatch_sla_hours),
      warrantyMonths: WARRANTY_MONTHS[r.warranty ?? 'NONE'] ?? null,
      serialNumber: r.serial_number,
    }));
  }

  // -------------------------------------------------------------------------
  // Draft lifecycle
  // -------------------------------------------------------------------------

  async createDraft(input: CreateDraftInput): Promise<VendorListingView> {
    return toVendorView(await this.listings.createDraft(input));
  }

  async updateDraft(id: string, patch: UpdateDraftInput): Promise<VendorListingView> {
    // Read first so the refusal can say which of the two things went wrong. The
    // UPDATE matches on ownership *and* status, so a bare "no rows" cannot tell
    // a vendor whether the listing is not theirs or simply no longer a draft.
    const current = await this.requireDraft(id);
    const updated = await this.listings.updateDraft(id, patch);
    if (!updated) throw new IllegalStateTransitionError('listing', current.status, 'DRAFT');
    return toVendorView(updated);
  }

  async getForVendor(id: string): Promise<VendorListingView> {
    const row = await this.listings.findById(id);
    if (!row) throw new NotFoundError('listing');
    return toVendorView(row);
  }

  async listForVendor(
    filter: ListingFilter,
    page: { page: number; pageSize: number },
  ): Promise<Page<VendorListingView>> {
    const result = await this.listings.findByVendor(filter, page);
    return { ...result, rows: result.rows.map(toVendorView) };
  }

  getListing(id: string): Promise<ListingRow | null> {
    return this.listings.findById(id);
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  async addUnits(
    listingId: string,
    serials: readonly string[],
    brandName?: string | null,
  ): Promise<AddUnitsOutcome> {
    const listing = await this.requireDraft(listingId);
    const batch = await this.serials.validate(serials, brandName);

    // VR-080 claims a database check that does not exist, so the cap is enforced
    // here. The DTO bounds one request; this bounds the listing, which is what
    // a vendor pasting the same file twice actually hits.
    if (listing.qtyTotal + batch.accepted.length > LISTING_QTY.max!) {
      throw new ValidationError(LISTING_QTY.message, { serials: LISTING_QTY.message });
    }

    const result = await this.listings.addUnits(listingId, batch.accepted);

    // A serial can go live between the check and the insert — two vendors
    // pasting the same one in the same second is not hypothetical when the same
    // corporate buyback was offered to both. Whatever the database refused is
    // folded back in, so the vendor reads one list of problems and not two.
    return {
      added: result.added,
      batch: { ...batch, errors: [...batch.errors, ...result.rejected] },
    };
  }

  async listUnits(listingId: string): Promise<VendorUnitView[]> {
    return (await this.listings.findUnits(listingId)).map(toUnitView);
  }

  async listUnitMovements(
    listingId: string,
    unitId: string,
  ): Promise<VendorUnitMovementView[]> {
    const units = await this.listings.findUnits(listingId);
    if (!units.some((u) => u.id === unitId)) {
      throw new NotFoundError('unit', { listingId, unitId });
    }
    const rows = await this.listings.findUnitMovements(listingId, unitId);
    return rows.map((r) => ({
      at: r.occurredAt.toISOString(),
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      fromLocation: r.fromLocation,
      toLocation: r.toLocation,
      reason: r.reason,
    }));
  }

  async removeUnit(listingId: string, unitId: string): Promise<void> {
    await this.requireDraft(listingId);
    const removed = await this.listings.removeUnit(listingId, unitId);
    if (!removed) {
      throw new NotFoundError('unit', { listingId, unitId, reason: 'missing_or_past_created' });
    }
  }

  // -------------------------------------------------------------------------
  // Serials
  // -------------------------------------------------------------------------

  validateSerials(serials: readonly string[], brandName?: string | null): Promise<SerialBatch> {
    return this.serials.validate(serials, brandName);
  }

  validateSerialBlock(text: string, brandName?: string | null): Promise<SerialBatch> {
    return this.serials.validateBlock(text, brandName);
  }

  /**
   * The wizard's dry run, at step 3, where no listing exists yet.
   *
   * No capacity and no status to check, because there is nothing to check them
   * against — the listing is created when the wizard is submitted. This is the
   * only caller for which that is honest.
   */
  dryRunSerialCsv(csv: string, brandName?: string | null): Promise<SerialCsvReport> {
    return this.serials.dryRunCsv(csv, { brandName });
  }

  /**
   * The bulk-upload screen's dry run, against a listing that already exists.
   *
   * **This is the one that has to agree with `addUnits`, and the two things it
   * reads are exactly the two whole-file refusals `addUnits` performs.** Without
   * them the report promised rows that the commit then rejected in their
   * entirety: a non-DRAFT listing raises `IllegalStateTransitionError` and a
   * batch over `LISTING_QTY.max` raises `ValidationError`, and neither is a
   * per-row outcome the vendor could have seen coming.
   *
   * The status refusal is worded as the vendor's situation rather than as the
   * state machine's: "this listing has already gone for inspection" is something
   * they can act on; `DRAFT -> ACTIVE` is not.
   */
  async dryRunSerialCsvForListing(
    listingId: string,
    csv: string,
    brandName?: string | null,
  ): Promise<SerialCsvReport> {
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundError('listing');

    const blocked =
      listing.status === 'DRAFT'
        ? undefined
        : `Serial numbers can only be added while a listing is still a draft, and this one is ${listing.status.replaceAll('_', ' ').toLowerCase()}. Add these machines on a new listing instead.`;

    return this.serials.dryRunCsv(csv, {
      brandName: brandName ?? null,
      // The same subtraction `addUnits` makes before it refuses the batch.
      capacityLeft: Math.max(0, (LISTING_QTY.max ?? 0) - listing.qtyTotal),
      ...(blocked ? { blocked } : {}),
    });
  }

  serialErrorReportCsv(report: SerialCsvReport): string {
    return this.serials.errorReportCsv(report);
  }

  // -------------------------------------------------------------------------
  // Photographs of the actual machine
  // -------------------------------------------------------------------------
  //
  // The upload itself is not here: the client puts the file in object storage
  // and sends the key it got back, exactly as the catalog's condition-image
  // library does. This records which key belongs to which listing.

  async attachImage(input: {
    listingId: string;
    fileKey: string;
    imageType: string;
    hash: string;
  }): Promise<VendorImageView> {
    await this.requireDraft(input.listingId);
    const image = await this.listings.addImage(input);
    return {
      id: image.id,
      fileKey: image.fileKey,
      imageType: image.imageType,
      uploadedAt: image.uploadedAt,
    };
  }

  async listImages(listingId: string): Promise<VendorImageView[]> {
    const rows = await this.listings.findImages(listingId);
    return rows.map((r) => ({
      id: r.id,
      fileKey: r.fileKey,
      imageType: r.imageType,
      uploadedAt: r.uploadedAt,
    }));
  }

  async removeImage(listingId: string, imageId: string): Promise<void> {
    await this.requireDraft(listingId);
    const removed = await this.listings.removeImage(listingId, imageId);
    if (!removed) throw new NotFoundError('image');
  }

  /**
   * Fetch a listing the caller owns and insist it is still editable.
   *
   * Everything the wizard does is a draft edit. After submit the listing is a
   * commitment somebody is scheduling an inspection around, and every path that
   * changes it from then on carries an actor and a reason — grade correction,
   * reprice, ops override. None of those are this service's.
   */
  private async requireDraft(id: string): Promise<ListingRow> {
    const row = await this.listings.findById(id);
    if (!row) throw new NotFoundError('listing');
    if (row.status !== 'DRAFT') {
      throw new IllegalStateTransitionError('listing', row.status, 'DRAFT');
    }
    return row;
  }
}

function toVendorView(r: ListingRow): VendorListingView {
  return {
    id: r.id,
    skuId: r.skuId,
    grade: r.grade,
    conditionType: r.conditionType,
    functionalStatus: r.functionalStatus,
    batteryHealthBand: r.batteryHealthBand,
    partsStatus: r.partsStatus,
    partsReplaced: r.partsReplaced,
    repairHistory: r.repairHistory,
    dataWipeStatus: r.dataWipeStatus,
    sellerWarranty: r.sellerWarranty,
    oemWarrantyRemaining: r.oemWarrantyRemaining,
    vendorWarrantyMonths: r.vendorWarrantyMonths,
    vendorWarrantyScope: r.vendorWarrantyScope,
    vendorAskPrice: r.vendorAskPrice,
    moq: r.moq,
    dispatchSlaHours: r.dispatchSlaHours,
    pickupLocationId: r.pickupLocationId,
    qtyTotal: r.qtyTotal,
    qtyAvailable: r.qtyAvailable,
    qtyReserved: r.qtyReserved,
    qtyAwaitingQc: r.qtyAwaitingQc,
    qtyQcFailed: r.qtyQcFailed,
    status: r.status,
    underPriceReview: r.priceBandFlaggedAt !== null,
    gradeCorrectedFrom: r.gradeCorrectedFrom,
    qcRequestedAt: r.qcRequestedAt,
    qcCompletedAt: r.qcCompletedAt,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toUnitView(u: UnitRow): VendorUnitView {
  return {
    id: u.id,
    serialNumber: u.serialNumber,
    gradeDeclared: u.gradeDeclared,
    gradeActual: u.gradeActual,
    status: u.status,
    isSellable: u.isSellable,
    location: u.location,
    vendorAskPrice: u.vendorAskPrice,
    payoutLocked: u.payoutLocked,
    qcPassedAt: u.qcPassedAt,
    qcValidUntil: u.qcValidUntil,
    createdAt: u.createdAt,
  };
}
