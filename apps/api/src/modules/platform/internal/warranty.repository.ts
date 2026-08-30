import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * Every read and write of `platform.warranty` and `platform.warranty_claim`.
 *
 * **Org scoping lives here, in the WHERE clause, and nowhere above it.** A claim
 * is the buyer's own record and `warranty_claim.buyer_org_id` is the column that
 * says whose; a service-layer filter is one early `return` away from serving
 * another company's fault descriptions. There is no method on this class that
 * reads a claim without an org id, so there is nothing to forget.
 *
 * **`platform.warranty` has no org column at all**, deliberately: cover attaches
 * to a machine, not to a buyer, and a machine returned to a supply point and
 * resold does not carry its previous owner. Ownership is therefore always
 * supplied as the set of unit ids `ordering` has already confirmed the caller
 * bought — which is why every warranty read here takes that set rather than an
 * org id it would have to resolve for itself.
 *
 * Every query touches exactly one module schema. `no-cross-schema-join` is a
 * design rule, not a lint preference: the fuse between "what this org owns" and
 * "what cover exists" happens in TypeScript, one layer up.
 */

/** `platform.warranty`, as stored. `vendorOrgId` never leaves this module. */
export interface WarrantyRow {
  id: string;
  unitId: string;
  startDate: string;
  endDate: string;
  status: string;
  totalMonths: number;
  /** INTERNAL — the split the customer is never told. */
  vendorBackedMonths: number;
  /** INTERNAL — the split the customer is never told. */
  platformBackedMonths: number;
  /** INTERNAL — who a claim is recovered from afterwards. */
  vendorOrgId: string | null;
}

