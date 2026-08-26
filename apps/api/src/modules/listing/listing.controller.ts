import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  gradeSchema,
  invoiceNumberSchema,
  retailPriceSchema,
  uuidSchema,
  vendorNetPayoutSchema,
  type SerialBatch,
} from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { OrgScope } from '../../shared/db/org-scope';
import { PrismaService } from '../../shared/db/prisma.service';
import { PreconditionFailedError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  ListingService,
  type AddUnitsOutcome,
  type VendorImageView,
  type VendorListingView,
  type VendorUnitView,
} from './listing.service';
import type { ListingStatus, Page } from './internal/listing.repository';
import { PricingService, type VendorPayoutPreview } from './internal/pricing.service';
import { SourcingService, type SourcingDeclarationView } from './internal/sourcing.service';
import { SubmitService, type SubmitResult } from './internal/submit.service';
import type { SerialCsvReport } from './internal/serial.service';
import {
  addListingImageSchema,
  addUnitsSchema,
  createListingDraftSchema,
  listListingsQuerySchema,
  listingStatusSchema,
  updateListingDraftSchema,
  validateSerialsCsvSchema,
  validateSerialsSchema,
  type AddListingImageDto,
  type AddUnitsDto,
  type CreateListingDraftDto,
  type ListListingsQueryDto,
  type UpdateListingDraftDto,
  type ValidateSerialsCsvDto,
  type ValidateSerialsDto,
} from './dto/listing.dto';

/**
 * The request shapes for the routes below.
 *
 * They live beside their handlers rather than in `dto/listing.dto.ts` because
 * each is the shape of exactly one request and nothing else in the module reads
 * them; the shared primitives still come from `@trugrade/contracts`, so the
 * client and the server run the identical constant (VR-META-01).
 */

/**
 * Whichever way the vendor's account prices, in the vendor's own words.
 *
 * Both arms are accepted at the transport and only one is accepted per account:
 * `PricingService.resolveAsk` refuses a mode that disagrees with the stored
 * preference, with the sentence that tells them which one they are on. Deciding
 * that here would put a second copy of the rule in front of the first.
 */
const askSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('NET_PAYOUT'), vendorNetPayout: vendorNetPayoutSchema }),
  z.object({
    mode: z.literal('COMMISSION'),
    expectedSalePrice: retailPriceSchema,
    /** The same 0–50 band `payoutPreferenceCapture` agrees the rate within. */
    commissionPct: z.number().min(0).max(50),
  }),
]);

const payoutPreviewSchema = z.object({
  skuId: uuidSchema,
  grade: gradeSchema,
  vendorWarrantyMonths: z.number().int().min(0).max(24),
  /** VR-080 caps a listing at 5,000 units, so a preview over more is not a batch. */
  units: z.number().int().min(1).max(5000),
  ask: askSchema,
});

/**
 * `choice` is only ever the answer to a DECISION_REQUIRED that came back from an
 * earlier call. Sending it on the first attempt is harmless and ignored, which
 * is what lets the wizard resend the whole request rather than track a state
 * machine across two screens.
 */
const submitListingSchema = z.object({
  choice: z.enum(['HOLD', 'ACCEPT_FEE']).optional(),
});

const repriceSchema = z.object({
  vendorNetPayout: vendorNetPayoutSchema,
  /** Goes onto `price_history`, whose CHECK is `length(btrim(reason)) >= 3`. */
  reason: z.string().trim().min(3).max(280),
});

const bulkStatusSchema = z.object({
  /** One board page's worth. A selection larger than the screen is a different feature. */
  listingIds: z.array(uuidSchema).min(1).max(200),
  action: z.enum(['PAUSE', 'RESUME']),
});

/** Read off the CHECK on `vendor.vendor_sourcing_declaration.source_type`. */
const declareSourcingSchema = z.object({
  sourceType: z.enum([
    'CORPORATE_BUYBACK',
    'LEASE_RETURN',
    'AUCTION',
    'IMPORT',
    'RETAIL_EXCHANGE',
    'OEM_REFURB',
  ]),
  sourceOrgName: z.string().trim().min(1).max(160).nullish(),
  acquisitionInvoiceNo: invoiceNumberSchema.nullish(),
  /** The acquisition, not the declaration. A DATE column, so a plain day. */
  acquisitionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the acquisition date as YYYY-MM-DD.')
    .nullish(),
  supportingDocId: uuidSchema.nullish(),
  itcAvailedOnAcquisition: z.boolean(),
});

type PayoutPreviewDto = z.infer<typeof payoutPreviewSchema>;
type SubmitListingDto = z.infer<typeof submitListingSchema>;
type RepriceDto = z.infer<typeof repriceSchema>;
type BulkStatusDto = z.infer<typeof bulkStatusSchema>;
type DeclareSourcingDto = z.infer<typeof declareSourcingSchema>;

