import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  Money,
  TIMEZONE,
  addressLine1Schema,
  addressLine2Schema,
  fullNameSchema,
  mobileSchema,
  moneyFromDb,
  pincodeSchema,
} from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { OrgScope } from '../../shared/db/org-scope';
import { PrismaService } from '../../shared/db/prisma.service';
import { ForbiddenError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';

/**
 * The vendor's own org: their landing screen and their pickup facilities.
 *
 * **Every figure here is about one org — the caller's — and that org id comes
 * off the session.** There is no path parameter and no query parameter that
 * names a vendor, because the worst bug this module can have is one vendor
 * reading another's stock, and a parameter you never accept is one you cannot
 * fail to check.
 *
 * **Nothing here carries a retail price.** The tiles count machines and add up
 * what the vendor is *owed*; the selling price of a unit is ours and appears on
 * no vendor surface (`no-retail-price.spec.tsx` asserts the same thing from the
 * other side of the wire). The payout figure is `procurement.vendor_payable`,
 * which is the deducted net the vendor actually receives.
 *
 * **Why the queries are here and one per schema.** The dashboard is an aggregate
 * across four tables in two module schemas and there is no service that owns the
 * combination — the numbers belong to whoever is looking at them, not to a
 * domain. So it is written the way `sourcing.service` documents: separate
 * statements, one module schema each, combined in TypeScript.
 * `no-cross-schema-join` forbids the JOIN that would be shorter, and it is right
 * to: a join across `listing` and `procurement` is the seam gone.
 */

/** The pickup-location picker's row. `listing.pickup_location_id` points at `addressId`. */
interface VendorFacilityView {
  addressId: string;
  label: string;
  city: string;
  pincode: string;
}

/**
 * The six numbers on the vendor's landing screen.
 *
 * Each is a number somebody can act on today. There is no revenue figure and no
 * lifetime total, because a dashboard fills up with vanity metrics one plausible
 * addition at a time and then nobody reads it.
 */
interface VendorDashboard {
  unitsAwaitingQc: number;
  unitsLive: number;
  unitsSoldThisMonth: number;
  /** Sellable now, not sellable in a fortnight. QC is valid 90 days. */
  unitsQcExpiring14d: number;
  payoutsDue: Money;
  payoutsDueOn: Date | null;
  openGradeCorrections: number;
}

const QC_EXPIRY_WARNING_DAYS = 14;

/**
 * A new pickup facility. Every column `identity.org_address` requires and
 * nothing it does not: no coordinates (geocoding is a job, not a form field) and
 * no `is_default`, because promoting one address means demoting another and
 * nothing has asked for that yet.
 */
const createFacilitySchema = z.object({
  label: z.string().trim().min(1).max(60),
  line1: addressLine1Schema,
  line2: addressLine2Schema.nullish(),
  city: z.string().trim().min(1).max(60),
  state: z.string().trim().min(1).max(60),
  /** The two-digit GST state code — 29 Karnataka, 27 Maharashtra. */
  stateCode: z.string().regex(/^\d{2}$/, 'Enter the two-digit GST state code, for example 29.'),
  pincode: pincodeSchema,
  contactName: fullNameSchema,
  contactMobile: mobileSchema,
  landmark: z.string().trim().max(120).nullish(),
});

type CreateFacilityDto = z.infer<typeof createFacilitySchema>;

@Controller('vendor')
export class VendorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
    private readonly clock: ClockPort,
  ) {}

  /**
   * The org every query below is about.
   *
   * Platform staff have no org in context, and PLATFORM_SUPERADMIN holds every
   * permission — including the two that guard these routes. So the refusal is
   * here rather than in the guard: "the vendor dashboard" is not a question that
   * has an answer without a vendor.
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

  // -------------------------------------------------------------------------
  // Today
  // -------------------------------------------------------------------------

  /**
   * Both permissions, ANDed, because the payload genuinely contains both kinds
   * of fact — their stock and their money. Every vendor role holds both, so the
   * pair excludes nobody who should see this and states what the response is.
   */
  @Get('dashboard')
  @RequirePermissions('listing.own.read', 'procurement.po.read_own')
  async dashboard(): Promise<VendorDashboard> {
    const orgId = this.requireVendorOrg();
    const today = this.clock.todayInIst();
    // Business windows are reckoned in IST (VR-160), and both boundaries come
    // off the injected clock rather than out of SQL so a test can move them.
    const monthStart = `${today.slice(0, 8)}01`;
    const expiryHorizon = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(
      this.clock.plusDays(QC_EXPIRY_WARNING_DAYS),
    );

    // `v_sellable_unit` rather than a status filter: it is THE definition of
    // sellable, it applies the expiry live rather than waiting for the nightly
    // job, and a second definition of "live" on the vendor's own dashboard is
    // how a vendor comes to believe stock is selling that no buyer can see.
    const [counts] = await this.prisma.$queryRaw<
      Array<{
        awaiting_qc: bigint;
        live: bigint;
        expiring: bigint;
        sold_this_month: bigint;
        open_corrections: bigint;
      }>
    >`
      SELECT
        (SELECT count(*) FROM listing.unit u
          WHERE u.vendor_org_id = ${orgId}::uuid
            AND u.status IN ('AWAITING_QC','QC_SCHEDULED','QC_IN_PROGRESS'))     AS awaiting_qc,
        (SELECT count(*) FROM listing.v_sellable_unit s
          WHERE s.vendor_org_id = ${orgId}::uuid)                                AS live,
        (SELECT count(*) FROM listing.v_sellable_unit s
          WHERE s.vendor_org_id = ${orgId}::uuid
            AND s.qc_valid_until <= ${expiryHorizon}::date)                      AS expiring,
        (SELECT count(*) FROM listing.stock_movement m
          JOIN listing.unit mu ON mu.id = m.unit_id
          WHERE mu.vendor_org_id = ${orgId}::uuid
            AND m.to_status = 'DELIVERED'
            AND m.occurred_at >= ${monthStart}::date)                            AS sold_this_month,
        (SELECT count(*) FROM listing.grade_correction g
          JOIN listing.listing l ON l.id = g.listing_id
          WHERE l.vendor_org_id = ${orgId}::uuid
            AND g.vendor_responded_at IS NULL
            AND g.auto_applied_at IS NULL)                                       AS open_corrections`;

    // ON_HOLD and CANCELLED are excluded: a held payable has no expected date,
    // and putting one under "expected on" would be a promise nobody made. PAID
    // is gone by definition.
    const [payables] = await this.prisma.$queryRaw<
      Array<{ due: string | null; due_on: Date | null }>
    >`
      SELECT sum(net_payable)::text AS due, min(eligible_at) AS due_on
        FROM procurement.vendor_payable
       WHERE vendor_org_id = ${orgId}::uuid
         AND status IN ('ACCRUED','ELIGIBLE','IN_RUN')`;

    return {
      unitsAwaitingQc: Number(counts?.awaiting_qc ?? 0),
      unitsLive: Number(counts?.live ?? 0),
      unitsSoldThisMonth: Number(counts?.sold_this_month ?? 0),
      unitsQcExpiring14d: Number(counts?.expiring ?? 0),
      payoutsDue: moneyFromDb(payables?.due ?? null) ?? Money.ZERO,
      payoutsDueOn: payables?.due_on ?? null,
      openGradeCorrections: Number(counts?.open_corrections ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Where we come to collect
  // -------------------------------------------------------------------------

  /**
   * The pickup locations the wizard's step 2 picker offers.
   *
   * Guarded by `listing.own.read` rather than an identity permission on purpose:
   * this list exists to fill `listing.pickup_location_id`, and VENDOR_OPS — who
   * creates most listings — holds no identity permission at all. Reading your
   * own pickup addresses is part of reading your own stock.
   *
   * Four fields, chosen rather than spread. `identity.org_address` also carries
   * a contact name, a mobile number and coordinates, and none of them belong in
   * a `<select>`.
   */
  @Get('facilities')
  @RequirePermissions('listing.own.read')
  async facilities(): Promise<VendorFacilityView[]> {
    const orgId = this.requireVendorOrg();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; line1: string; city: string; pincode: string }>
    >`
      SELECT id, label, line1, city, pincode
        FROM identity.org_address
       WHERE org_id = ${orgId}::uuid
         AND type = 'PICKUP'
         AND is_active
       ORDER BY is_default DESC, label NULLS LAST, city`;

    return rows.map((r) => ({
      addressId: r.id,
      // An unlabelled address still has to be recognisable in a dropdown, and
      // the street is what the person who works there would call it.
      label: r.label ?? r.line1,
      city: r.city,
      pincode: r.pincode,
    }));
  }

  /**
   * Add a place we can collect from.
   *
   * `identity.user.write` rather than a listing permission: this writes
   * `identity.org_address`, which is org administration — VENDOR_OWNER and
   * VENDOR_ADMIN carry it and VENDOR_OPS deliberately does not. A new warehouse
   * on the dispatch paperwork is not a listing edit.
   *
   * The type is fixed to PICKUP here rather than taken from the body. A billing
   * or registered address has different requirements and a different screen, and
   * accepting the discriminator from the client would let this route write both.
   */
  @Post('facilities')
  @RequirePermissions('identity.user.write')
  async createFacility(
    @Body(new ZodValidationPipe(createFacilitySchema)) body: CreateFacilityDto,
  ): Promise<VendorFacilityView> {
    const orgId = this.requireVendorOrg();
    const [row] = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; line1: string; city: string; pincode: string }>
    >`
      INSERT INTO identity.org_address
        (org_id, type, label, line1, line2, city, state, state_code, pincode,
         contact_name, contact_mobile, landmark, is_pickup_enabled, is_active)
      VALUES
        (${orgId}::uuid, 'PICKUP'::public.address_type, ${body.label}, ${body.line1},
         ${body.line2 ?? null}, ${body.city}, ${body.state}, ${body.stateCode}, ${body.pincode},
         ${body.contactName}, ${body.contactMobile}, ${body.landmark ?? null}, TRUE, TRUE)
      RETURNING id, label, line1, city, pincode`;

    return {
      addressId: row!.id,
      label: row!.label ?? row!.line1,
      city: row!.city,
      pincode: row!.pincode,
    };
  }
}