export interface ClaimRow {
  id: string;
  claimNumber: string;
  warrantyId: string;
  unitId: string;
  orderLineUnitId: string | null;
  issueType: string;
  description: string;
  status: string;
  resolution: string | null;
  evidenceKeys: string[];
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export interface OpenWarrantyInput {
  unitId: string;
  startDate: string;
  endDate: string;
  totalMonths: number;
  vendorBackedMonths: number;
  platformBackedMonths: number;
  vendorOrgId: string;
}

interface RawWarranty {
  id: string;
  unit_id: string;
  start_date: Date;
  end_date: Date;
  status: string;
  total_months: number;
  vendor_backed_months: number;
  platform_backed_months: number;
  vendor_org_id: string | null;
}

interface RawClaim {
  id: string;
  claim_number: string;
  warranty_id: string;
  unit_id: string;
  order_line_unit_id: string | null;
  issue_type: string;
  description: string;
  status: string;
  resolution: string | null;
  evidence_keys: string[];
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

/** A DATE column comes back as a `Date` at UTC midnight; the day is the value. */
const day = (d: Date): string => d.toISOString().slice(0, 10);

const toWarranty = (r: RawWarranty): WarrantyRow => ({
  id: r.id,
  unitId: r.unit_id,
  startDate: day(r.start_date),
  endDate: day(r.end_date),
  status: r.status,
  totalMonths: Number(r.total_months),
  vendorBackedMonths: Number(r.vendor_backed_months),
  platformBackedMonths: Number(r.platform_backed_months),
  vendorOrgId: r.vendor_org_id,
});

const toClaim = (r: RawClaim): ClaimRow => ({
  id: r.id,
  claimNumber: r.claim_number,
  warrantyId: r.warranty_id,
  unitId: r.unit_id,
  orderLineUnitId: r.order_line_unit_id,
  issueType: r.issue_type,
  description: r.description,
  status: r.status,
  resolution: r.resolution,
  evidenceKeys: r.evidence_keys ?? [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
});

@Injectable()
export class WarrantyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Cover for machines the caller has already proved it owns. */
  async coverFor(unitIds: readonly string[]): Promise<WarrantyRow[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<RawWarranty[]>`
      SELECT id, unit_id, start_date, end_date, status, total_months,
             vendor_backed_months, platform_backed_months, vendor_org_id
        FROM platform.warranty
       WHERE unit_id = ANY(${[...unitIds]}::uuid[])`;
    return rows.map(toWarranty);
  }

  /**
   * Insert cover, skipping machines that already have it.
   *
   * `ON CONFLICT DO NOTHING` against `uq_warranty_unit`, so a double-press of the
   * delivery endpoint is a no-op rather than a second overlapping term. The
   * count comes back from `RETURNING`, which counts what was actually written
   * rather than what was offered.
   */
  async open(inputs: readonly OpenWarrantyInput[]): Promise<number> {
    let opened = 0;
    for (const w of inputs) {
      const written = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO platform.warranty
               (unit_id, start_date, end_date, terms_version, status,
                total_months, vendor_backed_months, platform_backed_months, vendor_org_id)
        VALUES (${w.unitId}::uuid, ${w.startDate}::date, ${w.endDate}::date,
                ${TERMS_VERSION}, 'ACTIVE',
                ${w.totalMonths}, ${w.vendorBackedMonths}, ${w.platformBackedMonths},
                ${w.vendorOrgId}::uuid)
        ON CONFLICT (unit_id) DO NOTHING
        RETURNING id`;
      opened += written.length;
    }
    return opened;
  }

  /** One organisation's claims, newest first. */
  async claimsForOrg(orgId: string): Promise<ClaimRow[]> {
    const rows = await this.prisma.$queryRaw<RawClaim[]>`
      SELECT id, claim_number, warranty_id, unit_id, order_line_unit_id, issue_type,
             description, status, resolution, evidence_keys, created_at, updated_at, closed_at
        FROM platform.warranty_claim
       WHERE buyer_org_id = ${orgId}::uuid
       ORDER BY created_at DESC`;
    return rows.map(toClaim);
  }

  /**
   * One claim, by the number the buyer quotes.
   *
   * The org id is in the WHERE, so a claim belonging to another organisation
   * comes back `null` and the caller answers 404 — not 403. Claim numbers carry a
   * month and a counter; "you may not see that one" would confirm it exists.
   */
  async claimForOrg(orgId: string, claimNumber: string): Promise<ClaimRow | null> {
    const rows = await this.prisma.$queryRaw<RawClaim[]>`
      SELECT id, claim_number, warranty_id, unit_id, order_line_unit_id, issue_type,
             description, status, resolution, evidence_keys, created_at, updated_at, closed_at
        FROM platform.warranty_claim
       WHERE buyer_org_id = ${orgId}::uuid AND claim_number = ${claimNumber}`;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /** Open claims per unit, so the register can say "already claimed". */
  async openClaimsByUnit(orgId: string, unitIds: readonly string[]): Promise<Map<string, ClaimRow>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<RawClaim[]>`
      SELECT id, claim_number, warranty_id, unit_id, order_line_unit_id, issue_type,
             description, status, resolution, evidence_keys, created_at, updated_at, closed_at
        FROM platform.warranty_claim
       WHERE buyer_org_id = ${orgId}::uuid
         AND unit_id = ANY(${[...unitIds]}::uuid[])
         AND status NOT IN ('CLOSED', 'REJECTED')
       ORDER BY created_at DESC`;
    // Newest first, so the first write per unit wins and the map holds the
    // most recent open claim rather than an arbitrary one.
    const out = new Map<string, ClaimRow>();
    for (const r of rows) if (!out.has(r.unit_id)) out.set(r.unit_id, toClaim(r));
    return out;
  }

  async raiseClaim(input: {
    claimNumber: string;
    warrantyId: string;
    unitId: string;
    orderLineUnitId: string;
    buyerOrgId: string;
    issueType: string;
    description: string;
    evidenceKeys: readonly string[];
  }): Promise<ClaimRow> {
    const rows = await this.prisma.$queryRaw<RawClaim[]>`
      INSERT INTO platform.warranty_claim
             (claim_number, warranty_id, unit_id, order_line_unit_id, buyer_org_id,
              issue_type, description, evidence_keys, status)
      VALUES (${input.claimNumber}, ${input.warrantyId}::uuid, ${input.unitId}::uuid,
              ${input.orderLineUnitId}::uuid, ${input.buyerOrgId}::uuid,
              ${input.issueType}, ${input.description}, ${[...input.evidenceKeys]}::text[],
              'RAISED')
      RETURNING id, claim_number, warranty_id, unit_id, order_line_unit_id, issue_type,
                description, status, resolution, evidence_keys, created_at, updated_at, closed_at`;
    return toClaim(rows[0]!);
  }

  /**
   * The effective-dated knobs the term is built from.
   *
   * `v_current_config` and never `platform_config` itself: the table is
   * effective-dated and reading it directly is how a future-dated rate goes live
   * early. Read fresh every time, for the reason the pricing engine gives — a
   * cached guardrail is one ops changed and nothing happened.
   */
  async config(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...keys]}::text[])`;
    return new Map(rows.map((r) => [r.key, r.value_json]));
  }
}

/**
 * What terms the cover was sold under.
 *
 * A version string rather than a date, because the buyer's cover is governed by
 * the wording in force when they bought — changing the terms document must not
 * retroactively change what an existing machine is covered for. It moves when
 * the published warranty terms move, never on a deploy.
 */
export const TERMS_VERSION = 'TT-WARRANTY-2026-08';