/** What a bulk action did, counted rather than described row by row. */
interface BulkStatusOutcome {
  action: 'PAUSE' | 'RESUME';
  updated: number;
  /** Selected but not in a state the action applies to. Never an error. */
  skipped: number;
}

/**
 * The vendor listing wizard and listing management, over HTTP.
 *
 * Two rules govern every handler here, and both are exit criteria:
 *
 *   1. **A vendor only ever touches their own org's listings.** The permissions
 *      required are the `listing.own.*` pair, but the guard is not the control —
 *      the org predicate is in the SQL, and the org id comes from the session,
 *      never from the request. An id in the path that belongs to somebody else
 *      is simply not found, which is also the right answer to a prober.
 *   2. **No response carries a retail price, a margin, or anything derived from
 *      one.** The service returns view types that do not have the field, so the
 *      guarantee is in the type rather than in the care of whoever writes the
 *      next handler. `PricingService.priceListing` returns the selling price it
 *      just computed; the reprice handler below throws that value away and
 *      re-reads the vendor view, which is the whole reason it does not simply
 *      return what the service handed it.
 *
 * Validation is the shared Zod schema applied per endpoint (VR-META-01) rather
 * than a global pipe, so the client and the server run the identical constant.
 */
@Controller('vendor/listings')
export class ListingController {
  constructor(
    private readonly listings: ListingService,
    private readonly pricing: PricingService,
    private readonly sourcing: SourcingService,
    private readonly submissions: SubmitService,
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
    private readonly clock: ClockPort,
  ) {}

  /**
   * The caller's own listings, and nothing else.
   *
   * `OrgScope.scoped` reads the org id off the session and merges it into the
   * `where`, exactly as the repositories do — this is the same control, reached
   * from the only two handlers in this file that write through Prisma rather
   * than through a service. The cast is because `scoped` is generic over plain
   * objects and Prisma's `where` is a nominal type; it adds a predicate and
   * never removes one.
   */
  private mine<T extends Record<string, unknown>>(where: T): Prisma.listingWhereInput {
    return this.scope.scoped(where, 'vendor_org_id') as Prisma.listingWhereInput;
  }

  // -------------------------------------------------------------------------
  // The wizard: steps 1, 2 and 4
  // -------------------------------------------------------------------------

  @Post()
  @RequirePermissions('listing.own.write')
  createDraft(
    @Body(new ZodValidationPipe(createListingDraftSchema)) body: CreateListingDraftDto,
  ): Promise<VendorListingView> {
    return this.listings.createDraft(body);
  }

  @Get()
  @RequirePermissions('listing.own.read')
  list(
    @Query(new ZodValidationPipe(listListingsQuerySchema)) query: ListListingsQueryDto,
  ): Promise<Page<VendorListingView>> {
    const { page, pageSize, ...filter } = query;
    return this.listings.listForVendor(filter, { page, pageSize });
  }

  // -------------------------------------------------------------------------
  // The board's bulk actions
  //
  // Both sit above `:id` deliberately. Nest matches in declaration order, so
  // `bulk-status` declared after `@Get(':id')` would be swallowed by it and come
  // back as a 422 about a malformed UUID — a route that fails in a way nobody
  // reading the client can explain.
  // -------------------------------------------------------------------------

