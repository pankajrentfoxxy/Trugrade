import { Injectable } from '@nestjs/common';
import { TIMEZONE } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { OrderingLookup } from './ordering-lookup';
import { WarrantyRepository, TERMS_VERSION, type ClaimRow } from './warranty.repository';

/**
 * Warranty cover and warranty claims — T23, `03_UX_SPEC.md` §3A.4 and §4.6.
 *
 * ---------------------------------------------------------------------------
 * WHAT CREATES A WARRANTY ROW
 * ---------------------------------------------------------------------------
 * Delivery, and nothing else. Cover starts when the buyer has the machine, not
 * when they paid for it and not when it left the supply point — a term that ran
 * while the laptop was on a lorry would be a term we sold and did not give.
 *
 * That answer was not available until now: `logistics.shipment` and
 * `logistics.delivery_task` are both empty and neither has a writer, so there
 * was no delivery on the database to hang it from. `ordering`'s delivery
 * endpoint is what supplies the instant, and it calls in here through the
 * barrel; see `DeliveryService` for why that is an operator action rather than
 * an inferred one.
 *
 * ---------------------------------------------------------------------------
 * THE TERM, AND THE ONE NUMBER THE CUSTOMER SEES
 * ---------------------------------------------------------------------------
 * `total = max(vendor months + the platform top-up, the platform floor)` — the
 * same arithmetic the PRICE was built from, which is why the buyer is covered
 * for exactly what they were sold. The floor is why "we have not agreed a
 * top-up with this supply point" never renders as "no warranty".
 *
 * The split into `vendor_backed_months` and `platform_backed_months` is stored,
 * because a claim inside the vendor-backed window is settled with the customer
 * immediately and recovered from the supply point afterwards. **It never leaves
 * this module.** `FORBIDDEN_CUSTOMER_KEYS` lists `vendorBackedMonths` and
 * `platformBackedMonths` by name, and the customer view below is an explicit
 * allow-list built field by field — there is no `return warranty` here and
 * nothing on the returned shape a vendor identifier could travel in.
 *
 * ---------------------------------------------------------------------------
 * EVERY DATE IS DECIDED ON THE SERVER
 * ---------------------------------------------------------------------------
 * "Is this still in warranty" is a money question, so it is answered here from
 * `ClockPort` against the IST business calendar, and the browser is told the
 * answer rather than the ingredients. `daysRemaining` and `inWarranty` are
 * fields on the payload, not a subtraction the page does — a page that decided
 * for itself would let a wrong laptop clock offer a paid repair on a machine
 * that is covered, or accept a claim on one that is not.
 */

/* ==========================================================================
 * The customer-facing shapes — allow-lists, built field by field
 * ======================================================================== */

/** What we cover, said once. Tied to `TERMS_VERSION` so the wording and the row move together. */
export interface WarrantyTerms {
  version: string;
  covers: readonly string[];
  excludes: readonly string[];
}

export interface CoveredMachine {
  serialNumber: string;
  orderNumber: string;
  orderedOn: string;
  title: string | null;
  specSummary: string | null;
  /** Where the machine's full inspection record lives. The serial is the address. */
  passportPath: string;
  /**
   * Null when the machine has not been delivered. **Not an expired warranty and
   * not a zero-day one** — nothing has started, and the screen says so rather
   * than drawing an absent term as a lapsed one.
   */
  cover: {
    startDate: string;
    endDate: string;
    /** The ONE number. The vendor/platform split is not on this shape. */
    totalMonths: number;
    /** Decided here, on the IST calendar. Negative is never returned. */
    daysRemaining: number;
    /** The server's verdict, not the browser's subtraction. */
    inWarranty: boolean;
    /** True inside 30 days of expiry, and only while still in warranty. */
    expiringSoon: boolean;
  } | null;
  /** The open claim on this machine, if there is one. */
  openClaim: { claimNumber: string; status: string; raisedOn: string } | null;
}

export interface WarrantyRegister {
  machines: readonly CoveredMachine[];
  terms: WarrantyTerms;
  /** Today on the IST calendar, so the page can show the date it was reckoned against. */
  asOf: string;
}

export interface ClaimView {
  claimNumber: string;
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  status: string;
  /** One of the twelve QC areas, so triage can compare it against the report. */
  faultArea: string;
  description: string;
  evidenceCount: number;
  raisedOn: string;
  updatedOn: string;
  closedOn: string | null;
  resolution: string | null;
  passportPath: string;
}

