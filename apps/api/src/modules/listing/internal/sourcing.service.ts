import { Injectable } from '@nestjs/common';
import { Money, money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { ListingRepository } from './listing.repository';

/**
 * The sourcing declaration, and the tax position it decides.
 *
 * Two jobs, and they are not the same job:
 *
 *   1. **Anti-theft.** Where the machine came from, from whom, on what invoice,
 *      and — the part that makes it a control rather than a form — the *named
 *      person* who said so. A stolen-laptop claim against a unit we sold is a
 *      criminal matter, and "the vendor uploaded it" is not an answer.
 *   2. **The GST margin-scheme determinant.** Whether the vendor was registered,
 *      and whether ITC was available to them on acquisition, decides
 *      `listing.unit.valuation_method` for the life of every unit on the
 *      listing. Rule 32(5) is conditional on no ITC having been availed.
 *
 * The rule the whole file is built around: **the GST status is verified, never
 * self-declared.** `vendor_gst_status` is written together with the id of the
 * `kyc.verification_check` row that actually produced it, and
 * `chk_vsd_gst_verified` makes the four columns all-or-nothing so no later
 * caller can record a status with nothing behind it. Where no verification
 * exists the declaration is refused and says why — a defaulted status would be a
 * self-declaration wearing a verified column's name.
 *
 * **Module boundary.** This service lives in `listing` and writes `vendor`,
 * reads `kyc`, reads `platform`. That is legitimate and it is done the way
 * `serial.service` does it: separate statements, one module schema each,
 * combined in TypeScript. `no-cross-schema-join` forbids a JOIN across two
 * module schemas and nothing here needs one — the single JOIN below is `kyc` to
 * `kyc`.
 */

export type SourceType =
  | 'CORPORATE_BUYBACK'
  | 'LEASE_RETURN'
  | 'AUCTION'
  | 'IMPORT'
  | 'RETAIL_EXCHANGE'
  | 'OEM_REFURB';

export type VendorGstStatus = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';

export type ValuationMethod = 'REGULAR' | 'MARGIN';

export interface DeclareSourcingInput {
  /**
   * One listing or a batch. `vendor_sourcing_declaration.listing_id` is
   * nullable, so a batch could have been one row covering nothing in
   * particular; instead a batch writes one row per listing sharing the same
   * verification evidence. Which listing a declaration covers is then a column
   * rather than an inference — and that is what gets read on the day somebody
   * has to answer a police request about one serial.
   */
  listingIds: readonly string[];
  sourceType: SourceType;
  sourceOrgName?: string | null;
  acquisitionInvoiceNo?: string | null;
  /** `YYYY-MM-DD`. The acquisition, not the declaration. */
  acquisitionDate?: string | null;
  /** `kyc.kyc_document.id`. Required above the configured value threshold. */
  supportingDocId?: string | null;
  /**
   * Did the vendor avail input tax credit when they bought these machines?
   *
   * Declared, because only the vendor's own books can answer it — but it is
   * *bounded* by the verified registration below rather than taken at face
   * value.
   */
  itcAvailedOnAcquisition: boolean;
}

export interface SourcingDeclarationView {
  id: string;
  listingId: string;
  sourceType: SourceType;
  sourceOrgName: string | null;
  acquisitionInvoiceNo: string | null;
  acquisitionDate: Date | null;
  supportingDocId: string | null;
  declaredBy: string;
  declaredAt: Date;
  vendorGstStatus: VendorGstStatus;
  itcAvailable: boolean;
  gstVerifiedAt: Date;
  gstVerificationCheckId: string;
  /** What was written onto every unit of this listing. */
  valuationMethod: ValuationMethod;
  unitsUpdated: number;
}

/** The answer GSTN gave, and the row that proves it gave it. */
interface VerifiedGst {
  status: VendorGstStatus;
  checkId: string;
  verifiedAt: Date;
}

const THRESHOLD_KEY = 'platform.sourcing_declaration_threshold_inr';

interface RawDeclaration {
  id: string;
  listing_id: string;
  source_type: string;
  source_org_name: string | null;
  acquisition_invoice_no: string | null;
  acquisition_date: Date | null;
  supporting_doc_id: string | null;
  declared_by: string;
  declared_at: Date;
  vendor_gst_status: string;
  itc_available: boolean;
  gst_verified_at: Date;
  gst_verification_check_id: string;
}

/**
 * `trg_lock_valuation` raises with ERRCODE `check_violation`. Prisma reports a
 * failed raw statement as P2010 with the state in `meta.code` on some driver
 * paths and only in the message on others, so both are read — the same reasoning
 * as `sqlState` in the listing repository, which is not exported. Worth lifting
 * into `shared/db` the next time a third file needs it.
 */
function isCheckViolation(e: unknown): boolean {
  const code = (e as { meta?: { code?: string } } | undefined)?.meta?.code;
  if (code === '23514') return true;
  return /\b23514\b|immutable once purchase_price is set/.test(
    (e as { message?: string } | undefined)?.message ?? '',
  );
}

@Injectable()
export class SourcingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly listings: ListingRepository,
  ) {}

  /**
   * Record the declaration and set the valuation method it implies.
   *
   * One transaction for the whole batch: the declaration and the units it
   * governs must not be able to disagree, and a half-applied batch would leave
   * two listings from the same acquisition on two different tax treatments with
   * no record of why.
   */
  async declare(input: DeclareSourcingInput): Promise<SourcingDeclarationView[]> {
    const listingIds = [...new Set(input.listingIds)];
    if (listingIds.length === 0) {
      throw new ValidationError('Choose at least one listing to declare a source for.');
    }

    // The named person. `declared_by` is NOT NULL precisely so this cannot be a
    // system actor: a declaration nobody signed is not a declaration.
    const declaredBy = this.ctx.requirePrincipal().userId;
    const declaredAt = this.clock.now();

    if (input.acquisitionDate && Date.parse(input.acquisitionDate) > declaredAt.getTime()) {
      throw new ValidationError('The acquisition date cannot be in the future.', {
        acquisitionDate: 'The acquisition date cannot be in the future.',
      });
    }

    return this.prisma.runInTransaction(async () => {
      // findById carries the org predicate, so this is the ownership check too:
      // another vendor's listing is simply not found.
      const rows = await Promise.all(listingIds.map((id) => this.listings.findById(id)));
      const missing = listingIds.filter((_, i) => rows[i] === null);
      if (missing.length > 0) throw new NotFoundError('listing', { listingIds: missing });
      const listings = rows.filter((r): r is NonNullable<typeof r> => r !== null);

      const orgIds = new Set(listings.map((l) => l.vendorOrgId));
      if (orgIds.size > 1) {
        // The GST status is verified once, for one vendor. Spanning two in a
        // single call would apply one vendor's registration to another's stock.
        throw new ValidationError('A sourcing declaration covers one vendor at a time.');
      }

      const gst = await this.verifiedGstStatus([...orgIds][0]!, declaredAt);

      // Rule 32(5) is available only where no ITC was availed, and a vendor who
      // is unregistered or on the composition levy could not have availed it
      // whatever they tick. Bounding the declared answer here is also what keeps
      // chk_unit_margin_no_itc satisfiable instead of a 500 waiting to happen.
      const itcAvailable = gst.status === 'REGULAR' && input.itcAvailedOnAcquisition;
      const valuationMethod: ValuationMethod =
        gst.status === 'UNREGISTERED' || !itcAvailable ? 'MARGIN' : 'REGULAR';

      const threshold = await this.supportingDocThreshold();

      const views: SourcingDeclarationView[] = [];
      for (const listing of listings) {
        // Before any serial is attached the ask lives on the listing row; after,
        // on the units. findById already resolves that, and either way this is
        // the vendor's own number — never the retail price.
        const perUnit = listing.vendorAskPrice ?? listing.unitPrice;
        // Strictly above, like tax.eway_bill_threshold_inr: a machine worth
        // exactly the threshold does not need the paperwork.
        if (perUnit.gt(threshold) && !input.supportingDocId) {
          throw new ValidationError(
            `Machines above ${threshold.format()} each need the acquisition document attached. Upload the invoice or buyback agreement and declare again.`,
            { supportingDocId: 'Attach the acquisition document for this value of stock.' },
          );
        }

        const [row] = await this.prisma.$queryRaw<RawDeclaration[]>`
          INSERT INTO vendor.vendor_sourcing_declaration
            (org_id, listing_id, source_type, source_org_name, acquisition_invoice_no,
             acquisition_date, supporting_doc_id, declared_by, declared_at,
             vendor_gst_status, itc_available, gst_verified_at, gst_verification_check_id)
          VALUES
            (${listing.vendorOrgId}::uuid, ${listing.id}::uuid, ${input.sourceType},
             ${input.sourceOrgName ?? null}, ${input.acquisitionInvoiceNo ?? null},
             ${input.acquisitionDate ?? null}::date, ${input.supportingDocId ?? null}::uuid,
             ${declaredBy}::uuid, ${declaredAt},
             ${gst.status}, ${itcAvailable}, ${gst.verifiedAt}, ${gst.checkId}::uuid)
          RETURNING id, listing_id, source_type, source_org_name, acquisition_invoice_no,
                    acquisition_date, supporting_doc_id, declared_by, declared_at,
                    vendor_gst_status, itc_available, gst_verified_at, gst_verification_check_id`;

        const unitsUpdated = await this.applyValuation(listing.id, valuationMethod, itcAvailable);
        views.push({ ...toView(row!), valuationMethod, unitsUpdated });
      }

      return views;
    });
  }

  /**
   * The declaration in force for a listing. Latest wins; the earlier ones stay,
   * because a corrected source type is a fact about the correction as well.
   *
   * ponytail: `declared_at` is millisecond-precision and the table has no
   * monotonic key, so two declarations written in the same millisecond tie and
   * `id DESC` picks between them arbitrarily — deterministically, at least, so
   * two reads agree. A double-submitted form is the only way to reach it and
   * both rows say the same thing. Give the table a `seq bigserial` if that ever
   * stops being true.
   */
  async findForListing(listingId: string): Promise<SourcingDeclarationView | null> {
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundError('listing');

    const [row] = await this.prisma.$queryRaw<RawDeclaration[]>`
      SELECT id, listing_id, source_type, source_org_name, acquisition_invoice_no,
             acquisition_date, supporting_doc_id, declared_by, declared_at,
             vendor_gst_status, itc_available, gst_verified_at, gst_verification_check_id
        FROM vendor.vendor_sourcing_declaration
       WHERE listing_id = ${listingId}::uuid
       ORDER BY declared_at DESC, id DESC
       LIMIT 1`;
    if (!row) return null;

    // Read back what the units actually carry rather than re-deriving it. A
    // declaration made before a unit was purchased and locked is the one case
    // where the two can legitimately differ, and the units are the tax record.
    const [unit] = await this.prisma.$queryRaw<Array<{ valuation_method: string; n: bigint }>>`
      SELECT valuation_method, count(*)::bigint AS n
        FROM listing.unit
       WHERE listing_id = ${listingId}::uuid
       GROUP BY valuation_method
       ORDER BY count(*) DESC
       LIMIT 1`;

    return {
      ...toView(row),
      valuationMethod: (unit?.valuation_method as ValuationMethod) ?? 'REGULAR',
      unitsUpdated: Number(unit?.n ?? 0),
    };
  }

  /**
   * What GSTN said about this vendor, as at the declaration date.
   *
   * The check row is the evidence and the answer at once — it carries both the
   * id `chk_vsd_gst_verified` demands and the provider's own response — so it is
   * what the query is anchored on. `kyc.gst_profile` holds the same answer in an
   * enumerated column rather than the provider's free text ("Regular",
   * "Composition Levy"), so it wins where the two overlap and the response falls
   * back in when no profile was persisted. Joined on the GSTIN itself rather
   * than on `is_primary`, so a multi-state vendor cannot end up with another
   * state's registration answering for the one that was checked.
   *
   * PROVIDER_ERROR and TIMEOUT are excluded deliberately: they are our problem,
   * not a statement about the vendor, and reading one as "not registered" would
   * put a whole listing on the margin scheme because a portal was down.
   */
  private async verifiedGstStatus(orgId: string, asOf: Date): Promise<VerifiedGst> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        check_status: string;
        checked_at: Date;
        registration_type: string | null;
        gstin_status: string | null;
      }>
    >`
      SELECT vc.id, vc.status AS check_status, vc.checked_at,
             COALESCE(g.registration_type, vc.response_summary->>'taxpayerType') AS registration_type,
             COALESCE(g.status, vc.response_summary->>'status')                  AS gstin_status
        FROM kyc.verification_check vc
        LEFT JOIN kyc.gst_profile g
               ON g.org_id = vc.org_id
              AND g.gstin  = vc.response_summary->>'gstin'
       WHERE vc.org_id = ${orgId}::uuid
         AND vc.check_type = 'GSTIN'
         AND vc.status IN ('PASS', 'FAIL')
         AND vc.checked_at <= ${asOf}
       ORDER BY vc.checked_at DESC
       LIMIT 1`;

    if (!row) {
      throw new PreconditionFailedError(
        'We have no GSTN verification on file for your organisation, so we cannot record the GST position for this stock. Complete GST verification and declare again.',
        { reason: 'no_gstin_verification', orgId },
      );
    }

    const evidence = { checkId: row.id, verifiedAt: row.checked_at };

    // A FAIL is GSTN answering: no live registration behind that number. That is
    // a verified answer rather than a missing one, and it is the only route by
    // which an unregistered vendor gets a status at all.
    if (row.check_status === 'FAIL') return { status: 'UNREGISTERED', ...evidence };

    const gstinStatus = (row.gstin_status ?? '').toUpperCase();
    if (gstinStatus === 'CANCELLED') return { status: 'UNREGISTERED', ...evidence };
    if (gstinStatus !== 'ACTIVE') {
      // SUSPENDED and PROVISIONAL are neither registered nor not. Guessing picks
      // a vendor's tax treatment for them, so it is refused instead.
      throw new PreconditionFailedError(
        `Your GST registration is ${gstinStatus.toLowerCase() || 'in an unknown state'} with GSTN. We cannot set the tax treatment for this stock until it is active again.`,
        { reason: 'gstin_not_active', gstinStatus },
      );
    }

    return {
      status: /composition/i.test(row.registration_type ?? '') ? 'COMPOSITION' : 'REGULAR',
      ...evidence,
    };
  }

  /**
   * The value above which the acquisition document is required.
   *
   * A missing key means we cannot tell whether paperwork is needed — so it
   * requires it for everything. The declaration is an anti-theft control, and
   * the safe direction for a config gap is more evidence, not less.
   */
  private async supportingDocThreshold(): Promise<Money> {
    // v_current_config, never platform_config: the view is effective-dated
    // against now(), which is what makes a future-dated row scheduled rather
    // than live. `#>> '{}'` unwraps the JSON scalar as text, so an amount does
    // not make the trip through a JS number on its way into Money.
    const [row] = await this.prisma.$queryRaw<Array<{ value: string | null }>>`
      SELECT value_json #>> '{}' AS value
        FROM platform.v_current_config
       WHERE key = ${THRESHOLD_KEY}`;
    return row?.value ? money(row.value) : Money.ZERO;
  }

  /**
   * Write the derived treatment onto every unit of the listing.
   *
   * There is deliberately no `AND purchase_price IS NULL` here. Once the PO is
   * raised a unit's GST treatment is settled, and the thing that must refuse a
   * change is `trg_lock_valuation` — a WHERE clause would filter the row out
   * silently and report success for stock it had not touched. The trigger fires
   * only on a genuine change, so re-declaring the same position over purchased
   * units still succeeds, which is right.
   */
  private async applyValuation(
    listingId: string,
    valuationMethod: ValuationMethod,
    itcAvailable: boolean,
  ): Promise<number> {
    try {
      return await this.prisma.$executeRaw`
        UPDATE listing.unit
           SET valuation_method = ${valuationMethod},
               itc_eligible     = ${itcAvailable}
         WHERE listing_id = ${listingId}::uuid`;
    } catch (e) {
      if (isCheckViolation(e)) {
        throw new PreconditionFailedError(
          'Some of these machines have already been purchased, and their GST treatment is fixed from that point. Raise a correction with our team instead.',
          { reason: 'valuation_locked_by_trigger', listingId, valuationMethod },
        );
      }
      throw e;
    }
  }
}

type DeclarationFields = Omit<SourcingDeclarationView, 'valuationMethod' | 'unitsUpdated'>;

function toView(r: RawDeclaration): DeclarationFields {
  return {
    id: r.id,
    listingId: r.listing_id,
    sourceType: r.source_type as SourceType,
    sourceOrgName: r.source_org_name,
    acquisitionInvoiceNo: r.acquisition_invoice_no,
    acquisitionDate: r.acquisition_date,
    supportingDocId: r.supporting_doc_id,
    declaredBy: r.declared_by,
    declaredAt: r.declared_at,
    vendorGstStatus: r.vendor_gst_status as VendorGstStatus,
    itcAvailable: r.itc_available,
    gstVerifiedAt: r.gst_verified_at,
    gstVerificationCheckId: r.gst_verification_check_id,
  };
}
