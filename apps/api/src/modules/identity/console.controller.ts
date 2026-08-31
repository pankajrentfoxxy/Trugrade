import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Permission } from '@trugrade/contracts';
import { PrismaService } from '../../shared/db/prisma.service';
import { RequestContextService } from '../../shared/db/org-scope';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';

/**
 * The console's two cross-module read screens — T35, `03_UX_SPEC.md` §3C and
 * component 25.
 *
 * ## Why both live in `identity`
 *
 * The same reason `OpsController` and `FinanceController` do, and that file
 * states it: an aggregate across module schemas that **no domain owns**. A
 * global palette searches five schemas by definition; a serial's whole life
 * spans six. Neither belongs to `listing` any more than the ops dashboard
 * belongs to `kyc`. The house rule holds unchanged — **separate statements, one
 * module schema each, combined in TypeScript.** `no-cross-schema-join` forbids
 * the JOIN that would be shorter and it is right to: a join from `listing.unit`
 * to `ordering.order_line_unit` is the seam gone, and this is precisely the
 * screen where the pressure to write it peaks.
 *
 * ## The palette does not make the order board's search redundant
 *
 * T39's box filters a paginated board that carries facets, a sort and a URL a
 * colleague can be sent. The palette navigates: it takes an identifier and opens
 * the record behind it. Two different jobs, and the palette deliberately has no
 * facets, no paging and no shareable state — it caps each group and says how
 * many it did not show. Neither is removed.
 *
 * ## A result the caller may not see is never confirmed to exist
 *
 * The same reasoning as T17's 404-not-403 and T32's decision to keep the buyer's
 * order number off a vendor PO. "You don't have access to TT-26-00004" confirms
 * that TT-26-00004 exists, and sequential order numbers make that an
 * order-volume oracle. So a source the caller's role cannot read is **not
 * searched at all** and is reported by NAME in `unavailable` — "orders, which
 * your role cannot search" is a fact about the product; "that order exists but
 * is not yours" is a fact about a record. Only the first is said.
 *
 * The converse honesty matters as much: a source that WAS searched and found
 * nothing prints what it compared against, so nobody concludes the box does not
 * take seal codes because their seal code found nothing. That is T39's rule and
 * it is carried here.
 */

/* ==========================================================================
 * Global search — component 25
 * ======================================================================== */

const searchQuery = z.object({
  q: z.string().trim().min(2).max(120),
});

/** One thing found, and the value that found it. */
interface SearchHit {
  /** The identifier a person reads aloud. Rendered mono. */
  id: string;
  /** What it is, in words. Never the enum. */
  label: string;
  /** One line of context, or null when there is nothing honest to say. */
  detail: string | null;
  /**
   * A rupee amount, unformatted, for the console to render.
   *
   * Separate from `detail` and not interpolated into it: money is formatted
   * in one place in this product (`rupees()` over `Money`), and a server that
   * pasted `₹63305.82` into a sentence would put an unseparated, unaligned
   * number on a screen where every other one is grouped and tabular.
   */
  amount: string | null;
  /**
   * The console route that opens it, or null when no screen exists.
   *
   * Null is real and is not a defect to design away: this build has repeatedly
   * found that a control which looks live and is not is worse than its absence.
   */
  href: string | null;
  /** Which field carried the match, and its value. */
  matchedOn: { field: string; value: string };
}

interface SearchGroup {
  key: string;
  label: string;
  /**
   * The fields this group compared the term against, whether or not it hit.
   *
   * Printed under an empty group. Without it an empty result reads as "this
   * kind of identifier is not supported" rather than "there is no such record".
   */
  comparedWith: readonly string[];
  hits: SearchHit[];
  /** Matches beyond the cap. The palette says so rather than silently truncating. */
  more: number;
}

/** A source this caller's role cannot search, or that has no screen. Never a record. */
interface SearchUnavailable {
  label: string;
  reason: string;
}

interface ConsoleSearch {
  q: string;
  groups: SearchGroup[];
  unavailable: SearchUnavailable[];
  /** Across every group, before the per-group cap. */
  total: number;
}

/** Six per group. A palette is a jump, not a board — the board is `/orders`. */
const PER_GROUP = 6;

/* ==========================================================================
 * The unit 360
 * ======================================================================== */

/** What the machine is, from `catalog`. Null when the SKU is withdrawn. */
interface Unit360Machine {
  skuCode: string;
  title: string;
  spec: string;
}