/**
 * The twelve inspection areas, which are also the twelve fault categories.
 *
 * Deliberately the same vocabulary rather than a friendlier parallel list: a
 * claim's category is compared against the original QC report's result for that
 * exact area during triage (§4.6 step 3), and a second vocabulary would need a
 * mapping table that is wrong the first time an area is added.
 */
export const FAULT_AREAS = [
  'BATTERY',
  'BIOS_SECURITY',
  'CAMERA_AUDIO',
  'CONNECTIVITY',
  'DATA_SECURITY',
  'DISPLAY',
  'KEYBOARD',
  'MEMORY_CPU',
  'PHYSICAL',
  'PORTS',
  'STORAGE',
  'THERMAL',
] as const;

export type FaultArea = (typeof FAULT_AREAS)[number];

const TERMS: WarrantyTerms = {
  version: TERMS_VERSION,
  covers: [
    'Any fault in the twelve areas we inspected, found within the term',
    'Repair, part replacement or a replacement machine — our choice, at our cost',
    'Collection from your site and return, both ways',
  ],
  excludes: [
    'Accidental damage, liquid ingress and cosmetic wear after delivery',
    'Consumables, and software you installed',
    'A machine opened or repaired by anyone else — this breaks the seal we applied',
  ],
};

const CONFIG_KEYS = ['platform.warranty_top_up_months', 'platform.warranty_min_total_months'];

export interface OpenWarrantyUnit {
  unitId: string;
  vendorOrgId: string;
  vendorWarrantyMonths: number;
  deliveredAt: Date;
}

@Injectable()
export class WarrantyService {
  constructor(
    private readonly repo: WarrantyRepository,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly ordering: OrderingLookup,
  ) {}

  /* ------------------------------------------------------------------------
   * The write — delivery opens cover
   * ---------------------------------------------------------------------- */

  async openWarranties(
    units: readonly OpenWarrantyUnit[],
  ): Promise<{ opened: number; alreadyCovered: number }> {
    if (units.length === 0) return { opened: 0, alreadyCovered: 0 };

    const config = await this.repo.config(CONFIG_KEYS);
    const topUp = wholeMonths(config, 'platform.warranty_top_up_months');
    const floor = wholeMonths(config, 'platform.warranty_min_total_months');

    const inputs = units.map((u) => {
      const total = Math.max(u.vendorWarrantyMonths + topUp, floor);
      // The vendor cannot back more of the term than the term has. A supply
      // point offering 24 months on a 24-month total leaves us backing none of
      // it, and `chk_warranty_split` requires the two to add to the total.
      const vendorBacked = Math.min(Math.max(u.vendorWarrantyMonths, 0), total);
      const start = istDate(u.deliveredAt);
      return {
        unitId: u.unitId,
        startDate: start,
        endDate: addMonths(start, total),
        totalMonths: total,
        vendorBackedMonths: vendorBacked,
        platformBackedMonths: total - vendorBacked,
        vendorOrgId: u.vendorOrgId,
      };
    });

    const opened = await this.repo.open(inputs);
    return { opened, alreadyCovered: units.length - opened };
  }

  /* ------------------------------------------------------------------------
   * The register — every machine this organisation owns
   * ---------------------------------------------------------------------- */

  async register(): Promise<WarrantyRegister> {
    const orgId = this.buyerOrgId();
    const owned = await this.ordering.ownedUnits();
    const cover = new Map((await this.repo.coverFor(owned.map((u) => u.unitId))).map((w) => [w.unitId, w]));
    const claims = await this.repo.openClaimsByUnit(orgId, owned.map((u) => u.unitId));
    const today = this.clock.todayInIst();

    return {
      asOf: today,
      terms: TERMS,
      machines: owned.map((u) => {
        const w = cover.get(u.unitId) ?? null;
        const claim = claims.get(u.unitId) ?? null;
        const remaining = w === null ? 0 : daysBetween(today, w.endDate);
        return {
          serialNumber: u.serialNumber,
          orderNumber: u.orderNumber,
          orderedOn: u.orderedOn,
          title: u.title,
          specSummary: u.specSummary,
          passportPath: `/unit/${u.serialNumber}`,
          cover:
            w === null
              ? null
              : {
                  startDate: w.startDate,
                  endDate: w.endDate,
                  totalMonths: w.totalMonths,
                  // Never negative. "Expired 40 days ago" is said with
                  // `inWarranty: false` and the date, not with a minus sign a
                  // page might render as a countdown.
                  daysRemaining: Math.max(remaining, 0),
                  inWarranty: w.status === 'ACTIVE' && remaining >= 0,
                  expiringSoon: w.status === 'ACTIVE' && remaining >= 0 && remaining <= 30,
                },
          openClaim:
            claim === null
              ? null
              : {
                  claimNumber: claim.claimNumber,
                  status: claim.status,
                  raisedOn: claim.createdAt.toISOString().slice(0, 10),
                },
        };
      }),
    };
  }

