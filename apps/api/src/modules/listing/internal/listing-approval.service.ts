import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money, moneyFromDb, type Grade } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { EventBus } from '../../../shared/events/event-bus';
import {
  IllegalStateTransitionError,
  NotFoundError,
} from '../../../shared/errors/domain-errors';
import { ListingRepository, type ListingStatus } from './listing.repository';
import { PricingService } from './pricing.service';

/**
 * Ops' gate in front of the storefront.
 *
 * A vendor submits a declared quantity of a machine at a grade and a price,
 * with no serials and no inspection. This is where somebody who works here
 * looks at it before a buyer can. Approving makes the declared quantity
 * available; nothing is inspected until a buyer orders, when a technician is
 * sent for exactly the machines ordered.
 *
 * **This screen shows the vendor.** It is ops-only (`listing.any.*`, which no
 * tenant role holds), and the person approving a listing needs to know whose
 * it is. The public reads of the same row go through `publicBoardOffers` and
 * carry a supply-point label instead.
 *
 * **The price flag is the pricing service's, not a second opinion.** A row is
 * flagged when the floor guard that `approve` runs would refuse it (the selling
 * price earns less than the floor margin and no override is recorded), when no
 * margin rule prices it at all, or when the price-band check marked it far
 * below the trailing median. The first two are the same computation `approve`
 * makes, run ahead of time so the queue can say "review this one" instead of
 * letting Approve fail.
 */

export interface OpsListingPriceFlag {
  /**
   * `below_floor`: `approve` will refuse it. `unpriced`: no rule prices this
   * machine, so it cannot be approved either. `below_band`: far under the
   * 30-day median for the configuration — a warning, never a block.
   */
  reason: 'below_floor' | 'unpriced' | 'below_band';
  floorPrice: string | null;
  bandMedian: string | null;
  bandRatio: number | null;
}

