import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { uuidSchema, type SerialBatch } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  ListingService,
  type AddUnitsOutcome,
  type VendorImageView,
  type VendorListingView,
  type VendorUnitView,
} from './listing.service';
import type { Page } from './internal/listing.repository';
import type { SerialCsvReport } from './internal/serial.service';
import {
  addListingImageSchema,
  addUnitsSchema,
  createListingDraftSchema,
  listListingsQuerySchema,
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
 *      next handler.
 *
 * Validation is the shared Zod schema applied per endpoint (VR-META-01) rather
 * than a global pipe, so the client and the server run the identical constant.
 */
@Controller('vendor/listings')
export class ListingController {
  constructor(private readonly listings: ListingService) {}

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
}