  /* ------------------------------------------------------------------------
   * Claims
   * ---------------------------------------------------------------------- */

  async claims(): Promise<{ claims: readonly ClaimView[] }> {
    const orgId = this.buyerOrgId();
    const rows = await this.repo.claimsForOrg(orgId);
    const owned = await this.ordering.ownedUnits();
    const byUnit = new Map(owned.map((u) => [u.unitId, u]));
    return { claims: rows.map((r) => this.toClaimView(r, byUnit)) };
  }

  /**
   * One claim, by its number.
   *
   * A claim belonging to another organisation is `NotFoundError`, never
   * `ForbiddenError` — claim numbers carry a month and a counter, so "you may
   * not see TT-CLM-2608-0004" confirms it exists and turns the route into a
   * volume oracle for anyone with an account.
   */
  async claim(claimNumber: string): Promise<ClaimView> {
    const orgId = this.buyerOrgId();
    const row = await this.repo.claimForOrg(orgId, claimNumber);
    if (!row) throw new NotFoundError('claim', { reason: 'no_such_claim_for_this_org' });
    const owned = await this.ordering.ownedUnits();
    return this.toClaimView(row, new Map(owned.map((u) => [u.unitId, u])));
  }

  /**
   * Raise a claim against a serial.
   *
   * Three refusals, and each names what to do next rather than reporting that
   * something was invalid:
   *
   *   - the serial is not on this organisation's account at all;
   *   - the machine has no cover yet, because it has not been delivered;
   *   - the cover has expired — and the message carries the exact date, because
   *     §4.6 requires an expiry to be a fact with a paid-repair option beside it
   *     and not a dead end.
   */
  async raiseClaim(input: {
    serialNumber: string;
    faultArea: FaultArea;
    description: string;
    evidenceKeys: readonly string[];
  }): Promise<ClaimView> {
    const orgId = this.buyerOrgId();
    const owned = await this.ordering.ownedUnits();
    const machine = owned.find((u) => u.serialNumber === input.serialNumber);
    if (!machine) {
      throw new NotFoundError('machine', { reason: 'serial_not_on_this_account' });
    }

    const [cover] = await this.repo.coverFor([machine.unitId]);
    if (!cover) {
      throw new PreconditionFailedError(
        `We have not started the warranty on ${input.serialNumber} yet, because it has not been ` +
          `recorded as delivered. Cover runs from the day the machine reaches you. If it has ` +
          `arrived, tell us and we will correct the delivery record — this is our error, not yours.`,
        { reason: 'not_delivered', serialNumber: input.serialNumber },
      );
    }

    const remaining = daysBetween(this.clock.todayInIst(), cover.endDate);
    if (cover.status !== 'ACTIVE' || remaining < 0) {
      throw new PreconditionFailedError(
        `Cover on ${input.serialNumber} ended on ${cover.endDate}. We can still repair it as a ` +
          `paid job — raise a support ticket and we will quote before any work starts.`,
        { reason: 'out_of_warranty', serialNumber: input.serialNumber, endDate: cover.endDate },
      );
    }

    const existing = await this.repo.openClaimsByUnit(orgId, [machine.unitId]);
    const open = existing.get(machine.unitId);
    if (open) {
      throw new PreconditionFailedError(
        `${input.serialNumber} already has an open claim, ${open.claimNumber}. Add what you have ` +
          `found to that claim rather than starting a second one — two claims on one machine get ` +
          `two engineers and neither of them the whole story.`,
        { reason: 'claim_already_open', claimNumber: open.claimNumber },
      );
    }

    const description = input.description.trim();
    if (description.length < 20) {
      throw new ValidationError(
        'Tell us what the machine does, in a sentence or two. "Not working" sends an engineer ' +
          'who does not know what to bring.',
        { description: 'Describe the fault in at least 20 characters.' },
      );
    }

    const row = await this.repo.raiseClaim({
      claimNumber: this.nextClaimNumber(),
      warrantyId: cover.id,
      unitId: machine.unitId,
      orderLineUnitId: machine.orderLineUnitId,
      buyerOrgId: orgId,
      issueType: input.faultArea,
      description,
      evidenceKeys: input.evidenceKeys,
    });

    return this.toClaimView(row, new Map(owned.map((u) => [u.unitId, u])));
  }