export interface OpsListingRow {
  listingId: string;
  status: ListingStatus;
  vendorOrgId: string;
  vendorLegalName: string | null;
  /** "Dell Latitude 5420 · i5-1145G7 · 16 GB · 512 GB SSD". Null when withdrawn. */
  title: string | null;
  specSummary: string | null;
  grade: Grade;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  /** What the vendor wants per machine. */
  vendorAskPrice: string | null;
  /**
   * Our selling price after the margin rule ran. Null while the listing is a
   * DRAFT — `unit_price` still holds the ask then and must not be read as ours.
   */
  sellingPrice: string | null;
  /** True when only an ops floor override can take this listing live. */
  belowFloor: boolean;
  priceFlag: OpsListingPriceFlag | null;
  pickupCity: string | null;
  submittedAt: string;
  createdAt: string;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface OpsListingFacet {
  value: string;
  label: string;
  count: number;
}

export interface OpsListingBoard {
  rows: OpsListingRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  /** Under the current filter: how many machines, and what they would fetch at our prices. */
  totals: { units: number; value: string };
  /** How many rows under the current status, search and vendor carry a price flag. */
  flagged: number;
  facets: { status: OpsListingFacet[]; vendor: OpsListingFacet[] };
}

export type OpsListingSort = 'oldest' | 'newest' | 'units' | 'value';

export interface OpsListingListQuery {
  status?: ListingStatus;
  /** Matches a model name, a SKU code or a vendor's legal name. */
  q?: string;
  vendor?: string;
  sort?: OpsListingSort;
  flagged?: boolean;
  page: number;
  per: number;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  ACTIVE: 'Live',
  PARTIALLY_ACTIVE: 'Live',
  PAUSED: 'Paused',
  OUT_OF_STOCK: 'Sold out',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
  DELISTED: 'Delisted',
  AWAITING_QC: 'Awaiting QC',
  QC_IN_PROGRESS: 'QC in progress',
};

/** How many waiting listings the floor guard is run over per request. */
const FLOOR_CHECK_CAP = 100;

interface RawRow {
  id: string;
  status: string;
  vendor_org_id: string;
  sku_id: string;
  grade: string;
  qty_total: number;
  qty_available: number;
  qty_reserved: number;
  unit_price: unknown;
  vendor_ask_price: unknown;
  pickup_location_id: string;
  updated_at: Date;
  created_at: Date;
  approved_at: Date | null;
  rejection_reason: string | null;
  floor_override_at: Date | null;
  price_band_flagged_at: Date | null;
  price_band_median: unknown;
  price_band_ratio: unknown;
}

interface FloorVerdict {
  reason: 'below_floor' | 'unpriced';
  floorPrice: string | null;
}

const ROW_COLUMNS = Prisma.sql`
  l.id, l.status::text AS status, l.vendor_org_id, l.sku_id, l.grade::text AS grade,
  l.qty_total, l.qty_available, l.qty_reserved, l.unit_price, l.vendor_ask_price,
  l.pickup_location_id, l.updated_at, l.created_at, l.approved_at,
  l.rejection_reason, l.floor_override_at,
  l.price_band_flagged_at, l.price_band_median, l.price_band_ratio`;

@Injectable()
export class ListingApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly listings: ListingRepository,
    private readonly pricing: PricingService,
    private readonly bus: EventBus,
  ) {}

  async list(query: OpsListingListQuery): Promise<OpsListingBoard> {
    const status = query.status ?? null;
    const vendor = query.vendor ?? null;
    const sort: OpsListingSort = query.sort ?? 'oldest';
    const q = query.q?.trim() || null;
    const like = q === null ? null : `%${q.replace(/[%_\\]/g, '\\$&')}%`;

    // A model name lives in `catalog` and a vendor's name in `identity`, so
    // each is resolved in its own schema first and handed to this one's query
    // as ids — `no-cross-schema-join` forbids the join that would be one statement.
    const [skuIds, vendorIds] =
      like === null
        ? [[] as string[], [] as string[]]
        : await Promise.all([this.skusMatching(like), this.vendorsMatching(like)]);

    // The floor guard, run ahead of Approve. Only listings that are waiting
    // can be approved, so only they are checked.
    const floors = await this.floorsForWaiting(status);
    const floorIds = [...floors.keys()];

    const flag = Prisma.sql`(l.price_band_flagged_at IS NOT NULL OR l.id = ANY(${floorIds}::uuid[]))`;
    const base = Prisma.sql`(${status}::text IS NULL OR l.status::text = ${status})
      AND (${vendor}::uuid IS NULL OR l.vendor_org_id = ${vendor}::uuid)
      AND (${like}::text IS NULL
           OR l.sku_id = ANY(${skuIds}::uuid[])
           OR l.vendor_org_id = ANY(${vendorIds}::uuid[]))`;
    const where = query.flagged ? Prisma.sql`${base} AND ${flag}` : base;

    const [[counted], [flaggedCount]] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number; units: number; value: string }>>`
        SELECT count(*)::int AS total,
               coalesce(sum(l.qty_total), 0)::int AS units,
               coalesce(sum(l.qty_total * l.unit_price), 0)::text AS value
          FROM listing.listing l
         WHERE ${where}`,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM listing.listing l WHERE ${base} AND ${flag}`,
    ]);
    const total = counted?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / query.per));
    const page = Math.min(query.page, pages);

    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT ${ROW_COLUMNS}
        FROM listing.listing l
       WHERE ${where}
       -- Waiting first, then the chosen order; the default is the order it
       -- arrived, because the queue is worked oldest first.
       ORDER BY CASE WHEN l.status = 'PENDING_APPROVAL' THEN 0 ELSE 1 END,
                CASE WHEN ${sort}::text = 'newest' THEN l.updated_at END DESC NULLS LAST,
                CASE WHEN ${sort}::text = 'units' THEN l.qty_total END DESC NULLS LAST,
                CASE WHEN ${sort}::text = 'value' THEN l.qty_total * l.unit_price END DESC NULLS LAST,
                l.updated_at ASC
       LIMIT ${query.per} OFFSET ${(page - 1) * query.per}`;

    const [skus, vendors, cities, statusFacet, vendorFacet] = await Promise.all([
      this.listings.skuDetails(rows.map((r) => r.sku_id)),
      this.vendorNames(rows.map((r) => r.vendor_org_id)),
      this.pickupCities(rows.map((r) => r.pickup_location_id)),
      this.statusFacet(),
      this.vendorFacet(status),
    ]);

    return {
      rows: rows.map((r) => this.toRow(r, { skus, vendors, cities, floors })),
      total,
      page,
      per: query.per,
      pages,
      totals: { units: counted?.units ?? 0, value: counted?.value ?? '0.00' },
      flagged: flaggedCount?.n ?? 0,
      facets: { status: statusFacet, vendor: vendorFacet },
    };
  }

  /**
   * Put the declared quantity on sale.
   *
   * The floor guard runs first: a listing that earns less than the floor margin
   * needs the pricing override, not a quiet approval. `qty_available` becomes
   * the declared total less anything already reserved — which is zero for a
   * fresh listing and nonzero only for one re-approved after a pause.
   */
  async approve(listingId: string): Promise<OpsListingRow> {
    await this.prisma.runInTransaction(async () => {
      const row = await this.lock(listingId);
      if (row.status !== 'PENDING_APPROVAL') {
        throw new IllegalStateTransitionError('listing', row.status, 'ACTIVE');
      }
      await this.pricing.assertActivatable(listingId);

      const now = this.clock.now();
      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET status           = 'ACTIVE',
               approved_by      = ${this.ctx.principal?.userId ?? null}::uuid,
               approved_at      = ${now},
               rejected_at      = NULL,
               rejection_reason = NULL,
               qty_available    = GREATEST(qty_total - qty_reserved, 0),
               updated_at       = ${now}
         WHERE id = ${listingId}::uuid`;

      await this.bus.publish('listing.published', {
        listingId,
        skuId: row.sku_id,
        sellableUnitCount: Math.max(row.qty_total - row.qty_reserved, 0),
        partial: false,
      });
    });
    return this.one(listingId);
  }

  async reject(listingId: string, reason: string): Promise<OpsListingRow> {
    await this.prisma.runInTransaction(async () => {
      const row = await this.lock(listingId);
      if (row.status !== 'PENDING_APPROVAL') {
        throw new IllegalStateTransitionError('listing', row.status, 'REJECTED');
      }
      const now = this.clock.now();
      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET status           = 'REJECTED',
               rejected_at      = ${now},
               rejection_reason = ${reason},
               qty_available    = 0,
               updated_at       = ${now}
         WHERE id = ${listingId}::uuid`;
    });
    return this.one(listingId);
  }

  // -------------------------------------------------------------------------

  private async lock(listingId: string): Promise<RawRow> {
    const [row] = await this.prisma.$queryRaw<RawRow[]>`
      SELECT ${ROW_COLUMNS} FROM listing.listing l WHERE l.id = ${listingId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundError('listing', { listingId });
    return row;
  }

  private async one(listingId: string): Promise<OpsListingRow> {
    const [r] = await this.prisma.$queryRaw<RawRow[]>`
      SELECT ${ROW_COLUMNS} FROM listing.listing l WHERE l.id = ${listingId}::uuid`;
    if (!r) throw new NotFoundError('listing', { listingId });
    const [skus, vendors, cities] = await Promise.all([
      this.listings.skuDetails([r.sku_id]),
      this.vendorNames([r.vendor_org_id]),
      this.pickupCities([r.pickup_location_id]),
    ]);
    const floors = new Map<string, FloorVerdict>();
    if (r.status === 'PENDING_APPROVAL' && r.floor_override_at === null) {
      const verdict = await this.floorVerdict(r.id);
      if (verdict) floors.set(r.id, verdict);
    }
    return this.toRow(r, { skus, vendors, cities, floors });
  }

  private toRow(
    r: RawRow,
    parts: {
      skus: Awaited<ReturnType<ListingRepository['skuDetails']>>;
      vendors: Map<string, string>;
      cities: Map<string, string>;
      floors: Map<string, FloorVerdict>;
    },
  ): OpsListingRow {
    const sku = parts.skus.get(r.sku_id);
    const floor = parts.floors.get(r.id) ?? null;
    const bandMedian = moneyFromDb(r.price_band_median as string | null)?.toString() ?? null;
    const priceFlag: OpsListingPriceFlag | null = floor
      ? { reason: floor.reason, floorPrice: floor.floorPrice, bandMedian, bandRatio: null }
      : r.price_band_flagged_at
        ? {
            reason: 'below_band',
            floorPrice: null,
            bandMedian,
            bandRatio: r.price_band_ratio === null ? null : Number(r.price_band_ratio),
          }
        : null;
    return {
      listingId: r.id,
      status: r.status as ListingStatus,
      vendorOrgId: r.vendor_org_id,
      vendorLegalName: parts.vendors.get(r.vendor_org_id) ?? null,
      title: sku ? `${sku.brandName} ${sku.modelName}`.trim() : null,
      specSummary: sku
        ? [sku.cpuModel, `${sku.ramGb} GB`, `${sku.storageGb} GB ${sku.storageType}`].join(' · ')
        : null,
      grade: r.grade as Grade,
      qtyTotal: r.qty_total,
      qtyAvailable: r.qty_available,
      qtyReserved: r.qty_reserved,
      vendorAskPrice: moneyFromDb(r.vendor_ask_price as string | null)?.toString() ?? null,
      sellingPrice:
        r.status === 'DRAFT' ? null : (moneyFromDb(r.unit_price as string)?.toString() ?? null),
      belowFloor: floor?.reason === 'below_floor',
      priceFlag,
      pickupCity: parts.cities.get(r.pickup_location_id) ?? null,
      submittedAt: r.updated_at.toISOString(),
      createdAt: r.created_at.toISOString(),
      approvedAt: r.approved_at?.toISOString() ?? null,
      rejectionReason: r.rejection_reason,
    };
  }

  /**
   * The floor guard over every waiting listing, ahead of Approve.
   *
   * Only when the board is showing what is waiting: no other status can be
   * approved, so no other status needs the answer. Capped, because the guard
   * resolves a margin rule per listing; a queue past the cap is a queue that
   * needs working, not measuring.
   */
  private async floorsForWaiting(status: string | null): Promise<Map<string, FloorVerdict>> {
    const out = new Map<string, FloorVerdict>();
    if (status !== null && status !== 'PENDING_APPROVAL') return out;
    const waiting = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.listing
       WHERE status = 'PENDING_APPROVAL' AND floor_override_at IS NULL
       ORDER BY updated_at ASC
       LIMIT ${FLOOR_CHECK_CAP}`;
    for (const { id } of waiting) {
      const verdict = await this.floorVerdict(id);
      if (verdict) out.set(id, verdict);
    }
    return out;
  }

  /** What `approve`'s guard would say about one listing, without approving it. */
  private async floorVerdict(listingId: string): Promise<FloorVerdict | null> {
    try {
      const { floorPrice, belowFloor } = await this.pricing.floorOf(listingId);
      return belowFloor ? { reason: 'below_floor', floorPrice: floorPrice.toString() } : null;
    } catch {
      // No margin rule, or no ask to price from: Approve would fail the same
      // way, so the row is flagged rather than left looking approvable.
      return { reason: 'unpriced', floorPrice: null };
    }
  }

  /** Model name or SKU code → sku ids. `catalog` only. */
  private async skusMatching(like: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
        FROM catalog.sku s
        JOIN catalog.model  m  ON m.id  = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand  b  ON b.id  = se.brand_id
       WHERE s.sku_code ILIKE ${like}
          OR m.name ILIKE ${like}
          OR (b.name || ' ' || m.name) ILIKE ${like}
       LIMIT 500`;
    return rows.map((r) => r.id);
  }

  /** Legal name → org ids. `identity` only. */
  private async vendorsMatching(like: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.organization WHERE legal_name ILIKE ${like} LIMIT 200`;
    return rows.map((r) => r.id);
  }

  /** `identity.organization` in its own statement: a different module's table. */
  private async vendorNames(orgIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(orgIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id, legal_name FROM identity.organization WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.legal_name]));
  }

  private async pickupCities(addressIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(addressIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; city: string }>>`
      SELECT id, city FROM identity.org_address WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.city]));
  }

  private async statusFacet(): Promise<OpsListingFacet[]> {
    const rows = await this.prisma.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT status::text AS status, count(*)::int AS n
        FROM listing.listing GROUP BY status`;
    const counts = new Map(rows.map((r) => [r.status, r.n]));
    // Every status the board can filter on, zero included, so a chip never
    // vanishes because the queue happens to be empty.
    return ['PENDING_APPROVAL', 'ACTIVE', 'PARTIALLY_ACTIVE', 'PAUSED', 'REJECTED', 'DRAFT'].map(
      (value) => ({ value, label: STATUS_LABEL[value] ?? value, count: counts.get(value) ?? 0 }),
    );
  }

  /** The vendors with listings in the current status, so the dropdown offers only real choices. */
  private async vendorFacet(status: string | null): Promise<OpsListingFacet[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; n: number }>>`
      SELECT l.vendor_org_id::text AS value, count(*)::int AS n
        FROM listing.listing l
       WHERE (${status}::text IS NULL OR l.status::text = ${status})
       GROUP BY l.vendor_org_id`;
    const names = await this.vendorNames(rows.map((r) => r.value));
    return rows
      .map((r) => ({
        value: r.value,
        label: names.get(r.value) ?? 'A supply point no longer on the platform',
        count: r.n,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

/** Re-exported so the controller can type its money without reaching into contracts twice. */
export type { Money };
