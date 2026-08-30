import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb, type Grade, type SerialIssue } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { OrgScope } from '../../../shared/db/org-scope';
import {
  ConflictError,
  ForbiddenError,
  PreconditionFailedError,
} from '../../../shared/errors/domain-errors';

/**
 * Every statement that touches `listing.listing`, `listing.unit`,
 * `listing.listing_tier_price` and `listing.listing_image`.
 *
 * Three jobs are this layer's and nothing else's:
 *
 *   1. **Converting money at the boundary.** `unit_price`, `vendor_ask_price`
 *      and the tier prices are NUMERIC(14,2), so Prisma hands back a `Decimal`.
 *      `Number(row.price)` is the float bug this codebase keeps nearly shipping
 *      (VR-126), so nothing above this file ever sees a Decimal.
 *   2. **Scoping to the vendor in the query.** 02_ARCHITECTURE.md §3.2 layer 3:
 *      a missing `where` in a service must not be able to leak another org's
 *      rows. So the org predicate is welded into the statements rather than left
 *      to a guard a new endpoint can forget to wear.
 *   3. **Turning constraint violations into per-row answers.** `uq_unit_active_serial`
 *      and `excl_tier_overlap` are the two constraints a vendor will actually
 *      hit, and each has a sentence a person can act on. A 500 does not.
 *
 * `unit.retail_price` and `unit.margin_rule_id` are deliberately not selected by
 * any read in this file. The surest way to keep the number a vendor must never
 * see out of a vendor response is never to fetch it; a whitelist further up is
 * one careless spread away from failing, and this is not.
 *
 * The column lists are written out per query rather than shared in a constant.
 * `$queryRaw` is a tagged template — every `${}` becomes a bind parameter, so a
 * shared fragment would have to be concatenated into the SQL as text, which is
 * how a repository becomes an injection point. Four copies of a static SELECT
 * list is the cheaper mistake, and the same trade the catalog module made.
 */

export type ListingStatus =
  | 'DRAFT'
  | 'AWAITING_QC'
  | 'QC_IN_PROGRESS'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'PARTIALLY_ACTIVE'
  | 'PAUSED'
  | 'OUT_OF_STOCK'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'DELISTED';

/** One sellable unit as the public comparison board may see it. */
export interface PublicBoardUnit {
  id: string;
  serialNumber: string;
  listingId: string | null;
  grade: Grade;
  retailPrice: Money;
  /** `null` when the battery was not measured. Never zero. */
  batteryHealthPct: number | null;
  qcScore: number | null;
  qcPassedAt: Date | null;
  qcValidUntil: Date | null;
  valuationMethod: 'REGULAR' | 'MARGIN';
  supplyPointCode: string;
  city: string;
  dispatchSlaHours: number;
  gstRatePct: number;
  /** Freight input. Finer than a city, so it never leaves the module. */
  pickupLocationId: string;
}

interface RawBoardUnit {
  id: string;
  serial_number: string;
  listing_id: string | null;
  grade: string;
  retail_price: unknown;
  battery_health_pct: unknown;
  qc_score: number | null;
  qc_passed_at: Date | null;
  qc_valid_until: Date | null;
  valuation_method: string | null;
  supply_point_code: string | null;
  city: string | null;
  dispatch_sla_hours: number;
  gst_rate: unknown;
  pickup_location_id: string;
}

/** Pricing inputs for one listing. Vendor-internal; see `publicPricingFacts`. */
export interface PublicPricingFacts {
  listingId: string;
  skuId: string;
  grade: Grade;
  sellingPrice: Money;
  gstRatePct: number;
  vendorWarrantyMonths: number;
  vendorAskPrice: Money;
}

export interface ListingRow {
  id: string;
  vendorOrgId: string;
  skuId: string;
  grade: Grade;
  conditionType: string;
  functionalStatus: string;
  batteryHealthBand: string;
  partsStatus: string;
  partsReplaced: string[];
  repairHistory: string;
  dataWipeStatus: string;
  sellerWarranty: string;
  oemWarrantyRemaining: string;
  truetechWarranty: string;
  /**
   * Buyer-facing once the listing is live — the offers grid ranks on it. While
   * the listing is a DRAFT it still holds the vendor's own ask (see
   * `createDraft`). It must never appear in a vendor-facing response.
   */
  unitPrice: Money;
  /** What the vendor asked for, read back off the units. Vendor-facing. */
  vendorAskPrice: Money | null;
  /** A tax rate, not an amount — a plain number is the right shape for it. */
  gstRate: number;
  moq: number;
  dispatchSlaHours: number;
  pickupLocationId: string;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  qtyAwaitingQc: number;
  qtyQcFailed: number;
  status: ListingStatus;
  approvedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  qcRequestedAt: Date | null;
  qcCompletedAt: Date | null;
  qcVisitId: string | null;
  vendorWarrantyMonths: number;
  vendorWarrantyScope: unknown;
  gradeCorrectedFrom: Grade | null;
  floorOverrideAt: Date | null;
  floorOverrideReason: string | null;
  priceBandFlaggedAt: Date | null;
  priceBandMedian: Money | null;
  /** A ratio, not money. */
  priceBandRatio: number | null;
}

export interface UnitRow {
  id: string;
  serialNumber: string;
  listingId: string | null;
  vendorOrgId: string;
  skuId: string;
  gradeDeclared: Grade;
  gradeActual: Grade | null;
  status: string;
  isSellable: boolean;
  location: string;
  vendorAskPrice: Money | null;
  /**
   * `purchase_price IS NOT NULL` — what we agreed to pay for THIS machine is
   * settled and `trg_lock_purchase_price` will not let it move.
   *
   * The boolean and not the amount. The amount is the vendor's own ask frozen at
   * PO time and they can read it on the purchase order; what a repricing screen
   * needs is only whether this serial can still change, and answering that with
   * a number invites the screen to do arithmetic the server already did.
   */
  payoutLocked: boolean;
  qcPassedAt: Date | null;
  qcValidUntil: Date | null;
  createdAt: Date;
}

