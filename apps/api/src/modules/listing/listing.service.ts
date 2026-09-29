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
  type CatalogSkuFacts,
  type CreateDraftInput,
  type ListingFilter,
  type ListingRow,
  type ListingStatus,
  type Page,
  type UnitRow,
  type UpdateDraftInput,
} from './internal/listing.repository';
import { PricingService } from './internal/pricing.service';
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
/**
 * The catalogued machine this listing is — brand, model, and the configuration
 * the vendor picked. `null` when the SKU could not be read; a missing catalog
 * row must not look like an unnamed machine with empty strings.
 */
export type VendorSkuView = CatalogSkuFacts;

export interface VendorListingView {
  id: string;
  skuId: string;
  /** Catalog identity for the board and the record. Never a price. */
  sku: VendorSkuView | null;
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
  /** Ops' own words when they refused the listing. Null unless REJECTED. */
  rejectionReason: string | null;
  /** Present when `vendorAskPrice` is set — from the pricing engine, never client-side. */
  commissionPct: number | null;
  commissionAmount: Money | null;
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
  /** Null: nothing behind a declared listing has been inspected yet. Never 0. */
  avgQcScore: number | null;
  batteryMin: number | null;
  batteryMax: number | null;
  /** A real serial when one is known; null for declared stock. */
  sampleSerial: string | null;
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
  /** Null for a declared listing. */
  serialNumber: string | null;
  /** How many machines this row stands for. */
  qtyAvailable: number;
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
    private readonly pricing: PricingService,
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
  //
  // Every read here is LISTING-based. A listing is a declared quantity of one
  // machine at one grade from one supply point, and there are no inspected
  // units behind it until a buyer orders. `listing.qty_available` is therefore
  // the one definition of "on sale": written by ops approval and by the
  // ordering module's hold and order transactions, and by nothing else.
  // -------------------------------------------------------------------------

  async publicStockCounts(): Promise<{ sellable: number; returnedToVendor: number }> {
    const [row] = await this.prisma.$queryRaw<Array<{ sellable: bigint; returned: bigint }>>`
      SELECT (SELECT COALESCE(sum(qty_available), 0)::bigint FROM listing.listing
               WHERE status IN ('ACTIVE', 'PARTIALLY_ACTIVE'))                    AS sellable,
             (SELECT count(*)::bigint FROM listing.unit WHERE status = 'RETURNED_TO_VENDOR') AS returned`;
    return {
      sellable: Number(row?.sellable ?? 0),
      returnedToVendor: Number(row?.returned ?? 0),
    };
  }