  /* ------------------------------------------------------------------------
   * Internals
   * ---------------------------------------------------------------------- */

  /**
   * The allow-list. Built field by field from two known-safe sources — the claim
   * row, whose vendor-facing columns are simply not selected here, and the
   * owned-unit view, which `ordering` scoped to this organisation.
   *
   * The fault description is the buyer's own words and is returned verbatim.
   * Nothing we write into a claim's history may name a supply point: a buyer
   * who learns from their own claim thread who supplied the machine has learnt
   * it from us.
   */
  private toClaimView(
    row: ClaimRow,
    byUnit: Map<string, { serialNumber: string; orderNumber: string; title: string | null }>,
  ): ClaimView {
    const machine = byUnit.get(row.unitId);
    return {
      claimNumber: row.claimNumber,
      // A claim always has a serial; the fallback exists for the machine that
      // was returned to the supply point after the claim closed, and it is the
      // word rather than a blank.
      serialNumber: machine?.serialNumber ?? 'No longer on your account',
      orderNumber: machine?.orderNumber ?? '',
      title: machine?.title ?? null,
      status: row.status,
      faultArea: row.issueType,
      description: row.description,
      evidenceCount: row.evidenceKeys.length,
      raisedOn: row.createdAt.toISOString().slice(0, 10),
      updatedOn: row.updatedAt.toISOString().slice(0, 10),
      closedOn: row.closedAt?.toISOString().slice(0, 10) ?? null,
      resolution: row.resolution,
      passportPath: machine ? `/unit/${machine.serialNumber}` : '',
    };
  }

  /**
   * `TT-CLM-2608-4F2A91C3`.
   *
   * ponytail: the month plus eight hex characters, exactly like `platform.ticket`
   * and for the same reason — nothing reconciles claim numbers, so a gapless
   * counter would buy an advisory lock and a contention point for a property
   * nobody needs. `uq_warranty_claim_number` is the backstop and a collision is a
   * retry, not a corruption. Give it a sequence the day support wants "how many
   * claims this month" answered by subtraction.
   */
  private nextClaimNumber(): string {
    const month = this.clock.todayInIst().slice(2, 7).replace('-', '');
    const suffix = Math.floor(Math.random() * 0xffff_ffff)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0');
    return `TT-CLM-${month}-${suffix}`;
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Warranties belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }
}

/* ==========================================================================
 * Calendar arithmetic — all of it on the IST business calendar
 * ======================================================================== */

/**
 * The IST calendar date of an instant.
 *
 * VR-160: storage is UTC and every business window is reckoned in Asia/Kolkata.
 * A delivery at 23:00 UTC is the NEXT day in India, and a term that started the
 * day before the machine arrived is a term one day short.
 */
export function istDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(at);
}

/**
 * `2026-08-30` plus 6 months is `2027-02-28`, not `2027-03-02`.
 *
 * Naive month addition rolls the overflow into the next month, which quietly
 * gives a buyer two extra days of cover on some months and is the sort of thing
 * that is only ever noticed in a dispute. The day is clamped to the last day of
 * the target month instead.
 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A config value that must exist and must be a whole number of months.
 *
 * Missing keys throw rather than fall back to a number compiled into the build:
 * a silent default is how "ops changed the term and nothing happened" gets
 * diagnosed three weeks later as a caching bug.
 */
function wholeMonths(config: Map<string, unknown>, key: string): number {
  const raw = config.get(key);
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new PreconditionFailedError(
      `platform_config is missing ${key}, so we cannot say how long this machine is covered for. ` +
        'A warranty with a guessed term is worse than none.',
      { reason: 'config_missing', key },
    );
  }
  return value;
}