export interface TierPriceRow {
  id: string;
  listingId: string;
  minQty: number;
  maxQty: number | null;
  unitPrice: Money;
}

export interface ListingImageRow {
  id: string;
  listingId: string;
  fileKey: string;
  imageType: string;
  hash: string;
  uploadedAt: Date;
}

export interface CreateDraftInput {
  skuId: string;
  pickupLocationId: string;
  grade: Grade;
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
  vendorWarrantyScope?: Record<string, unknown> | null;
  vendorAskPrice: Money;
  moq: number;
  dispatchSlaHours: number;
}

export type UpdateDraftInput = Partial<CreateDraftInput>;

export interface ListingFilter {
  status?: ListingStatus;
  skuId?: string;
  grade?: Grade;
  /**
   * Only listings with a grade correction **still waiting for the vendor**.
   *
   * **The predicate is the correction, not `grade_corrected_from`.** That column
   * is written when a correction is *applied* — by the vendor accepting it or by
   * the auto-apply job — so filtering on it returned nothing at all for the
   * corrections that are still open, which are precisely the ones the vendor's
   * dashboard sends them here to answer.
   *
   * **And it is the OPEN ones, which is the second half of the same bug.** The
   * dashboard's queue counts `vendor_responded_at IS NULL AND auto_applied_at IS
   * NULL`; this filter counted every correction ever raised. They agree today
   * only because the auto-apply job has never run and no vendor can answer one
   * yet (`GradeCorrectionService.respond()` is exposed by no controller — T31).
   * The moment either changes, a queue saying "3 need you" would land on a board
   * showing nine listings, and the two predicates must be one predicate for that
   * not to happen. If this ever needs to mean "ever corrected", that is a second
   * value, not a second meaning for this one.
   */
  corrected?: boolean;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AddUnitsResult {
  /** Serials now held as units on this listing. */
  added: string[];
  /**
   * Serials the database refused. There is exactly one reason today — the
   * partial unique index — and the message says so in the vendor's language.
   */
  rejected: SerialIssue[];
}

interface RawListing {
  id: string;
  vendor_org_id: string;
  sku_id: string;
  grade: string;
  condition_type: string;
  functional_status: string;
  battery_health_band: string;
  parts_status: string;
  parts_replaced: string[] | null;
  repair_history: string;
  data_wipe_status: string;
  seller_warranty: string;
  oem_warranty_remaining: string;
  truetech_warranty: string;
  unit_price: unknown;
  vendor_ask_price: unknown;
  gst_rate: unknown;
  moq: number;
  dispatch_sla_hours: number;
  pickup_location_id: string;
  qty_total: number;
  qty_available: number;
  qty_reserved: number;
  qty_awaiting_qc: number;
  qty_qc_failed: number;
  status: string;
  approved_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  qc_requested_at: Date | null;
  qc_completed_at: Date | null;
  qc_visit_id: string | null;
  vendor_warranty_months: number;
  vendor_warranty_scope: unknown;
  grade_corrected_from: string | null;
  floor_override_at: Date | null;
  floor_override_reason: string | null;
  price_band_flagged_at: Date | null;
  price_band_median: unknown;
  price_band_ratio: unknown;
}

function toListing(r: RawListing): ListingRow {
  return {
    id: r.id,
    vendorOrgId: r.vendor_org_id,
    skuId: r.sku_id,
    grade: r.grade as Grade,
    conditionType: r.condition_type,
    functionalStatus: r.functional_status,
    batteryHealthBand: r.battery_health_band,
    partsStatus: r.parts_status,
    partsReplaced: r.parts_replaced ?? [],
    repairHistory: r.repair_history,
    dataWipeStatus: r.data_wipe_status,
    sellerWarranty: r.seller_warranty,
    oemWarrantyRemaining: r.oem_warranty_remaining,
    truetechWarranty: r.truetech_warranty,
    unitPrice: moneyFromDb(r.unit_price as string)!,
    vendorAskPrice: moneyFromDb(r.vendor_ask_price as string | null),
    gstRate: Number(r.gst_rate),
    moq: r.moq,
    dispatchSlaHours: r.dispatch_sla_hours,
    pickupLocationId: r.pickup_location_id,
    qtyTotal: r.qty_total,
    qtyAvailable: r.qty_available,
    qtyReserved: r.qty_reserved,
    qtyAwaitingQc: r.qty_awaiting_qc,
    qtyQcFailed: r.qty_qc_failed,
    status: r.status as ListingStatus,
    approvedAt: r.approved_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    qcRequestedAt: r.qc_requested_at,
    qcCompletedAt: r.qc_completed_at,
    qcVisitId: r.qc_visit_id,
    vendorWarrantyMonths: r.vendor_warranty_months,
    vendorWarrantyScope: r.vendor_warranty_scope,
    gradeCorrectedFrom: (r.grade_corrected_from as Grade | null) ?? null,
    floorOverrideAt: r.floor_override_at,
    floorOverrideReason: r.floor_override_reason,
    priceBandFlaggedAt: r.price_band_flagged_at,
    priceBandMedian: moneyFromDb(r.price_band_median as string | null),
    priceBandRatio: r.price_band_ratio == null ? null : Number(r.price_band_ratio),
  };
}

interface RawUnit {
  id: string;
  serial_number: string;
  listing_id: string | null;
  vendor_org_id: string;
  sku_id: string;
  grade_declared: string;
  grade_actual: string | null;
  status: string;
  is_sellable: boolean;
  location: string;
  vendor_ask_price: unknown;
  payout_locked: boolean;
  qc_passed_at: Date | null;
  qc_valid_until: Date | null;
  created_at: Date;
}

function toUnit(r: RawUnit): UnitRow {
  return {
    id: r.id,
    serialNumber: r.serial_number,
    listingId: r.listing_id,
    vendorOrgId: r.vendor_org_id,
    skuId: r.sku_id,
    gradeDeclared: r.grade_declared as Grade,
    gradeActual: (r.grade_actual as Grade | null) ?? null,
    status: r.status,
    isSellable: r.is_sellable,
    location: r.location,
    vendorAskPrice: moneyFromDb(r.vendor_ask_price as string | null),
    payoutLocked: r.payout_locked,
    qcPassedAt: r.qc_passed_at,
    qcValidUntil: r.qc_valid_until,
    createdAt: r.created_at,
  };
}

interface RawTier {
  id: string;
  listing_id: string;
  min_qty: number;
  max_qty: number | null;
  unit_price: unknown;
}

function toTier(r: RawTier): TierPriceRow {
  return {
    id: r.id,
    listingId: r.listing_id,
    minQty: r.min_qty,
    maxQty: r.max_qty,
    unitPrice: moneyFromDb(r.unit_price as string)!,
  };
}

interface RawImage {
  id: string;
  listing_id: string;
  file_key: string;
  image_type: string;
  hash: string;
  uploaded_at: Date;
}

function toImage(r: RawImage): ListingImageRow {
  return {
    id: r.id,
    listingId: r.listing_id,
    fileKey: r.file_key,
    imageType: r.image_type,
    hash: r.hash,
    uploadedAt: r.uploaded_at,
  };
}

/**
 * The SQLSTATE behind a failed raw statement.
 *
 * Prisma reports a raw-query failure as P2010 with the state in `meta.code`, but
 * not on every driver path, so the message is read as a fallback. Getting this
 * wrong means a duplicate serial reaches the vendor as "Something went wrong at
 * our end" — the one answer that is both useless and untrue.
 */
function sqlState(e: unknown): string {
  const meta = (e as { meta?: { code?: string } } | undefined)?.meta;
  if (typeof meta?.code === 'string') return meta.code;
  const message = (e as { message?: string } | undefined)?.message ?? '';
  return /\b(23505|23P01|23514)\b/.exec(message)?.[1] ?? '';
}

@Injectable()
export class ListingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly scope: OrgScope,
  ) {}

  /**
   * The caller's org, as values a query can bind.
   *
   * Platform staff read across orgs — they run the review queue. A vendor is
   * pinned to their own and cannot ask for another's by passing an id, because
   * the id is never taken from the request.
   */
  private orgPredicate(): { orgId: string | null; isPlatform: boolean } {
    const isPlatform = this.scope.isPlatform;
    const orgId = this.scope.currentOrgId;
    if (!isPlatform && !orgId) {
      throw new ForbiddenError('This data requires a signed-in caller.', {
        reason: 'org_scope_without_principal',
      });
    }
    return { orgId, isPlatform };
  }

  /**
   * Create a draft.
   *
   * `unit_price` gets the vendor's own asking price rather than a placeholder.
   * The column is NOT NULL with CHECK (> 0) and the pricing engine has not run
   * yet, so something has to go in it — and of the available lies, "we would
   * sell it for exactly what the vendor wants" is the only one that fails safe.
   * A sentinel like 0.01 that escaped to ACTIVE is a live listing at one paisa;
   * this one earns no margin at all and is refused by the floor-margin guard
   * before it can go anywhere. The pricing lane overwrites it at activation.
   */
  async createDraft(input: CreateDraftInput): Promise<ListingRow> {
    const { orgId } = this.orgPredicate();
    if (!orgId) {
      throw new ForbiddenError('A listing belongs to a vendor org, so one must be in context.', {
        reason: 'listing_needs_owning_org',
      });
    }

    // The foreign key proves the address exists; it does not prove it is the
    // caller's. Pointing a listing at another org's pickup address would put
    // their warehouse on our dispatch paperwork, so ownership is checked here
    // rather than assumed from the fact that the id parsed as a UUID.
    const [address] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.org_address
       WHERE id = ${input.pickupLocationId}::uuid
         AND org_id = ${orgId}::uuid
         AND is_active`;
    if (!address) {
      throw new ForbiddenError('Choose a pickup address that belongs to your organisation.', {
        reason: 'pickup_address_not_owned',
      });
    }

    const ask = input.vendorAskPrice.toString();
    const rows = await this.prisma.$queryRaw<RawListing[]>`
      INSERT INTO listing.listing
        (vendor_org_id, sku_id, grade, condition_type, functional_status,
         battery_health_band, parts_status, parts_replaced, repair_history,
         data_wipe_status, seller_warranty, oem_warranty_remaining,
         vendor_warranty_months, vendor_warranty_scope, unit_price, moq,
         dispatch_sla_hours, pickup_location_id, status)
      VALUES
        (${orgId}::uuid, ${input.skuId}::uuid, ${input.grade}::public.grade_type,
         ${input.conditionType}::public.condition_type,
         ${input.functionalStatus}::public.functional_status,
         ${input.batteryHealthBand}::public.battery_band,
         ${input.partsStatus}::public.parts_status_type,
         ${input.partsReplaced}::text[],
         ${input.repairHistory}::public.repair_history_type,
         ${input.dataWipeStatus}::public.wipe_status_type,
         ${input.sellerWarranty}::public.warranty_duration,
         ${input.oemWarrantyRemaining}::public.oem_warranty_band,
         ${input.vendorWarrantyMonths},
         ${input.vendorWarrantyScope ? JSON.stringify(input.vendorWarrantyScope) : null}::jsonb,
         ${ask}::numeric, ${input.moq}, ${input.dispatchSlaHours},
         ${input.pickupLocationId}::uuid, 'DRAFT')
      RETURNING id, vendor_org_id, sku_id, grade, condition_type, functional_status,
                battery_health_band, parts_status, parts_replaced, repair_history,
                data_wipe_status, seller_warranty, oem_warranty_remaining, truetech_warranty,
                unit_price, gst_rate, moq, dispatch_sla_hours, pickup_location_id,
                qty_total, qty_available, qty_reserved, qty_awaiting_qc, qty_qc_failed,
                status, approved_at, expires_at, created_at, updated_at,
                qc_requested_at, qc_completed_at, qc_visit_id,
                vendor_warranty_months, vendor_warranty_scope, grade_corrected_from,
                floor_override_at, floor_override_reason,
                price_band_flagged_at, price_band_median, price_band_ratio,
                unit_price AS vendor_ask_price`;
    return toListing(rows[0]!);
  }

  /**
   * Patch a draft. `undefined` means "leave it alone", which is what each
   * COALESCE pair says — so a wizard step can send the two fields it owns
   * without echoing back the other twenty and racing the tab next to it.
   *
   * Only DRAFT rows match, deliberately. A price change to a listing that has
   * ever been live belongs in `price_history` with an actor and a reason, and
   * that path is the pricing lane's; letting a PATCH quietly reprice an ACTIVE
   * listing here would put a hole straight through that audit trail.
   *
   * One consequence worth knowing: `vendor_warranty_scope` cannot be cleared
   * back to NULL through this method, because null is how "unchanged" is spelt.
   * Nobody has asked to clear it; when they do it needs its own verb.
   */
  async updateDraft(id: string, patch: UpdateDraftInput): Promise<ListingRow | null> {
    const { orgId, isPlatform } = this.orgPredicate();
    const ask = patch.vendorAskPrice?.toString() ?? null;
    const scopeJson = patch.vendorWarrantyScope ? JSON.stringify(patch.vendorWarrantyScope) : null;

    return this.prisma.runInTransaction(async () => {
      const rows = await this.prisma.$queryRaw<RawListing[]>`
        UPDATE listing.listing l SET
          sku_id                 = COALESCE(${patch.skuId ?? null}::uuid, l.sku_id),
          pickup_location_id     = COALESCE(${patch.pickupLocationId ?? null}::uuid, l.pickup_location_id),
          grade                  = COALESCE(${patch.grade ?? null}::public.grade_type, l.grade),
          condition_type         = COALESCE(${patch.conditionType ?? null}::public.condition_type, l.condition_type),
          functional_status      = COALESCE(${patch.functionalStatus ?? null}::public.functional_status, l.functional_status),
          battery_health_band    = COALESCE(${patch.batteryHealthBand ?? null}::public.battery_band, l.battery_health_band),
          parts_status           = COALESCE(${patch.partsStatus ?? null}::public.parts_status_type, l.parts_status),
          parts_replaced         = COALESCE(${patch.partsReplaced ?? null}::text[], l.parts_replaced),
          repair_history         = COALESCE(${patch.repairHistory ?? null}::public.repair_history_type, l.repair_history),
          data_wipe_status       = COALESCE(${patch.dataWipeStatus ?? null}::public.wipe_status_type, l.data_wipe_status),
          seller_warranty        = COALESCE(${patch.sellerWarranty ?? null}::public.warranty_duration, l.seller_warranty),
          oem_warranty_remaining = COALESCE(${patch.oemWarrantyRemaining ?? null}::public.oem_warranty_band, l.oem_warranty_remaining),
          vendor_warranty_months = COALESCE(${patch.vendorWarrantyMonths ?? null}::int, l.vendor_warranty_months),
          vendor_warranty_scope  = COALESCE(${scopeJson}::jsonb, l.vendor_warranty_scope),
          unit_price             = COALESCE(${ask}::numeric, l.unit_price),
          moq                    = COALESCE(${patch.moq ?? null}::int, l.moq),
          dispatch_sla_hours     = COALESCE(${patch.dispatchSlaHours ?? null}::int, l.dispatch_sla_hours),
          updated_at             = ${this.clock.now()}
        WHERE l.id = ${id}::uuid
          AND l.status = 'DRAFT'
          AND (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)
        RETURNING l.id, l.vendor_org_id, l.sku_id, l.grade, l.condition_type, l.functional_status,
                  l.battery_health_band, l.parts_status, l.parts_replaced, l.repair_history,
                  l.data_wipe_status, l.seller_warranty, l.oem_warranty_remaining, l.truetech_warranty,
                  l.unit_price, l.gst_rate, l.moq, l.dispatch_sla_hours, l.pickup_location_id,
                  l.qty_total, l.qty_available, l.qty_reserved, l.qty_awaiting_qc, l.qty_qc_failed,
                  l.status, l.approved_at, l.expires_at, l.created_at, l.updated_at,
                  l.qc_requested_at, l.qc_completed_at, l.qc_visit_id,
                  l.vendor_warranty_months, l.vendor_warranty_scope, l.grade_corrected_from,
                  l.floor_override_at, l.floor_override_reason,
                  l.price_band_flagged_at, l.price_band_median, l.price_band_ratio,
                  l.unit_price AS vendor_ask_price`;

      const row = rows[0];
      if (!row) return null;

      // The ask lives on the units too — that is the column Phase 6 freezes into
      // purchase_price, per serial. They are repriced together or the two
      // disagree, and the one that decides what we owe is the one nobody reads.
      // Units with a purchase_price are excluded because trg_lock_purchase_price
      // has already closed them; a draft has none, and this is the guard for the
      // day someone points this method at a listing that is not one.
      if (ask !== null) {
        await this.prisma.$executeRaw`
          UPDATE listing.unit SET vendor_ask_price = ${ask}::numeric
           WHERE listing_id = ${id}::uuid AND purchase_price IS NULL`;
      }

      const mapped = toListing(row);
      // A draft with no serials yet has its ask only on the listing row.
      return { ...mapped, vendorAskPrice: (await this.askOf(id)) ?? mapped.unitPrice };
    });
  }

  /** The vendor's ask, read back off the units rather than kept in two places. */
  private async askOf(listingId: string): Promise<Money | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ ask: unknown }>>`
      SELECT max(vendor_ask_price) AS ask
        FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    return moneyFromDb((row?.ask ?? null) as string | null);
  }

  async findById(id: string): Promise<ListingRow | null> {
    const { orgId, isPlatform } = this.orgPredicate();
    const rows = await this.prisma.$queryRaw<RawListing[]>`
      SELECT l.id, l.vendor_org_id, l.sku_id, l.grade, l.condition_type, l.functional_status,
             l.battery_health_band, l.parts_status, l.parts_replaced, l.repair_history,
             l.data_wipe_status, l.seller_warranty, l.oem_warranty_remaining, l.truetech_warranty,
             l.unit_price, l.gst_rate, l.moq, l.dispatch_sla_hours, l.pickup_location_id,
             l.qty_total, l.qty_available, l.qty_reserved, l.qty_awaiting_qc, l.qty_qc_failed,
             l.status, l.approved_at, l.expires_at, l.created_at, l.updated_at,
             l.qc_requested_at, l.qc_completed_at, l.qc_visit_id,
             l.vendor_warranty_months, l.vendor_warranty_scope, l.grade_corrected_from,
             l.floor_override_at, l.floor_override_reason,
             l.price_band_flagged_at, l.price_band_median, l.price_band_ratio,
             -- Before any serial is attached the vendor's ask lives only on the
             -- listing, where createDraft put it; afterwards the units hold it.
             COALESCE((SELECT max(u.vendor_ask_price) FROM listing.unit u WHERE u.listing_id = l.id),
                      CASE WHEN l.status = 'DRAFT' THEN l.unit_price END) AS vendor_ask_price
        FROM listing.listing l
       WHERE l.id = ${id}::uuid
         AND (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)`;
    return rows[0] ? toListing(rows[0]) : null;
  }

  /**
   * The vendor's listing-management screen.
   *
   * `NULL means unfiltered`, so every filter predicate is static text and no
   * part of the statement is assembled from a string — which is how a filter
   * rail turns into an injection point.
   */
  async findByVendor(
    filter: ListingFilter,
    page: { page: number; pageSize: number },
  ): Promise<Page<ListingRow>> {
    const { orgId, isPlatform } = this.orgPredicate();
    const status = filter.status ?? null;
    const skuId = filter.skuId ?? null;
    const grade = filter.grade ?? null;
    const corrected = filter.corrected ?? false;
    const offset = (page.page - 1) * page.pageSize;

    const rows = await this.prisma.$queryRaw<RawListing[]>`
      SELECT l.id, l.vendor_org_id, l.sku_id, l.grade, l.condition_type, l.functional_status,
             l.battery_health_band, l.parts_status, l.parts_replaced, l.repair_history,
             l.data_wipe_status, l.seller_warranty, l.oem_warranty_remaining, l.truetech_warranty,
             l.unit_price, l.gst_rate, l.moq, l.dispatch_sla_hours, l.pickup_location_id,
             l.qty_total, l.qty_available, l.qty_reserved, l.qty_awaiting_qc, l.qty_qc_failed,
             l.status, l.approved_at, l.expires_at, l.created_at, l.updated_at,
             l.qc_requested_at, l.qc_completed_at, l.qc_visit_id,
             l.vendor_warranty_months, l.vendor_warranty_scope, l.grade_corrected_from,
             l.floor_override_at, l.floor_override_reason,
             l.price_band_flagged_at, l.price_band_median, l.price_band_ratio,
             -- Before any serial is attached the vendor's ask lives only on the
             -- listing, where createDraft put it; afterwards the units hold it.
             COALESCE((SELECT max(u.vendor_ask_price) FROM listing.unit u WHERE u.listing_id = l.id),
                      CASE WHEN l.status = 'DRAFT' THEN l.unit_price END) AS vendor_ask_price
        FROM listing.listing l
       WHERE (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)
         AND (${status}::text IS NULL OR l.status::text = ${status})
         AND (${skuId}::uuid  IS NULL OR l.sku_id = ${skuId}::uuid)
         AND (${grade}::text  IS NULL OR l.grade::text = ${grade})
         AND (NOT ${corrected} OR EXISTS (
               SELECT 1 FROM listing.grade_correction gc
                WHERE gc.listing_id = l.id
                  AND gc.vendor_responded_at IS NULL
                  AND gc.auto_applied_at IS NULL))
       ORDER BY l.updated_at DESC
       LIMIT ${page.pageSize} OFFSET ${offset}`;

    const [count] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n
        FROM listing.listing l
       WHERE (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)
         AND (${status}::text IS NULL OR l.status::text = ${status})
         AND (${skuId}::uuid  IS NULL OR l.sku_id = ${skuId}::uuid)
         AND (${grade}::text  IS NULL OR l.grade::text = ${grade})
         AND (NOT ${corrected} OR EXISTS (
               SELECT 1 FROM listing.grade_correction gc
                WHERE gc.listing_id = l.id
                  AND gc.vendor_responded_at IS NULL
                  AND gc.auto_applied_at IS NULL))`;

    return {
      rows: rows.map(toListing),
      total: Number(count?.n ?? 0),
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  /**
   * Attach serials to a listing, in one statement, and report the ones the
   * database would not take.
   *
   * `ON CONFLICT DO NOTHING` is doing the important work. `uq_unit_active_serial`
   * is a partial unique index over every vendor's stock, and the honest way to
   * obey it is to let Postgres arbitrate: the serials that come back from
   * RETURNING are ours, the ones that do not are live somewhere else on the
   * platform. Checking first and then inserting leaves a race exactly wide
   * enough for two vendors pasting the same stolen serial in the same second,
   * and inserting one row at a time to catch each 23505 individually is 5,000
   * round trips for the case the wizard exists to make fast.
   *
   * The catch is not decoration. If that ON CONFLICT clause is ever removed,
   * this failure must still reach the vendor as a sentence about a serial rather
   * than as a 500.
   *
   * No `stock_movement` row is written here. A unit's first transition is
   * CREATED -> AWAITING_QC at submit, and `stock_movement` is append-only — a
   * movement recorded at creation could never be removed again when a vendor
   * fixes a mistyped serial before submitting, leaving a permanent trail for a
   * machine that never existed.
   */
  /**
   * The vendor's letter for the city they dispatch from.
   *
   * Anonymity is the whole point of this column: a buyer sees
   * "Supply Point A - Gurugram" and never a vendor name. The letter is assigned
   * PER CITY, so one vendor is a different letter in Noida than in Gurugram and
   * two vendors in one city can never share one. That is why this resolves
   * through listing.assign_supply_point rather than choosing a label here — the
   * register of assignments belongs to that function, and a second place that
   * invents labels is a second identity for the same vendor.
   *
   * A pickup address with no city cannot be labelled, and an unlabelled unit
   * silently vanishes from the buyer's board. So this refuses and names the fix
   * rather than writing a NULL that surfaces as missing stock weeks later.
   */
  private async supplyPointFor(vendorOrgId: string, addressId: string): Promise<string> {
    const [address] = await this.prisma.$queryRaw<Array<{ city: string | null }>>`
      SELECT city FROM identity.org_address WHERE id = ${addressId}::uuid`;

    const city = address?.city?.trim();
    if (!city) {
      throw new PreconditionFailedError(
        "This listing's pickup address has no city on it, so we cannot give it a supply-point " +
          'label. Buyers see that label instead of your name, so we will not publish stock ' +
          'without one. Add the city to that address and submit again.',
        { addressId, reason: 'pickup_address_has_no_city' },
      );
    }

    const [assigned] = await this.prisma.$queryRaw<Array<{ assign_supply_point: string }>>`
      SELECT listing.assign_supply_point(${vendorOrgId}::uuid, ${city})`;
    return assigned!.assign_supply_point;
  }

  async addUnits(listingId: string, serials: readonly string[]): Promise<AddUnitsResult> {
    const wanted = [...new Set(serials)];
    if (wanted.length === 0) return { added: [], rejected: [] };

    return this.prisma.runInTransaction(async () => {
      // FOR UPDATE so a concurrent reprice cannot land between reading the ask
      // and writing it onto the new units.
      const [listing] = await this.prisma.$queryRaw<
        Array<{
          sku_id: string;
          grade: string;
          vendor_org_id: string;
          unit_price: unknown;
          pickup_location_id: string;
        }>
      >`
        SELECT sku_id, grade, vendor_org_id, unit_price, pickup_location_id
          FROM listing.listing WHERE id = ${listingId}::uuid FOR UPDATE`;
      if (!listing) return { added: [], rejected: [] };
      this.scope.assertOwns(listing.vendor_org_id, 'listing');

      // The supply-point label, stamped at creation.
      //
      // publicBoardUnits joins supply_point ON code AND filters
      // `supply_point_code IS NOT NULL`, so a unit without one is SELLABLE AND
      // INVISIBLE — it passes QC, goes LISTED, counts as stock, and never
      // appears on the comparison board a buyer actually shops from. Nothing in
      // the product set this column: listing.assign_supply_point existed from
      // the first migration and only the SEED had ever called it, which is why
      // every seeded unit had a label and every unit created through the
      // product did not.
      //
      // The function is idempotent — it returns the vendor's existing letter for
      // that city, or assigns a free one — so calling it per batch is correct
      // rather than merely safe. The city is read as a single-table select, not
      // a join, because identity owns that address (and `facilityAt` in
      // submit.service reads vendor.vendor_facility the same way).
      const supplyPointCode = await this.supplyPointFor(
        listing.vendor_org_id,
        listing.pickup_location_id,
      );

      let inserted: Array<{ serial_number: string }>;
      try {
        inserted = await this.prisma.$queryRaw<Array<{ serial_number: string }>>`
          INSERT INTO listing.unit
            (serial_number, listing_id, vendor_org_id, sku_id, grade_declared, vendor_ask_price,
             supply_point_code)
          SELECT s, ${listingId}::uuid, ${listing.vendor_org_id}::uuid, ${listing.sku_id}::uuid,
                 ${listing.grade}::public.grade_type, ${String(listing.unit_price)}::numeric,
                 ${supplyPointCode}
            FROM unnest(${wanted}::text[]) AS s
          ON CONFLICT DO NOTHING
          RETURNING serial_number`;
      } catch (e) {
        if (sqlState(e) === '23505') {
          throw new ConflictError(
            'One of those serial numbers is already registered on the platform. A laptop can be listed in exactly one place at a time.',
            { listingId },
          );
        }
        throw e;
      }

      // qty_total is recounted, never incremented. The other four counters are
      // maintained from the units themselves by trg_listing_counters, and a
      // counter that drifts from its units is how you oversell — so the one
      // counter the trigger does not own is derived the same way.
      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET qty_total  = (SELECT count(*) FROM listing.unit WHERE listing_id = ${listingId}::uuid),
               updated_at = ${this.clock.now()}
         WHERE id = ${listingId}::uuid`;

      const added = new Set(inserted.map((r) => r.serial_number));
      const rejected: SerialIssue[] = wanted
        .map((serial, i) => ({ serial, line: i + 1 }))
        .filter(({ serial }) => !added.has(serial))
        .map(({ serial, line }) => ({
          line,
          serial,
          message:
            'Already listed and live elsewhere. A serial can be active in exactly one place.',
        }));

      return { added: [...added], rejected };
    });
  }

  async findUnits(listingId: string): Promise<UnitRow[]> {
    const { orgId, isPlatform } = this.orgPredicate();
    const rows = await this.prisma.$queryRaw<RawUnit[]>`
      SELECT u.id, u.serial_number, u.listing_id, u.vendor_org_id, u.sku_id,
             u.grade_declared, u.grade_actual, u.status, u.is_sellable, u.location,
             u.vendor_ask_price, u.qc_passed_at, u.qc_valid_until, u.created_at,
             -- The same predicate the reprice handler updates on, read back so the
             -- screen can name the machines it will not move BEFORE the vendor
             -- commits, rather than after a trigger refuses one.
             (u.purchase_price IS NOT NULL) AS payout_locked
        FROM listing.unit u
       WHERE u.listing_id = ${listingId}::uuid
         AND (${isPlatform} OR u.vendor_org_id = ${orgId}::uuid)
       ORDER BY u.created_at, u.serial_number`;
    return rows.map(toUnit);
  }

  /**
   * Take a serial back off a listing.
   *
   * Only while the unit is still CREATED. Once an inspection has been requested
   * the unit is on somebody's visit sheet, and deleting it would silently shrink
   * a job a technician is already travelling to.
   */
  async removeUnit(listingId: string, unitId: string): Promise<boolean> {
    const { orgId, isPlatform } = this.orgPredicate();
    return this.prisma.runInTransaction(async () => {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM listing.unit u
         WHERE u.id = ${unitId}::uuid
           AND u.listing_id = ${listingId}::uuid
           AND u.status = 'CREATED'
           AND (${isPlatform} OR u.vendor_org_id = ${orgId}::uuid)`;
      if (deleted === 0) return false;

      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET qty_total  = (SELECT count(*) FROM listing.unit WHERE listing_id = ${listingId}::uuid),
               updated_at = ${this.clock.now()}
         WHERE id = ${listingId}::uuid`;
      return true;
    });
  }

  /**
   * Which of these serials are live somewhere on the platform right now.
   *
   * Deliberately NOT org-scoped: `uq_unit_active_serial` spans every vendor, and
   * a check that only looked at your own stock would report a serial free right
   * up until the insert said otherwise. It returns serials and nothing else —
   * never the holder, never a listing id — because "who has it" is precisely the
   * vendor-identity leak VR-099 forbids.
   */
  async findLiveSerials(serials: readonly string[]): Promise<string[]> {
    if (serials.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Array<{ serial_number: string }>>`
      SELECT DISTINCT u.serial_number
        FROM listing.unit u
       WHERE u.serial_number = ANY(${[...serials]}::text[])
         AND u.status NOT IN ('RETURNED_TO_VENDOR', 'SCRAPPED')`;
    return rows.map((r) => r.serial_number);
  }

  // -------------------------------------------------------------------------
  // Tier prices
  // -------------------------------------------------------------------------
  //
  // These are BUYER-facing amounts: `listing_tier_price.unit_price` is the
  // quantity-banded twin of `listing.unit_price`, so under the net-payout model
  // a tier discount comes out of our margin and not out of what the vendor is
  // owed. The CRUD lives here because this repository owns the table; nothing on
  // the vendor controller reaches it.

  async findTierPrices(listingId: string): Promise<TierPriceRow[]> {
    const { orgId, isPlatform } = this.orgPredicate();
    const rows = await this.prisma.$queryRaw<RawTier[]>`
      SELECT t.id, t.listing_id, t.min_qty, t.max_qty, t.unit_price
        FROM listing.listing_tier_price t
        JOIN listing.listing l ON l.id = t.listing_id
       WHERE t.listing_id = ${listingId}::uuid
         AND (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)
       ORDER BY t.min_qty`;
    return rows.map(toTier);
  }

  /**
   * Add one band.
   *
   * `excl_tier_overlap` is a GiST EXCLUDE constraint and it fires as 23P01 with
   * a message naming an int4range — accurate, and no use at all to the person
   * who typed "50–100" under an existing "40–80". The rule is restated in their
   * terms, with the band they sent, so they can see the collision.
   */
  async addTierPrice(input: {
    listingId: string;
    minQty: number;
    maxQty: number | null;
    unitPrice: Money;
  }): Promise<TierPriceRow> {
    try {
      const rows = await this.prisma.$queryRaw<RawTier[]>`
        INSERT INTO listing.listing_tier_price (listing_id, min_qty, max_qty, unit_price)
        VALUES (${input.listingId}::uuid, ${input.minQty}, ${input.maxQty}::int,
                ${input.unitPrice.toString()}::numeric)
        RETURNING id, listing_id, min_qty, max_qty, unit_price`;
      return toTier(rows[0]!);
    } catch (e) {
      if (sqlState(e) === '23P01') {
        throw new ConflictError(
          `Quantity bands cannot overlap. ${input.minQty}–${input.maxQty ?? 'any'} covers quantities another band on this listing already prices.`,
          { listingId: input.listingId, minQty: input.minQty, maxQty: input.maxQty },
        );
      }
      throw e;
    }
  }

  async removeTierPrice(listingId: string, tierId: string): Promise<boolean> {
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM listing.listing_tier_price
       WHERE id = ${tierId}::uuid AND listing_id = ${listingId}::uuid`;
    return deleted > 0;
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  async addImage(input: {
    listingId: string;
    fileKey: string;
    imageType: string;
    hash: string;
  }): Promise<ListingImageRow> {
    const rows = await this.prisma.$queryRaw<RawImage[]>`
      INSERT INTO listing.listing_image (listing_id, file_key, image_type, hash)
      VALUES (${input.listingId}::uuid, ${input.fileKey}, ${input.imageType}, ${input.hash})
      RETURNING id, listing_id, file_key, image_type, hash, uploaded_at`;
    return toImage(rows[0]!);
  }

  async findImages(listingId: string): Promise<ListingImageRow[]> {
    const { orgId, isPlatform } = this.orgPredicate();
    const rows = await this.prisma.$queryRaw<RawImage[]>`
      SELECT i.id, i.listing_id, i.file_key, i.image_type, i.hash, i.uploaded_at
        FROM listing.listing_image i
        JOIN listing.listing l ON l.id = i.listing_id
       WHERE i.listing_id = ${listingId}::uuid
         AND (${isPlatform} OR l.vendor_org_id = ${orgId}::uuid)
       ORDER BY i.uploaded_at`;
    return rows.map(toImage);
  }

  async removeImage(listingId: string, imageId: string): Promise<boolean> {
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM listing.listing_image
       WHERE id = ${imageId}::uuid AND listing_id = ${listingId}::uuid`;
    return deleted > 0;
  }

  // -------------------------------------------------------------------------
  // The public read path — no principal, therefore no org predicate
  // -------------------------------------------------------------------------

  /**
   * Every sellable unit of one SKU, with the facts the comparison board ranks
   * on. **Unscoped on purpose**: the caller is an anonymous buyer, and
   * `OrgScope` says in as many words that a public endpoint must come through a
   * public repository method rather than through a scoped one with the guard
   * turned off.
   *
   * `vendor_org_id`, `vendor_ask_price`, `purchase_price` and `margin_rule_id`
   * are all in `v_sellable_unit` and none of them is selected. The org id is
   * used once, inside the JOIN, to resolve the supply point — and the
   * `(code, city)` pair it produces is the only thing about the source that
   * leaves this method.
   *
   * `supply_point` is joined on `(vendor_org_id, code)` and never on `code`
   * alone: the code is unique within a city, so two vendors in two cities can
   * both be "F", and joining on the code alone would attribute one vendor's
   * stock to another.
   */
  async publicBoardUnits(skuId: string): Promise<PublicBoardUnit[]> {
    const rows = await this.prisma.$queryRaw<RawBoardUnit[]>`
      SELECT u.id, u.serial_number, u.listing_id,
             u.grade_actual::text        AS grade,
             u.retail_price, u.battery_health_pct, u.qc_score,
             u.qc_passed_at, u.qc_valid_until,
             u.valuation_method, u.supply_point_code, sp.city,
             l.dispatch_sla_hours, l.gst_rate, l.pickup_location_id
        FROM listing.v_sellable_unit u
        JOIN listing.supply_point sp
             ON sp.vendor_org_id = u.vendor_org_id
            AND sp.code = u.supply_point_code
        JOIN listing.listing l ON l.id = u.listing_id
       WHERE u.sku_id = ${skuId}::uuid
         AND u.grade_actual IS NOT NULL
         AND u.retail_price IS NOT NULL
         AND u.supply_point_code IS NOT NULL`;

    return rows.map((r) => ({
      id: r.id,
      serialNumber: r.serial_number,
      listingId: r.listing_id,
      grade: r.grade as Grade,
      retailPrice: moneyFromDb(r.retail_price as string) ?? Money.ZERO,
      // Never coerced to zero. A battery nobody measured must not render as a
      // dead one, and there is no way back from a 0 written here.
      batteryHealthPct: r.battery_health_pct === null ? null : Number(r.battery_health_pct),
      qcScore: r.qc_score === null ? null : Number(r.qc_score),
      qcPassedAt: r.qc_passed_at,
      qcValidUntil: r.qc_valid_until,
      valuationMethod: r.valuation_method === 'MARGIN' ? 'MARGIN' : 'REGULAR',
      supplyPointCode: r.supply_point_code ?? '',
      city: r.city ?? '',
      dispatchSlaHours: Number(r.dispatch_sla_hours),
      gstRatePct: Number(r.gst_rate),
      pickupLocationId: r.pickup_location_id,
    }));
  }

  /**
   * The dispatch pincode behind each pickup address.
   *
   * A separate statement rather than a JOIN, because `org_address` is
   * `identity`'s table and this module may not join across the seam
   * (`createDraft` reads it the same way, for the same reason). The pincode is
   * freight input only: it is finer than a city, so it is resolved here and
   * never returned to a buyer.
   */
  async pickupPincodes(addressIds: readonly string[]): Promise<Map<string, string>> {
    if (addressIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; pincode: string }>>`
      SELECT id, pincode FROM identity.org_address WHERE id = ANY(${[...addressIds]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.pincode.trim()]));
  }

  /**
   * What pricing needs to quote a public offer, per listing.
   *
   * **`vendorAskPrice` is in here and must not leave `listing`.** It is present
   * for one reason: the margin rule that decides how many months of warranty we
   * add on top of the vendor's own is banded on the ask, so the term the
   * customer is sold cannot be computed without it. The ask itself is not part
   * of any answer this module gives a buyer.
   */
  async publicPricingFacts(listingIds: readonly string[]): Promise<Map<string, PublicPricingFacts>> {
    if (listingIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sku_id: string;
        grade: string;
        unit_price: unknown;
        gst_rate: unknown;
        vendor_warranty_months: number;
        vendor_ask_price: unknown;
      }>
    >`
      SELECT l.id, l.sku_id, l.grade::text AS grade, l.unit_price, l.gst_rate,
             l.vendor_warranty_months,
             COALESCE((SELECT max(u.vendor_ask_price) FROM listing.unit u WHERE u.listing_id = l.id),
                      l.unit_price) AS vendor_ask_price
        FROM listing.listing l
       WHERE l.id = ANY(${[...listingIds]}::uuid[])`;

    return new Map(
      rows.map((r) => [
        r.id,
        {
          listingId: r.id,
          skuId: r.sku_id,
          grade: r.grade as Grade,
          sellingPrice: moneyFromDb(r.unit_price as string) ?? Money.ZERO,
          gstRatePct: Number(r.gst_rate),
          vendorWarrantyMonths: Number(r.vendor_warranty_months),
          vendorAskPrice: moneyFromDb(r.vendor_ask_price as string) ?? Money.ZERO,
        },
      ]),
    );
  }

}
