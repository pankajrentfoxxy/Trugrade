import { Injectable } from '@nestjs/common';
import { warrantyScope, type WarrantyScope } from '@trugrade/contracts';
import { PrismaService } from '../../shared/db/prisma.service';

/**
 * The four RETROFIT "Change 4" captures, as a reviewer must see them.
 *
 * **`null` means NOT CAPTURED and nothing else.** Every one of these columns is
 * `NOT NULL` with a default — `can_dropship` defaults TRUE, `pricing_mode`
 * defaults NET_PAYOUT, `default_warranty_months` defaults 0 — so returning the
 * column value alone would tell a reviewer the vendor answered a question nobody
 * asked them. The distinction is load-bearing in both directions:
 * `canDropship: false` is a real answer that puts a hub leg on every order they
 * win, and a silent `false` invented from a default would route freight through
 * a hub for no reason. A `null` is a gap, and the review screen blocks approval
 * on it.
 */
export interface VendorReviewCaptures {
  /** Resolved from `vendor_facility.dispatch_address_id`. */
  dispatchAddress: { line1: string; city: string; state: string; pincode: string } | null;
  /** A facility whose dispatch address is unset ships from its own address. */
  dispatchSameAsRegistered: boolean;
  canDropship: boolean | null;
  dropshipConstraint: string | null;
  defaultWarrantyMonths: number | null;
  defaultWarrantyScope: WarrantyScope | null;
  pricingMode: 'NET_PAYOUT' | 'COMMISSION' | null;
  agreedCommissionPct: number | null;
}

/**
 * The public interface of the `vendor` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `vendor` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: vendor profiles, capability, facilities, hours, certifications, payout preferences, sourcing declarations
 *
 * Other modules reach this through `src/modules/vendor` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IVendorService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * What the KYC reviewer has to see before approving a vendor.
   *
   * Lives on this barrel rather than being read by `kyc` directly because these
   * are four `vendor.*` tables, and a reviewer screen that reached into them
   * would be the second place that decides what "captured" means.
   */
  reviewCaptures(orgId: string): Promise<VendorReviewCaptures>;
}

@Injectable()
export class VendorService implements IVendorService {
  constructor(private readonly prisma: PrismaService) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  /**
   * Four point reads and one address lookup, rather than one clever statement.
   *
   * The address is a **separate statement** on purpose: `identity.org_address`
   * belongs to another module's schema and `no-cross-schema-join` forbids fusing
   * the two — correctly, because a JOIN there is the seam gone. Resolving the
   * dispatch address inside this module is what the retrofit migration asks for
   * ("NULL falls back to address_id ... the API resolves it"), so the caller
   * never has to know the fallback rule.
   *
   * This runs when a human opens one application, so four indexed lookups cost
   * nothing worth optimising away into a statement somebody has to decode later.
   */
  async reviewCaptures(orgId: string): Promise<VendorReviewCaptures> {
    const [profile, capability, payout, facility] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          default_warranty_months: number;
          default_warranty_scope: unknown;
          commission_pct: string | null;
        }>
      >`
        SELECT default_warranty_months, default_warranty_scope,
               commission_rate_override::text AS commission_pct
          FROM vendor.vendor_profile
         WHERE org_id = ${orgId}::uuid`,

      // `bool_and`, not "any row": a vendor who cannot dropship one product line
      // still needs a hub leg for that line, and the reviewer is deciding about
      // the vendor rather than about one category. Over zero rows it is NULL,
      // which is exactly the "never asked" answer this method has to preserve.
      this.prisma.$queryRaw<Array<{ can_dropship: boolean | null }>>`
        SELECT bool_and(can_dropship) AS can_dropship
          FROM vendor.vendor_capability
         WHERE org_id = ${orgId}::uuid
           AND is_active`,

      this.prisma.$queryRaw<Array<{ pricing_mode: string }>>`
        SELECT pricing_mode
          FROM vendor.vendor_payout_preference
         WHERE org_id = ${orgId}::uuid`,

      // A vendor may have several facilities and the review screen asks one
      // question — where do goods leave from. The one with an explicit dispatch
      // address answers it; the ordering only has to be deterministic so two
      // reviewers see the same row.
      this.prisma.$queryRaw<Array<{ dispatch_address_id: string | null }>>`
        SELECT dispatch_address_id
          FROM vendor.vendor_facility
         WHERE org_id = ${orgId}::uuid
         ORDER BY (dispatch_address_id IS NULL), id
         LIMIT 1`,
    ]);

    const dispatchAddressId = facility[0]?.dispatch_address_id ?? null;
    const address = dispatchAddressId ? await this.address(dispatchAddressId) : null;

    // The scope column is the "did they answer" signal for the warranty pair.
    // `default_warranty_months` cannot be one: it defaults to 0, and 0 is also a
    // vendor honestly offering no warranty. `vendorWarrantyDefault` cannot pass
    // without a scope carrying at least one covered item, so a non-null scope is
    // the mark of a completed step.
    const rawScope = profile[0]?.default_warranty_scope ?? null;
    const scope = rawScope === null ? null : warrantyScope.safeParse(rawScope);
    const mode = payout[0]?.pricing_mode;

    return {
      dispatchAddress: address,
      // Only a facility that exists can say "same as registered". No facility at
      // all is a gap, not a preference.
      dispatchSameAsRegistered: facility.length > 0 && dispatchAddressId === null,
      canDropship: capability[0]?.can_dropship ?? null,
      // ponytail: no column holds it. `dropshipCapability.dropshipConstraint` is
      // captured by the wizard but nothing promotes a step's draft yet
      // (`KycService.completeStep` writes an audit row), so the honest answer is
      // "nothing recorded". Add the column with the promotion, and read it here.
      dropshipConstraint: null,
      defaultWarrantyMonths: rawScope === null ? null : (profile[0]?.default_warranty_months ?? 0),
      // A scope we cannot parse is shown as absent rather than half-rendered: a
      // reviewer reading "covers " with nothing after it learns nothing.
      defaultWarrantyScope: scope?.success ? scope.data : null,
      // `chk_pricing_mode` allows the two values and no others, so the cast is
      // the constraint's guarantee rather than an assumption.
      pricingMode: mode === undefined ? null : (mode as 'NET_PAYOUT' | 'COMMISSION'),
      // `commission_rate_override` is the negotiated rate for this vendor, which
      // is what COMMISSION mode means by "the agreed rate". A percentage, never
      // money — the rupee payout it derives is frozen on the PO and lives in
      // `listing.unit.purchase_price`.
      agreedCommissionPct:
        profile[0]?.commission_pct == null ? null : Number(profile[0].commission_pct),
    };
  }

  /** The four fields a reviewer reads off an address, and not the other twelve. */
  private async address(
    addressId: string,
  ): Promise<{ line1: string; city: string; state: string; pincode: string } | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ line1: string; city: string; state: string; pincode: string }>
    >`
      SELECT line1, city, state, pincode
        FROM identity.org_address
       WHERE id = ${addressId}::uuid`;
    return row ?? null;
  }
}