  /**
   * How the vendor's stock is distributed across the statuses.
   *
   * Every status is present with a zero rather than only the ones with rows, so
   * the board's filter chips and the bulk bar can be rendered from one response
   * without the client deciding what an absent key means.
   */
  @Get('bulk-status')
  @RequirePermissions('listing.own.read')
  async bulkStatusBoard(): Promise<{ counts: Record<string, number>; total: number }> {
    const rows = await this.prisma.db.listing.groupBy({
      by: ['status'],
      where: this.mine({}),
      _count: { _all: true },
    });

    const counts: Record<string, number> = Object.fromEntries(
      listingStatusSchema.options.map((s) => [s, 0]),
    );
    let total = 0;
    for (const row of rows) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }
    return { counts, total };
  }

  /**
   * Pause or resume a selection. 200, not 201: nothing is created.
   *
   * A listing in the selection that is not in a state the action applies to is
   * **skipped, not refused** — the vendor ticked the header checkbox, and
   * failing the whole call because one of forty was already paused would teach
   * them to stop using the checkbox. The counts say what happened.
   *
   * This changes the listing's own status and nothing else. The units keep their
   * QC, their seal and their `is_sellable` flag, because a pause is a selling
   * decision and not a fact about the machines — so what reads the buyer surface
   * has to filter on listing status, which is what `PRICED_STATUSES` in the
   * pricing service already assumes.
   *
   * ponytail: RESUME goes to ACTIVE even for a listing that was PARTIALLY_ACTIVE
   * when it was paused, because nothing remembers which it was. The distinction
   * is a badge on the board — `qty_available` and `qty_awaiting_qc` are
   * maintained by `trg_listing_counters` and are what anything else reads. Give
   * the row a `paused_from` column the day the badge has to be exact.
   */
  @Post('bulk-status')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  async bulkStatus(
    @Body(new ZodValidationPipe(bulkStatusSchema)) body: BulkStatusDto,
  ): Promise<BulkStatusOutcome> {
    const from: ListingStatus[] =
      body.action === 'PAUSE' ? ['ACTIVE', 'PARTIALLY_ACTIVE'] : ['PAUSED'];
    const to: ListingStatus = body.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE';

    const { count } = await this.prisma.db.listing.updateMany({
      where: this.mine({ id: { in: body.listingIds }, status: { in: from } }),
      data: { status: to, updated_at: this.clock.now() },
    });

    return { action: body.action, updated: count, skipped: body.listingIds.length - count };
  }

  @Get(':id')
  @RequirePermissions('listing.own.read')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<VendorListingView> {
    return this.listings.getForVendor(id);
  }

  @Patch(':id')
  @RequirePermissions('listing.own.write')
  updateDraft(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateListingDraftSchema)) body: UpdateListingDraftDto,
  ): Promise<VendorListingView> {
    return this.listings.updateDraft(id, body);
  }

  // -------------------------------------------------------------------------
  // The wizard: step 3, serials
  // -------------------------------------------------------------------------

  /**
   * The live check, called as the vendor types or pastes. It writes nothing, so
   * it is safe to call on every keystroke — which is the point: "already listed"
   * belongs on the screen before submission, not in a rejection afterwards.
   */
  @Post('serials/validate')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  validateSerials(
    @Body(new ZodValidationPipe(validateSerialsSchema)) body: ValidateSerialsDto,
  ): Promise<SerialBatch> {
    return body.serials?.length
      ? this.listings.validateSerials(body.serials, body.brandName)
      : this.listings.validateSerialBlock(body.text ?? '', body.brandName);
  }

  /**
   * The CSV dry run. Writes nothing and reports every row, keyed by the line
   * number in the vendor's own file — the same contract as the SKU importer,
   * because the useful question is never "did it work" but "what is about to
   * happen to my 200 rows".
   *
   * The error report comes back in the same response rather than behind a second
   * download endpoint: it is a few kilobytes of text and the client already has
   * the file open in front of the person who has to fix it.
   */
  @Post('serials/validate-csv')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  async validateSerialsCsv(
    @Body(new ZodValidationPipe(validateSerialsCsvSchema)) body: ValidateSerialsCsvDto,
  ): Promise<SerialCsvReport & { errorReportCsv: string }> {
    const report = await this.listings.dryRunSerialCsv(body.csv, body.brandName);
    return { ...report, errorReportCsv: this.listings.serialErrorReportCsv(report) };
  }

  @Post(':id/units')
  @RequirePermissions('listing.own.write')
  addUnits(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(addUnitsSchema)) body: AddUnitsDto,
  ): Promise<AddUnitsOutcome> {
    return this.listings.addUnits(id, body.serials);
  }

  @Get(':id/units')
  @RequirePermissions('listing.own.read')
  listUnits(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<VendorUnitView[]> {
    return this.listings.listUnits(id);
  }

  @Delete(':id/units/:unitId')
  @HttpCode(204)
  @RequirePermissions('listing.own.write')
  removeUnit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('unitId', new ZodValidationPipe(uuidSchema)) unitId: string,
  ): Promise<void> {
    return this.listings.removeUnit(id, unitId);
  }

  // -------------------------------------------------------------------------
  // Photographs of the actual machine (Rule 7(2): the picture must be of it)
  // -------------------------------------------------------------------------

  @Post(':id/images')
  @RequirePermissions('listing.own.write')
  addImage(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(addListingImageSchema)) body: AddListingImageDto,
  ): Promise<VendorImageView> {
    return this.listings.attachImage({ listingId: id, ...body });
  }

  @Get(':id/images')
  @RequirePermissions('listing.own.read')
  listImages(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<VendorImageView[]> {
    return this.listings.listImages(id);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  @RequirePermissions('listing.own.write')
  removeImage(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('imageId', new ZodValidationPipe(uuidSchema)) imageId: string,
  ): Promise<void> {
    return this.listings.removeImage(id, imageId);
  }

  // -------------------------------------------------------------------------
  // Money, as the vendor sees it
  // -------------------------------------------------------------------------

  /**
   * What the vendor would receive, before anything is created. 200 and no writes.
   *
   * Called on a debounce as they type the amount, so it takes the whole draft in
   * the body rather than a listing id: at step 4 of the wizard there is no
   * listing yet, and creating one to price it would leave a draft behind every
   * time somebody changed their mind about the number.
   */
  @Post('payout-preview')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  payoutPreview(
    @Body(new ZodValidationPipe(payoutPreviewSchema)) body: PayoutPreviewDto,
  ): Promise<VendorPayoutPreview> {
    return this.pricing.previewPayout(body);
  }

  /**
   * The vendor changes what they want per machine, on stock that already exists.
   *
   * Three steps, in this order and for this reason: the amount is resolved
   * against their account's pricing mode first, so a rejected mode changes
   * nothing; the ask is then written onto the units, because that is where the
   * ask lives once serials are attached and it is the column Phase 6 freezes
   * into `purchase_price`; and only then is the listing repriced, which is what
   * writes `price_history` with the reason.
   *
   * `purchase_price IS NULL` is the whole of "machines already reserved against
   * an order keep the price they were reserved at" — `trg_lock_purchase_price`
   * has closed those rows, and excluding them here means the vendor gets a count
   * they can reason about instead of a trigger's error message.
   *
   * The UPDATE is the one statement in this file that is not a delegation. It
   * belongs on the pricing service the moment a second caller needs it; until
   * then a repository method with exactly one call site would be indirection
   * without a seam.
   *
   * ponytail: the ask is read back as `max(vendor_ask_price)` over *all* the
   * listing's units, so a **cut** does not take effect while a frozen unit still
   * carries the higher old number — the listing keeps pricing off that one until
   * the sold machines clear. It fails in the safe direction (we never sell below
   * the margin we computed) and the vendor can see it, because the view they get
   * back reports the same maximum. The fix is for the ask to be read over
   * unlocked units only, and it belongs in the repository beside `askOf`.
   */
  @Post(':id/reprice')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  async reprice(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(repriceSchema)) body: RepriceDto,
  ): Promise<VendorListingView> {
    const { vendorAskPrice } = await this.pricing.resolveAsk({
      mode: 'NET_PAYOUT',
      vendorNetPayout: body.vendorNetPayout,
    });

    const { count } = await this.prisma.db.unit.updateMany({
      where: this.scope.scoped(
        { listing_id: id, purchase_price: null },
        'vendor_org_id',
      ) as Prisma.unitWhereInput,
      data: { vendor_ask_price: vendorAskPrice.toString() },
    });
    if (count === 0) {
      // Not a 404: the id may well be theirs. Every machine on it is either
      // committed to an order at its agreed payout or the listing has no serials
      // yet, and both of those are things the vendor can act on.
      throw new PreconditionFailedError(
        'There is nothing here to reprice. Machines already committed to an order keep the payout they were bought at, and a listing with no serial numbers is priced in the wizard.',
        { listingId: id, reason: 'no_repriceable_units' },
      );
    }

    await this.pricing.priceListing(id, { reason: body.reason, changeSource: 'VENDOR_REPRICE' });
    // Deliberately not the pricing outcome: it carries the selling price.
    return this.listings.getForVendor(id);
  }

  // -------------------------------------------------------------------------
  // Submit, and where the stock came from
  // -------------------------------------------------------------------------

  /**
   * Request an inspection. **This does not put anything on sale.**
   *
   * 200 rather than 201 because the same request has three honest outcomes and
   * only one of them creates anything: below the minimum batch size the vendor
   * is asked a question (DECISION_REQUIRED) or has asked to wait (HELD), and
   * neither writes a row. A status code that flipped between 201 and 200 would
   * make every client branch on it to find out which — the body already says,
   * in a field that is meaningful on all three paths.
   */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  submit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(submitListingSchema)) body: SubmitListingDto,
  ): Promise<SubmitResult> {
    return this.submissions.submit(id, body.choice);
  }

  /**
   * Where these machines came from, and the named person who says so.
   *
   * PUT because it is the sourcing of one listing rather than an item in a
   * collection. A repeat declaration appends rather than replaces — the earlier
   * row stays, because a corrected source type is a fact about the correction as
   * well, and `SourcingService.findForListing` resolves which one is in force.
   *
   * The GST status in the response is the verified one, never what was sent: the
   * request cannot carry it, and `valuationMethod` comes back so the vendor sees
   * the tax treatment their declaration just decided for every unit.
   */
  @Put(':id/sourcing')
  @RequirePermissions('listing.own.write')
  async declareSourcing(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(declareSourcingSchema)) body: DeclareSourcingDto,
  ): Promise<SourcingDeclarationView> {
    const [view] = await this.sourcing.declare({ listingIds: [id], ...body });
    return view!;
  }
}