interface Unit360Qc {
  score: number | null;
  verdict: string | null;
  gradeProposed: string | null;
  gradeFinal: string | null;
  /** `qc_technician.employee_code` — pseudonymous by design, e.g. `TECH-0142`. */
  technicianCode: string | null;
  inspectedAt: string | null;
  validUntil: string | null;
  /** False when a later report superseded this one. */
  isCurrent: boolean;
  batteryHealthPct: string | null;
  cycleCount: number | null;
  powerOnHours: number | null;
  storage: string | null;
  cpu: string | null;
  ramGb: number | null;
}

interface Unit360Seal {
  sealCode: string;
  /** `APPLIED` is NOT `INTACT`. `SealChip` keeps that true on the screen. */
  status: string;
  appliedAt: string;
  verifiedAt: string | null;
  brokenAt: string | null;
  brokenReason: string | null;
}

interface Unit360Movement {
  at: string;
  fromStatus: string | null;
  toStatus: string;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string | null;
  refType: string | null;
  actorName: string | null;
}

interface Unit360Warranty {
  status: string;
  startDate: string;
  endDate: string;
  totalMonths: number;
  vendorBackedMonths: number;
  platformBackedMonths: number;
}

/**
 * A return against this machine.
 *
 * **No buyer is named here.** Who returned it belongs to the commercial half,
 * which is separately permissioned; that it came back, why, and what our own
 * re-inspection concluded belong to the machine and are what a technician needs.
 */
interface Unit360Return {
  returnNumber: string;
  status: string;
  reasonCode: string;
  raisedAt: string;
  /** Our re-inspection's verdict, when one has happened. */
  qcVerdict: string | null;
  liableParty: string | null;
}

/** The trade. Present only for a caller who may see both sides. */
interface Unit360Commercial {
  orderNumber: string;
  orderStatus: string;
  placedAt: string;
  buyerLegalName: string | null;
  soldFor: string;
  lineStatus: string;
  poNumber: string | null;
  poStatus: string | null;
  /** What we agreed to pay for this exact serial. Null when no PO line covers it. */
  paid: string | null;
  /** `soldFor - paid`, in rupees. Null whenever `paid` is. */
  margin: string | null;
  /** Why the PO half is missing, when it is. Names the known defect by name. */
  poUnavailable: string | null;
}

interface Unit360 {
  serialNumber: string;
  status: string;
  location: string;
  isSellable: boolean;
  gradeDeclared: string;
  /** Null until a technician has inspected it. Never defaulted to the declared one. */
  gradeActual: string | null;
  createdAt: string;
  supplyPointLegalName: string | null;
  supplyPointCode: string | null;
  valuationMethod: string;
  itcEligible: boolean;
  machine: Unit360Machine | null;
  qc: Unit360Qc | null;
  /** Present exactly when `qc` is null, and it names the reason. */
  qcUnavailable: string | null;
  seal: Unit360Seal | null;
  movements: Unit360Movement[];
  warranty: Unit360Warranty | null;
  returns: Unit360Return[];
  commercial: Unit360Commercial | null;
  /** Present when `commercial` is null: not allocated, or not permitted. */
  commercialUnavailable: string | null;
  /**
   * How many `identity.audit_log` rows name this machine.
   *
   * A count and not a list, because on this database it is **zero for every
   * serial** — the log records identity, onboarding and KYC, and nothing in the
   * unit's life writes to it. An empty timeline would read as "a clean history";
   * a stated zero with the reason reads as what it is.
   */
  auditEntries: number;
}

/* ========================================================================== */

interface UnitRow {
  id: string;
  serial_number: string;
  listing_id: string | null;
  vendor_org_id: string;
  sku_id: string;
  grade_declared: string;
  grade_actual: string | null;
  status: string;
  location: string;
  supply_point_code: string | null;
  valuation_method: string;
  itc_eligible: boolean;
  is_sellable: boolean;
  qc_report_id: string | null;
  created_at: Date;
}

