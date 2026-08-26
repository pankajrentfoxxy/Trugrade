import { Injectable } from '@nestjs/common';
import { LISTING_QTY, type Money, type SerialBatch } from '@trugrade/contracts';
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
  qcPassedAt: Date | null;
  qcValidUntil: Date | null;
  createdAt: Date;
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

  dryRunSerialCsv(csv: string, brandName?: string | null): Promise<SerialCsvReport> {
    return this.serials.dryRunCsv(csv, brandName);
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
    qcPassedAt: u.qcPassedAt,
    qcValidUntil: u.qcValidUntil,
    createdAt: u.createdAt,
  };
}
