import { Injectable } from '@nestjs/common';
import type { Grade } from '@trugrade/contracts';
import { OrgScope } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';

/**
 * The vendor's own grade corrections, and nobody else's.
 *
 * **Why this exists rather than a branch in `QcConsoleService.correctionQueue()`.**
 * That method is the OPS console's board: it takes no principal, applies no org
 * predicate and resolves a vendor NAME onto every row — correctly, because it is
 * a queue meant to span every vendor. Four vendor roles used to hold the
 * `qc.report.read` that guarded it, and any of them could list a competitor's
 * serials. The grants were removed (see the comment above `VENDOR_OWNER` in
 * `roles.ts`); giving the vendor a caller-org branch through the same query
 * would have put the two audiences back on one code path, where the next person
 * to add a column has to remember which half of an `if` they are in.
 *
 * So the vendor's rows come from here, where the org predicate is not optional
 * and is not a parameter. 02_ARCHITECTURE §3.2 layer 3: a missing `where` in a
 * service must not be able to leak another org's rows, so it lives at this layer
 * and the controller above has nothing to forget.
 *
 * **Ownership is `listing.unit.vendor_org_id`, not `listing.listing`.**
 * `grade_correction.listing_id` is NULLABLE — a machine can be corrected before
 * its listing exists — and a correction whose owner is derived from a nullable
 * column has rows with no owner at all. `unit_id` is NOT NULL and the unit
 * carries the org, so every row has exactly one answer to "whose is this".
 *
 * Same schema throughout: `grade_correction` and `unit` are both `listing`, so
 * this is a join `no-cross-schema-join` allows. The SKU code is a second
 * statement for the opposite reason — `catalog.sku` is not.
 */

export interface VendorCorrectionRow {
  id: string;
  unitId: string;
  listingId: string | null;
  skuId: string;
  serialNumber: string;
  gradeDeclared: Grade;
  gradeCorrected: Grade;
  reason: string;
  /**
   * `price_before` — the vendor's OWN ask as it stood, never our selling price.
   * A retail figure appears on no vendor surface, and this column never held one.
   */
  askBefore: string | null;
  vendorNotifiedAt: Date;
  vendorResponse: string | null;
  vendorRespondedAt: Date | null;
  autoAppliedAt: Date | null;
  countsAgainstAccuracy: boolean;
}

type Raw = Record<string, unknown>;

/** Their whole correction history. Nine is the busiest vendor in the seed. */
const LIMIT = 200;

@Injectable()
export class VendorCorrectionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
  ) {}

  /**
   * The caller's corrections, newest deadline first, optionally one by id.
   *
   * A correction belonging to another vendor comes back as an empty result and
   * not as a row the caller is then refused — the caller learns nothing about
   * whether the id exists, which is the same answer they get for a typo.
   */
  async findForVendor(id: string | null = null): Promise<VendorCorrectionRow[]> {
    const orgId = this.requireVendorOrg();
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT c.id, c.unit_id, c.listing_id, c.grade_declared, c.grade_corrected, c.reason,
             c.price_before, c.vendor_notified_at, c.vendor_response, c.vendor_responded_at,
             c.auto_applied_at, c.counts_against_accuracy,
             u.serial_number, u.sku_id
        FROM listing.grade_correction c
        JOIN listing.unit u ON u.id = c.unit_id
       WHERE u.vendor_org_id = ${orgId}::uuid
         AND (${id}::uuid IS NULL OR c.id = ${id}::uuid)
       ORDER BY c.vendor_notified_at
       LIMIT ${LIMIT}`;
    return rows.map(toRow);
  }

  /** The SKU code, as a separate statement: `catalog` is another schema. */
  async skuCodes(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; sku_code: string }>>`
      SELECT id, sku_code FROM catalog.sku WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.sku_code]));
  }

  /**
   * Platform staff have no org in context, and PLATFORM_SUPERADMIN holds every
   * permission — so the refusal is here rather than in the guard. "Your grade
   * corrections" is not a question that has an answer without a vendor, and the
   * ops console has its own board for the cross-vendor one.
   */
  private requireVendorOrg(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError('This screen is about one vendor, so one has to be signed in.', {
        reason: 'vendor_route_without_org',
      });
    }
    return orgId;
  }
}

function toRow(r: Raw): VendorCorrectionRow {
  return {
    id: r.id as string,
    unitId: r.unit_id as string,
    listingId: (r.listing_id as string | null) ?? null,
    skuId: r.sku_id as string,
    serialNumber: r.serial_number as string,
    gradeDeclared: r.grade_declared as Grade,
    gradeCorrected: r.grade_corrected as Grade,
    reason: r.reason as string,
    // NUMERIC(14,2) arrives as a Decimal. `String()` here and `money()` at the
    // boundary above; `Number()` is the float bug the money path exists to stop.
    askBefore: r.price_before === null ? null : String(r.price_before),
    vendorNotifiedAt: r.vendor_notified_at as Date,
    vendorResponse: (r.vendor_response as string | null) ?? null,
    vendorRespondedAt: (r.vendor_responded_at as Date | null) ?? null,
    autoAppliedAt: (r.auto_applied_at as Date | null) ?? null,
    countsAgainstAccuracy: r.counts_against_accuracy as boolean,
  };
}