@Controller('ops')
export class ConsoleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * Platform staff only, refused here rather than by a permission.
   *
   * Copied deliberately from `OpsController.requirePlatform` — there is no
   * single permission that means "you work here", and both of these screens are
   * assembled from whatever slice the caller holds. The permission check is per
   * SOURCE below; this is the outer door.
   *
   * It matters more here than on the dashboard. `platform.ticket.read` is held
   * by VENDOR_OWNER and VENDOR_ADMIN, and a search gated on per-source
   * permissions alone would have handed a vendor a box over every ticket on the
   * platform. That is the exact shape of the defect
   * `qc-console-is-not-vendor-reachable.spec.ts` exists to catch.
   */
  private requirePlatform(): ReadonlySet<Permission> {
    const principal = this.ctx.requirePrincipal();
    if (principal.orgType !== 'PLATFORM') {
      throw new ForbiddenError('This is the platform’s own workspace.', {
        reason: 'console_search_outside_platform',
      });
    }
    return principal.permissions;
  }

  /* ----------------------------------------------------------------------
   * GET /api/ops/search
   * ------------------------------------------------------------------- */

  @Get('search')
  async search(
    @Query(new ZodValidationPipe(searchQuery)) query: { q: string },
  ): Promise<ConsoleSearch> {
    const held = this.requirePlatform();
    const can = (p: Permission): boolean => held.has(p);
    const like = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;

    const groups: SearchGroup[] = [];
    const unavailable: SearchUnavailable[] = [];

    // --- Machines -------------------------------------------------------
    //
    // Serial and seal code in one group, because a seal code is a way of naming
    // a machine and the only screen either opens is the same one. The seal half
    // needs `qc.report.read` on top: a CATALOG_ADMIN holds `listing.any.read`
    // and no qc permission, so it searches serials only — and the group says so
    // rather than silently comparing against less than it claims.
    if (can('listing.any.read')) {
      const bySeal = can('qc.report.read') ? await this.unitIdsBySeal(like) : new Map();
      groups.push(await this.machines(like, bySeal, can('qc.report.read')));
    } else {
      unavailable.push({
        label: 'Machines',
        reason:
          'Your role cannot read the platform’s stock, so serials and seal codes were not searched.',
      });
    }

    // --- Orders ---------------------------------------------------------
    if (can('ordering.any.read')) {
      groups.push(await this.orders(like));
    } else {
      unavailable.push({
        label: 'Orders',
        reason:
          'Your role cannot read orders across the platform, so order numbers and buyers’ own PO references were not searched.',
      });
    }

    // --- Purchase orders ------------------------------------------------
    if (can('procurement.po.read_any')) {
      groups.push(await this.purchaseOrders(like));
    } else {
      unavailable.push({
        label: 'Purchase orders',
        reason:
          'Your role cannot read purchase orders, so PO numbers were not searched.',
      });
    }

    // --- Organisations --------------------------------------------------
    //
    // `kyc.application.read` and not `identity.user.read`: the second is held by
    // every vendor and buyer owner for their OWN people, and gating a
    // platform-wide organisation search on it would be an own-scoped permission
    // spent on an any-scoped query. That is the exact mistake `roles.ts`
    // documents for `qc.report.read`.
    if (can('kyc.application.read')) {
      groups.push(await this.organisations(like));
    } else {
      unavailable.push({
        label: 'Organisations',
        reason:
          'Your role cannot read onboarding records, so legal names, trade names and GSTINs were not searched.',
      });
    }

    // --- Tickets: searchable in principle, and there is nowhere to send you --
    //
    // §2.2 lists Tickets as a palette source. `platform.ticket` holds eleven
    // rows and `/admin/support` is not built, so every hit would be a row that
    // opens nothing. A result you cannot act on is the dead-control pattern this
    // build keeps finding; naming the gap is the honest form of it.
    unavailable.push({
      label: 'Support tickets',
      reason:
        'The ticket desk has no screen in this console yet, so a ticket number found here would open nothing. Not searched.',
    });

    return {
      q: query.q,
      groups,
      unavailable,
      total: groups.reduce((n, g) => n + g.hits.length + g.more, 0),
    };
  }

  /** Seal code → unit id. `qc` only; `qc` owns what a seal code means. */
  private async unitIdsBySeal(like: string): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string; seal_code: string }>>`
      SELECT unit_id, seal_code FROM qc.qc_seal WHERE seal_code ILIKE ${like} LIMIT 50`;
    return new Map(rows.map((r) => [r.unit_id, r.seal_code]));
  }

  private async machines(
    like: string,
    bySeal: ReadonlyMap<string, string>,
    sealsSearched: boolean,
  ): Promise<SearchGroup> {
    const sealUnitIds = [...bySeal.keys()];
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        serial_number: string;
        status: string;
        grade_actual: string | null;
        grade_declared: string;
      }>
    >`
      SELECT id, serial_number, status::text AS status,
             grade_actual::text AS grade_actual, grade_declared::text AS grade_declared
        FROM listing.unit
       WHERE serial_number ILIKE ${like} OR id = ANY(${sealUnitIds}::uuid[])
       ORDER BY serial_number
       LIMIT ${PER_GROUP + 1}`;

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM listing.unit
       WHERE serial_number ILIKE ${like} OR id = ANY(${sealUnitIds}::uuid[])`;

    const total = counted?.total ?? 0;
    return {
      key: 'machines',
      label: 'Machines',
      comparedWith: sealsSearched
        ? ['the serial number', 'the seal code']
        : [
            'the serial number',
            // Named as NOT compared, rather than quietly dropped.
            'not the seal code — that needs a QC permission your role does not hold',
          ],
      hits: rows.slice(0, PER_GROUP).map((r) => {
        const seal = bySeal.get(r.id);
        return {
          id: r.serial_number,
          label: 'Machine',
          // The inspected grade, never the vendor's declared one dressed up as
          // it. A machine nobody has opened says so.
          detail:
            r.grade_actual === null
              ? `${humanise(r.status)} · not yet inspected`
              : `${humanise(r.status)} · grade ${gradeWord(r.grade_actual)}`,
          amount: null,
          href: `/units/${encodeURIComponent(r.serial_number)}`,
          // The serial wins when both matched, and that is not arbitrary: the
          // seed writes seal codes as `TG-<serial>`, so every serial search
          // would otherwise report itself as a seal-code match and read as a
          // box that cannot find a serial.
          matchedOn:
            seal !== undefined && !matchesLike(r.serial_number, like)
              ? { field: 'seal code', value: seal }
              : { field: 'serial', value: r.serial_number },
        };
      }),
      more: Math.max(0, total - PER_GROUP),
    };
  }

  private async orders(like: string): Promise<SearchGroup> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        order_number: string;
        status: string;
        buyer_po_number: string | null;
        placed_at: Date;
        grand_total: string;
      }>
    >`
      SELECT order_number, status::text AS status, buyer_po_number, placed_at,
             grand_total::text AS grand_total
        FROM ordering."order"
       WHERE order_number ILIKE ${like} OR buyer_po_number ILIKE ${like}
       ORDER BY placed_at DESC
       LIMIT ${PER_GROUP + 1}`;

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM ordering."order"
       WHERE order_number ILIKE ${like} OR buyer_po_number ILIKE ${like}`;

    const total = counted?.total ?? 0;
    return {
      key: 'orders',
      label: 'Orders',
      comparedWith: ['our order number', 'the buyer’s own PO reference'],
      hits: rows.slice(0, PER_GROUP).map((r) => ({
        id: r.order_number,
        label: 'Order',
        detail: humanise(r.status),
        amount: r.grand_total,
        href: `/orders/${encodeURIComponent(r.order_number)}`,
        matchedOn: matchesLike(r.order_number, like)
          ? { field: 'order number', value: r.order_number }
          : { field: 'their PO reference', value: r.buyer_po_number ?? r.order_number },
      })),
      more: Math.max(0, total - PER_GROUP),
    };
  }

  private async purchaseOrders(like: string): Promise<SearchGroup> {
    const rows = await this.prisma.$queryRaw<
      Array<{ po_number: string; status: string; total_net: string; created_at: Date }>
    >`
      SELECT po_number, status::text AS status, total_net::text AS total_net, created_at
        FROM procurement.purchase_order
       WHERE po_number ILIKE ${like}
       ORDER BY created_at DESC
       LIMIT ${PER_GROUP + 1}`;

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM procurement.purchase_order
       WHERE po_number ILIKE ${like}`;

    const total = counted?.total ?? 0;
    return {
      key: 'purchase-orders',
      label: 'Purchase orders',
      comparedWith: ['the purchase-order number'],
      hits: rows.slice(0, PER_GROUP).map((r) => ({
        id: r.po_number,
        label: 'Purchase order',
        detail: `${humanise(r.status)} · net`,
        amount: r.total_net,
        // The PO board is a filtered board, not a record route — T39 built it
        // that way and a link to a record that does not exist is a link to
        // nowhere.
        href: `/procurement/pos?q=${encodeURIComponent(r.po_number)}`,
        matchedOn: { field: 'PO number', value: r.po_number },
      })),
      more: Math.max(0, total - PER_GROUP),
    };
  }

  private async organisations(like: string): Promise<SearchGroup> {
    // Two schemas, two statements. `identity.organization` holds the names;
    // `kyc.gst_profile` holds the registration, and joining them would be the
    // seam gone for the sake of one query.
    const byGstin = await this.prisma.$queryRaw<Array<{ org_id: string; gstin: string }>>`
      SELECT org_id, gstin FROM kyc.gst_profile WHERE gstin ILIKE ${like} LIMIT 50`;
    const gstins = new Map(byGstin.map((r) => [r.org_id, r.gstin]));

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        legal_name: string;
        trade_name: string | null;
        org_type: string;
        status: string;
      }>
    >`
      SELECT id, legal_name, trade_name, org_type::text AS org_type, status::text AS status
        FROM identity.organization
       WHERE legal_name ILIKE ${like} OR trade_name ILIKE ${like}
          OR id = ANY(${[...gstins.keys()]}::uuid[])
       ORDER BY legal_name
       LIMIT ${PER_GROUP + 1}`;

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM identity.organization
       WHERE legal_name ILIKE ${like} OR trade_name ILIKE ${like}
          OR id = ANY(${[...gstins.keys()]}::uuid[])`;

    const total = counted?.total ?? 0;
    return {
      key: 'organisations',
      label: 'Organisations',
      comparedWith: ['the legal name', 'the trade name', 'the GSTIN'],
      hits: rows.slice(0, PER_GROUP).map((r) => {
        const gstin = gstins.get(r.id);
        return {
          id: r.legal_name,
          label: humanise(r.org_type),
          detail: humanise(r.status),
          amount: null,
          href: `/kyc/${r.id}`,
          matchedOn:
            gstin !== undefined
              ? { field: 'GSTIN', value: gstin }
              : matchesLike(r.legal_name, like)
                ? { field: 'legal name', value: r.legal_name }
                : { field: 'trade name', value: r.trade_name ?? r.legal_name },
        };
      }),
      more: Math.max(0, total - PER_GROUP),
    };
  }

  /* ----------------------------------------------------------------------
   * GET /api/ops/units/:serial — the unit 360
   * ------------------------------------------------------------------- */

  /**
   * One machine's whole life, assembled from six schemas.
   *
   * **Built from an explicit allow-list, field by field.** Every interface above
   * is hand-written and every value below is copied into it by name. There is no
   * `return unit` anywhere in this method and there must never be: `listing.unit`
   * carries `vendor_org_id`, `purchase_price` and `hw_fingerprint_hash`, and this
   * shape is the only thing standing between that row and a screen.
   *
   * **Two halves, two permissions.** `listing.any.read` is held by TECHNICIAN
   * and CATALOG_ADMIN as well as ops, and it is the right gate for the machine:
   * what it is, what we found when we opened it, where it has been, whether it
   * came back. It is the wrong gate for the trade — who bought it, for how much,
   * and what we paid — so that half additionally requires `ordering.any.read`,
   * and its absence is stated rather than rendered as an empty panel.
   */
  @Get('units/:serial')
  async unit(@Param('serial') serial: string): Promise<Unit360> {
    const held = this.requirePlatform();
    if (!held.has('listing.any.read')) {
      throw new ForbiddenError("You don't have permission to do that.", {
        missing: ['listing.any.read'],
      });
    }

    const [unit] = await this.prisma.$queryRaw<UnitRow[]>`
      SELECT id, serial_number, listing_id, vendor_org_id, sku_id,
             grade_declared::text AS grade_declared, grade_actual::text AS grade_actual,
             status::text AS status, location, supply_point_code, valuation_method,
             itc_eligible, is_sellable, qc_report_id, created_at
        FROM listing.unit WHERE serial_number = ${serial}`;

    // `NotFoundError` never names what it looked for. A message that said
    // "no unit TGD5963139B" would confirm the format of one that does exist.
    if (!unit) throw new NotFoundError('machine', { reason: 'unit_360_not_found' });

    const [machine, qc, seal, movements, warranty, auditEntries, supplyPoint] = await Promise.all([
      this.machineOf(unit.sku_id),
      this.qcOf(unit.id),
      this.sealOf(unit.id),
      this.movementsOf(unit.id),
      this.warrantyOf(unit.id),
      this.auditCountFor(unit.id, unit.serial_number),
      this.orgName(unit.vendor_org_id),
    ]);

    const allocation = await this.allocationOf(unit.id);
    const returns = allocation === null ? [] : await this.returnsOf(allocation.orderLineUnitId);
    const commercial = held.has('ordering.any.read')
      ? await this.commercialOf(unit.id, allocation, held.has('procurement.po.read_any'))
      : null;

    return {
      serialNumber: unit.serial_number,
      status: unit.status,
      location: unit.location,
      isSellable: unit.is_sellable,
      gradeDeclared: unit.grade_declared,
      gradeActual: unit.grade_actual,
      createdAt: unit.created_at.toISOString(),
      supplyPointLegalName: supplyPoint,
      supplyPointCode: unit.supply_point_code,
      valuationMethod: unit.valuation_method,
      itcEligible: unit.itc_eligible,
      machine,
      qc,
      qcUnavailable:
        qc !== null
          ? null
          : unit.qc_report_id === null
            ? 'No technician has inspected this machine. Nothing on this screen states its condition, because nothing has measured it.'
            : 'This machine carries a QC report id that no report answers to. Treat its grade as unverified.',
      seal,
      movements,
      warranty,
      returns,
      commercial,
      commercialUnavailable:
        commercial !== null
          ? null
          : !held.has('ordering.any.read')
            ? 'Your role reads the platform’s stock but not its orders. Who bought this machine, for how much, and what we paid the supply point are not shown here. The movement trail does name the order it was reserved for — that line is `listing`’s own record of this machine and is not withheld.'
            : allocation === null
              ? 'This machine has never been allocated to an order.'
              : 'This machine is allocated to an order that could not be read.',
      auditEntries,
    };
  }

  /** `catalog` only — sku → model → series → brand is one schema, so one statement. */
  private async machineOf(skuId: string): Promise<Unit360Machine | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        sku_code: string;
        brand: string;
        model: string;
        cpu_family: string;
        ram_gb: number;
        storage_gb: number;
        storage_type: string;
        screen_size_in: string | null;
      }>
    >`
      SELECT s.sku_code, b.name AS brand, m.name AS model, s.cpu_family, s.ram_gb,
             s.storage_gb, s.storage_type, s.screen_size_inch::text AS screen_size_in
        FROM catalog.sku s
        JOIN catalog.model m ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b ON b.id = se.brand_id
       WHERE s.id = ${skuId}::uuid`;
    if (!row) return null;
    return {
      skuCode: row.sku_code,
      title: `${row.brand} ${row.model}`.trim(),
      spec: [
        row.cpu_family,
        `${row.ram_gb} GB`,
        `${row.storage_gb} GB ${row.storage_type}`,
        row.screen_size_in === null ? null : `${row.screen_size_in}"`,
      ]
        .filter((p): p is string => p !== null)
        .join(' · '),
    };
  }

  /**
   * The current inspection. `qc` only — report, hardware and technician are all
   * this module's tables, so one statement is legal and one statement it is.
   *
   * `is_current` is carried rather than filtered on. A superseded report is
   * still what the machine was graded on at the time, and hiding it would make
   * a re-inspected machine look like one that was never inspected at all.
   */
  private async qcOf(unitId: string): Promise<Unit360Qc | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        qc_score: number | null;
        verdict: string | null;
        grade_proposed: string | null;
        grade_final: string | null;
        completed_at: Date | null;
        valid_until: Date | null;
        is_current: boolean;
        employee_code: string | null;
        battery_health_pct: string | null;
        cycle_count: number | null;
        power_on_hours: number | null;
        storage_model: string | null;
        cpu_detected: string | null;
        ram_detected_gb: number | null;
      }>
    >`
      SELECT r.qc_score, r.verdict::text AS verdict, r.grade_proposed::text AS grade_proposed,
             r.grade_final::text AS grade_final, r.completed_at, r.valid_until, r.is_current,
             t.employee_code,
             h.battery_health_pct::text AS battery_health_pct, h.cycle_count, h.power_on_hours,
             h.storage_model, h.cpu_detected, h.ram_detected_gb
        FROM qc.qc_report r
        LEFT JOIN qc.qc_technician t ON t.id = r.technician_id
        LEFT JOIN qc.qc_hardware_detected h ON h.qc_report_id = r.id
       WHERE r.unit_id = ${unitId}::uuid
       ORDER BY r.is_current DESC, r.started_at DESC
       LIMIT 1`;
    if (!row) return null;
    return {
      score: row.qc_score,
      verdict: row.verdict,
      gradeProposed: row.grade_proposed,
      gradeFinal: row.grade_final,
      technicianCode: row.employee_code,
      inspectedAt: row.completed_at?.toISOString() ?? null,
      validUntil: row.valid_until?.toISOString().slice(0, 10) ?? null,
      isCurrent: row.is_current,
      batteryHealthPct: row.battery_health_pct,
      cycleCount: row.cycle_count,
      powerOnHours: row.power_on_hours,
      storage: row.storage_model,
      cpu: row.cpu_detected,
      ramGb: row.ram_detected_gb,
    };
  }

  private async sealOf(unitId: string): Promise<Unit360Seal | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        seal_code: string;
        status: string;
        applied_at: Date;
        verified_at: Date | null;
        broken_at: Date | null;
        broken_reason: string | null;
      }>
    >`
      SELECT seal_code, status::text AS status, applied_at, verified_at, broken_at, broken_reason
        FROM qc.qc_seal WHERE unit_id = ${unitId}::uuid
       ORDER BY applied_at DESC LIMIT 1`;
    if (!row) return null;
    return {
      sealCode: row.seal_code,
      status: row.status,
      appliedAt: row.applied_at.toISOString(),
      verifiedAt: row.verified_at?.toISOString() ?? null,
      brokenAt: row.broken_at?.toISOString() ?? null,
      brokenReason: row.broken_reason,
    };
  }

  /**
   * Every movement, newest first, with the person behind it where there was one.
   *
   * `listing.stock_movement` is 217 rows across 262 machines and is the closest
   * thing this product has to a custody trail for a serial. The actor names come
   * from `identity` in a second statement.
   */
  private async movementsOf(unitId: string): Promise<Unit360Movement[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        occurred_at: Date;
        from_status: string | null;
        to_status: string;
        from_location: string | null;
        to_location: string | null;
        reason: string | null;
        ref_type: string | null;
        actor_id: string | null;
      }>
    >`
      SELECT occurred_at, from_status::text AS from_status, to_status::text AS to_status,
             from_location, to_location, reason, ref_type, actor_id
        FROM listing.stock_movement WHERE unit_id = ${unitId}::uuid
       ORDER BY occurred_at DESC, id DESC`;

    const names = await this.names(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])));
    return rows.map((r) => ({
      at: r.occurred_at.toISOString(),
      fromStatus: r.from_status,
      toStatus: r.to_status,
      fromLocation: r.from_location,
      toLocation: r.to_location,
      reason: r.reason,
      refType: r.ref_type,
      // Never defaulted to "System": a movement whose actor is a guess is worse
      // than one that admits no person was recorded against it.
      actorName: r.actor_id === null ? null : (names.get(r.actor_id) ?? null),
    }));
  }

  private async warrantyOf(unitId: string): Promise<Unit360Warranty | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        status: string;
        start_date: Date;
        end_date: Date;
        total_months: number;
        vendor_backed_months: number;
        platform_backed_months: number;
      }>
    >`
      SELECT status, start_date, end_date, total_months, vendor_backed_months,
             platform_backed_months
        FROM platform.warranty WHERE unit_id = ${unitId}::uuid
       ORDER BY start_date DESC LIMIT 1`;
    if (!row) return null;
    return {
      status: row.status,
      startDate: row.start_date.toISOString().slice(0, 10),
      endDate: row.end_date.toISOString().slice(0, 10),
      totalMonths: row.total_months,
      vendorBackedMonths: row.vendor_backed_months,
      platformBackedMonths: row.platform_backed_months,
    };
  }

  /** T24's returns, and our own re-inspection of what came back. `platform` only. */
  private async returnsOf(orderLineUnitId: string): Promise<Unit360Return[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        return_number: string;
        status: string;
        reason_code: string;
        raised_at: Date;
        verdict: string | null;
        liable_party: string | null;
      }>
    >`
      SELECT r.return_number, r.status, r.reason_code, r.raised_at,
             q.verdict, q.liable_party
        FROM platform.return_request r
        LEFT JOIN platform.return_qc q ON q.return_request_id = r.id
       WHERE r.order_line_unit_id = ${orderLineUnitId}::uuid
       ORDER BY r.raised_at DESC`;
    return rows.map((r) => ({
      returnNumber: r.return_number,
      status: r.status,
      reasonCode: r.reason_code,
      raisedAt: r.raised_at.toISOString(),
      qcVerdict: r.verdict,
      liableParty: r.liable_party,
    }));
  }

  /**
   * Which order line holds this serial, if any. `ordering` only.
   *
   * Read for EVERY caller, not only one who may see the trade: the id is needed
   * to find the machine's returns, which belong to the machine. Nothing from
   * this row reaches the response unless the commercial half is permitted.
   *
   * `order_line_unit.unit_id` is UNIQUE, so there is at most one of these and no
   * ordering is needed to pick "the" allocation.
   */
  private async allocationOf(unitId: string): Promise<{
    orderLineUnitId: string;
    orderId: string;
    lineStatus: string;
    unitPrice: string;
  } | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ id: string; order_id: string; status: string; unit_price: string }>
    >`
      SELECT olu.id, so.order_id, olu.status::text AS status, ol.unit_price::text AS unit_price
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE olu.unit_id = ${unitId}::uuid`;
    if (!row) return null;
    return {
      orderLineUnitId: row.id,
      orderId: row.order_id,
      lineStatus: row.status,
      unitPrice: row.unit_price,
    };
  }

  /**
   * The trade, both sides, for a caller permitted to see it.
   *
   * **The margin is per serial and is refused rather than approximated.** Two
   * orders on this database — TT-26-00007 and TT-26-00009 — are DELIVERED with a
   * pending approval and no purchase order at all. A machine on one of those
   * cannot state what we paid, so it states that, by name, instead of leaving
   * the field blank and letting a blank read as zero.
   */
  private async commercialOf(
    unitId: string,
    allocation: Awaited<ReturnType<ConsoleController['allocationOf']>>,
    canReadPos: boolean,
  ): Promise<Unit360Commercial | null> {
    if (allocation === null) return null;

    const [order] = await this.prisma.$queryRaw<
      Array<{
        order_number: string;
        status: string;
        placed_at: Date;
        buyer_org_id: string;
      }>
    >`
      SELECT order_number, status::text AS status, placed_at, buyer_org_id
        FROM ordering."order" WHERE id = ${allocation.orderId}::uuid`;
    if (!order) return null;

    const [buyer, po] = await Promise.all([
      this.orgName(order.buyer_org_id),
      canReadPos ? this.poForUnit(unitId) : Promise.resolve(null),
    ]);

    const paid = po?.paid ?? null;
    return {
      orderNumber: order.order_number,
      orderStatus: order.status,
      placedAt: order.placed_at.toISOString(),
      buyerLegalName: buyer,
      soldFor: allocation.unitPrice,
      lineStatus: allocation.lineStatus,
      poNumber: po?.poNumber ?? null,
      poStatus: po?.status ?? null,
      paid,
      // Paise in integers. Floating point on money is the defect that produces a
      // one-paisa discrepancy nobody can reconcile.
      margin:
        paid === null
          ? null
          : fromPaise(toPaise(allocation.unitPrice) - toPaise(paid)),
      poUnavailable:
        po !== null
          ? null
          : !canReadPos
            ? 'Your role reads orders but not purchase orders, so what we paid for this machine is not shown.'
            : 'No purchase-order line covers this serial, so what we agreed to pay for it is not recorded anywhere. The margin cannot be stated.',
    };
  }

  /** What we agreed to pay for this exact serial. `procurement` only. */
  private async poForUnit(
    unitId: string,
  ): Promise<{ poNumber: string; status: string; paid: string } | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ po_number: string; status: string; agreed_net_payout: string }>
    >`
      SELECT po.po_number, po.status::text AS status,
             l.agreed_net_payout::text AS agreed_net_payout
        FROM procurement.purchase_order_line l
        JOIN procurement.purchase_order po ON po.id = l.po_id
       WHERE l.unit_id = ${unitId}::uuid
       LIMIT 1`;
    if (!row) return null;
    return { poNumber: row.po_number, status: row.status, paid: row.agreed_net_payout };
  }

  /**
   * How many audit-log rows name this machine.
   *
   * **It is zero for every serial on this database, and that is the finding.**
   * `identity.audit_log` holds 1,653 rows and every one of them is an identity,
   * onboarding, KYC or invoice event — nothing in a unit's life writes to it.
   * The screen prints the zero with that sentence beside it, because an empty
   * evidence table reads as a clean history and this one is not a history at all.
   */
  private async auditCountFor(unitId: string, serial: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM identity.audit_log
       WHERE entity_id = ${unitId} OR entity_id = ${serial}`;
    return row?.n ?? 0;
  }

  private async orgName(orgId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE id = ${orgId}::uuid`;
    return row?.legal_name ?? null;
  }

  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account
       WHERE id = ANY(${[...new Set(userIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}

/* ==========================================================================
 * Small pure helpers
 * ======================================================================== */

/** `PAYMENT_PENDING` → `Payment pending`. Mirrors `routes/ops/api.ts`. */
function humanise(value: string): string {
  const words = value.replace(/[._]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `A_PLUS` → `A+`. The badge is neutral; only the word changes. */
function gradeWord(grade: string): string {
  return grade === 'A_PLUS' ? 'A+' : grade;
}

/**
 * Did this value carry the match, given the `%like%` the query used?
 *
 * Used only to say WHICH field matched on a row that matched on one of two, so
 * a wrong answer costs a label and never a row.
 */
function matchesLike(value: string | null, like: string): boolean {
  if (value === null) return false;
  return value.toLowerCase().includes(like.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase());
}

const toPaise = (rupees: string): number => Math.round(Number(rupees) * 100);
const fromPaise = (paise: number): string => (paise / 100).toFixed(2);