  async countSellableBySku(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ sku_id: string; n: bigint }>>`
      SELECT sku_id, sum(qty_available)::bigint AS n
        FROM listing.listing
       WHERE status IN ('ACTIVE', 'PARTIALLY_ACTIVE') AND qty_available > 0
       GROUP BY sku_id`;
    return new Map(rows.map((r) => [r.sku_id, Number(r.n)]));
  }

  /**
   * The count and the price come off the listing row; the label comes from
   * `listing.supply_point` through the pickup address's city.
   *
   * Driven off `listing.listing` so a line that has just sold out still says
   * which dispatch point it belonged to — a cart line that vanishes rather than
   * saying "0 of 5 available" leaves the buyer unable to tell which of their
   * lines disappeared. The city is `identity`'s fact and is read in its own
   * statement; a listing whose supply point has never been assigned comes back
   * with a null code and the cart prints its "to be confirmed" label.
   */
  async availabilityByListing(
    listingIds: readonly string[],
  ): Promise<Map<string, ListingAvailability>> {
    if (listingIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      Array<{
        listing_id: string;
        vendor_org_id: string;
        pickup_location_id: string;
        sku_id: string;
        grade: string;
        unit_price: unknown;
        moq: number;
        dispatch_sla_hours: number;
        purchasable: boolean;
        available: number;
      }>
    >`
      SELECT l.id AS listing_id, l.vendor_org_id, l.pickup_location_id, l.sku_id,
             l.grade::text AS grade, l.unit_price, l.moq, l.dispatch_sla_hours,
             (l.status IN ('ACTIVE','PARTIALLY_ACTIVE')) AS purchasable,
             l.qty_available AS available
        FROM listing.listing l
       WHERE l.id = ANY(${[...listingIds]}::uuid[])`;

    const addressIds = [...new Set(rows.map((r) => r.pickup_location_id))];
    const cities =
      addressIds.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await this.prisma.$queryRaw<Array<{ id: string; city: string | null }>>`
                SELECT id, city FROM identity.org_address WHERE id = ANY(${addressIds}::uuid[])`
            ).flatMap((a) => (a.city?.trim() ? [[a.id, a.city.trim()] as const] : [])),
          );

    const vendorIds = [...new Set(rows.map((r) => r.vendor_org_id))];
    const points =
      vendorIds.length === 0
        ? []
        : await this.prisma.$queryRaw<Array<{ vendor_org_id: string; city: string; code: string }>>`
            SELECT vendor_org_id, city, code FROM listing.supply_point
             WHERE vendor_org_id = ANY(${vendorIds}::uuid[])`;
    const codeBy = new Map(points.map((p) => [`${p.vendor_org_id}|${p.city}`, p.code]));

    return new Map(
      rows.map((r) => {
        const city = cities.get(r.pickup_location_id) ?? null;
        const code = city ? (codeBy.get(`${r.vendor_org_id}|${city}`) ?? null) : null;
        return [
          r.listing_id,
          {
            availableQty: Number(r.available),
            supplyPointCode: code,
            city: code ? city : null,
            skuId: r.sku_id,
            grade: r.grade as Grade,
            // NUMERIC arrives as a Decimal. Number() here would be a float bug on
            // the one field a buyer is charged against.
            unitPrice: moneyFromDb(r.unit_price as string)!,
            moq: Number(r.moq),
            dispatchSlaHours: Number(r.dispatch_sla_hours),
            purchasable: r.purchasable,
          },
        ];
      }),
    );
  }

  async publicOffers(limit: number): Promise<PublicOffer[]> {
    // One row per (SKU, grade) across every live listing with stock. The
    // supply-point count is a count of vendors, which is the same number the
    // board would give and names nobody.
    const rows = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade: string;
        from_price: unknown;
        units: bigint;
        supply_points: bigint;
      }>
    >`
      SELECT l.sku_id,
             l.grade::text                         AS grade,
             min(l.unit_price)                     AS from_price,
             sum(l.qty_available)::bigint          AS units,
             count(DISTINCT l.vendor_org_id)::bigint AS supply_points
        FROM listing.listing l
       WHERE l.status IN ('ACTIVE', 'PARTIALLY_ACTIVE')
         AND l.qty_available > 0
       GROUP BY l.sku_id, l.grade
       ORDER BY min(l.unit_price)
       LIMIT ${limit}`;

    return rows.map((r) => ({
      skuId: r.sku_id,
      grade: r.grade as Grade,
      fromPrice: (moneyFromDb(r.from_price as string) ?? Money.ZERO).toString(),
      unitsAvailable: Number(r.units),
      supplyPoints: Number(r.supply_points),
      // Nothing behind a declared listing has been opened. Null, never zero.
      avgQcScore: null,
      batteryMin: null,
      batteryMax: null,
      sampleSerial: null,
    }));
  }

  async sellableUnitFacts(): Promise<SellableUnitFacts[]> {
    // One row per live listing, carrying its quantity, so the search's facet
    // counts add up machines rather than rows.
    const offers = await this.listings.publicLiveOffers();
    if (offers.length === 0) return [];

    const warranties = await this.prisma.$queryRaw<
      Array<{ id: string; warranty: string | null }>
    >`
      SELECT id, truetech_warranty::text AS warranty
        FROM listing.listing WHERE id = ANY(${offers.map((o) => o.listingId)}::uuid[])`;
    const warrantyBy = new Map(warranties.map((w) => [w.id, w.warranty]));

    return offers.map((o) => ({
      skuId: o.skuId,
      grade: o.grade,
      retailPrice: o.sellingPrice.toString(),
      batteryHealthPct: null,
      qcScore: null,
      supplyPointCode: o.supplyPointCode,
      city: o.city,
      dispatchSlaHours: o.dispatchSlaHours,
      warrantyMonths: WARRANTY_MONTHS[warrantyBy.get(o.listingId) ?? 'NONE'] ?? null,
      serialNumber: null,
      qtyAvailable: o.qtyAvailable,
    }));
  }

  // -------------------------------------------------------------------------
  // Draft lifecycle
  // -------------------------------------------------------------------------

  async createDraft(input: CreateDraftInput): Promise<VendorListingView> {
    return this.asVendorView(await this.listings.createDraft(input));
  }

  async updateDraft(id: string, patch: UpdateDraftInput): Promise<VendorListingView> {
    // Read first so the refusal can say which of the two things went wrong. The
    // UPDATE matches on ownership *and* status, so a bare "no rows" cannot tell
    // a vendor whether the listing is not theirs or simply no longer a draft.
    const current = await this.requireDraft(id);
    const updated = await this.listings.updateDraft(id, patch);
    if (!updated) throw new IllegalStateTransitionError('listing', current.status, 'DRAFT');
    return this.asVendorView(updated);
  }

  async getForVendor(id: string): Promise<VendorListingView> {
    const row = await this.listings.findById(id);
    if (!row) throw new NotFoundError('listing');
    return this.asVendorView(row);
  }

  async listForVendor(
    filter: ListingFilter,
    page: { page: number; pageSize: number },
  ): Promise<Page<VendorListingView>> {
    const result = await this.listings.findByVendor(filter, page);
    return { ...result, rows: await this.asVendorViews(result.rows) };
  }

  private async asVendorView(row: ListingRow): Promise<VendorListingView> {
    const [view] = await this.asVendorViews([row]);
    return view!;
  }

  private async asVendorViews(rows: readonly ListingRow[]): Promise<VendorListingView[]> {
    const skus = await this.listings.skuDetails(rows.map((r) => r.skuId));
    return Promise.all(
      rows.map(async (r) => {
        const base = { ...toVendorView(r), sku: skus.get(r.skuId) ?? null };
        if (!r.vendorAskPrice || r.qtyTotal === 0) {
          return { ...base, commissionPct: null, commissionAmount: null };
        }
        try {
          const preview = await this.pricing.previewPayout({
            skuId: r.skuId,
            grade: r.grade as Grade,
            vendorWarrantyMonths: r.vendorWarrantyMonths,
            units: r.qtyTotal,
            ask: { mode: 'NET_PAYOUT', vendorNetPayout: r.vendorAskPrice },
          });
          return {
            ...base,
            commissionPct: preview.commissionPct,
            commissionAmount: preview.commissionAmount,
          };
        } catch {
          return { ...base, commissionPct: null, commissionAmount: null };
        }
      }),
    );
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

function toVendorView(r: ListingRow): Omit<VendorListingView, 'sku'> {
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
    rejectionReason: r.rejectionReason,
    commissionPct: null,
    commissionAmount: null,
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
