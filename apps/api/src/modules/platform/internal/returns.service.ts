import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { OrderingLookup } from './ordering-lookup';
import { ReturnsRepository, type ReturnRow } from './returns.repository';

/**
 * Returns inside the 48-hour inspection window — T24, `03_UX_SPEC.md` §3A.4.
 *
 * ---------------------------------------------------------------------------
 * THE WINDOW IS ONE NUMBER, IN ONE PLACE, MEASURED AGAINST ONE CLOCK
 * ---------------------------------------------------------------------------
 * `ordering.inspection_window_hours` is the config key, and it is deliberately
 * the key `procurement`'s payable screen already reads: the same window that
 * lets a buyer send a machine back is the one that makes the vendor's money
 * eligible, and two constants for that would eventually pay a supply point for a
 * machine still inside its buyer's return period.
 *
 * Both ends come from `ClockPort`. T25 found an approval SLA measured against
 * two clocks — `requested_at` from the database's `DEFAULT now()` and
 * `expires_at` from `ClockPort` — which returned 22 hours where it owed 24. The
 * delivery instant here comes from `sub_order.delivered_at`, which
 * `DeliveryService` stamped from `ClockPort` with no parameter to override it,
 * and "has it closed" is decided against `ClockPort` too. **The page never
 * decides.** `windowOpen` and `hoursRemaining` are fields on the payload, so a
 * laptop clock two days fast cannot refuse a buyer a remedy they are owed, and
 * one two days slow cannot promise one they are not.
 *
 * **The key missing is not 48.** It is `null`, and then no window is claimed at
 * all — the same treatment `PayableService` gives it. A deadline compiled into
 * the build is how "ops changed the window and nothing happened" gets diagnosed
 * three weeks later as a caching bug.
 *
 * ---------------------------------------------------------------------------
 * WHERE A RETURN GOES
 * ---------------------------------------------------------------------------
 * To us. Under the merchant-of-record model there is one seller, Rule 7(4)
 * take-back is ours and non-delegable, and there is nobody else for the buyer to
 * chase. Nothing on any shape below names a supply point at any depth — not in
 * the reason, not in the history, not in a refusal. Every view is an allow-list
 * built field by field from two known-safe sources: the return row, whose
 * `approved_by` is simply not selected, and `ordering`'s owned-unit view, which
 * is scoped to this organisation by the module that owns ownership.
 *
 * A return on another organisation's order is `NotFoundError`. Return numbers
 * carry a month and eight hex characters, and order numbers are sequential, so
 * "you may not raise a return on TT-26-00004" confirms it exists.
 */

/* ==========================================================================
 * The six reasons the buyer is offered
 * ======================================================================== */

/**
 * §3A.4's six reasons, mapped one to one onto `reason_code`.
 *
 * `SEAL_BROKEN` did not exist on the CHECK before this task and had to be added:
 * the nearest fit was `TRANSIT_DAMAGE`, which already means physical damage, and
 * folding the two together would lose the distinction that decides who pays. The
 * seventh code the constraint holds, `WRONG_ITEM`, is not offered here — §3A.4
 * gives the buyer one reason for "wrong model or spec" and a second control
 * asking them to split that hair is a form that takes longer to fill in.
 */
export const RETURN_REASONS = [
  'GRADE_MISMATCH',
  'TRANSIT_DAMAGE',
  'DOA',
  'SPEC_MISMATCH',
  'SEAL_BROKEN',
  'SHORT_SHIPMENT',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

export const REASON_LABEL: Readonly<Record<ReturnReason, string>> = {
  GRADE_MISMATCH: 'Not as described',
  TRANSIT_DAMAGE: 'Physical damage',
  DOA: 'Functional failure',
  SPEC_MISMATCH: 'Wrong model or specification',
  SEAL_BROKEN: 'Seal broken on arrival',
  SHORT_SHIPMENT: 'Short shipment',
};

/**
 * How many photographs each reason needs — §3A.4: at least two for physical
 * damage, one of the seal for a broken-seal claim.
 *
 * **Stated and counted, deliberately NOT refused.** There is no endpoint on this
 * platform through which a buyer can upload evidence: the only upload route is
 * `/onboarding/documents`, which writes `kyc.document` rows into the onboarding
 * review queue and is the wrong home for a photograph of a scratched lid. A rule
 * enforced against a control that does not exist would make two of the six
 * reasons — including the one the buyer's own seal check raises — unreachable
 * with a 422 the buyer has no way to satisfy. That is worse than no rule: a
 * damage claim recorded with no picture can still be chased by email, and one
 * that was refused at the door never existed at all.
 *
 * So the shortfall travels on the payload instead, as `evidenceStillNeeded`, and
 * both screens say what we will ask for. When an evidence-upload route exists
 * this becomes the refusal §3A.4 describes, and the number does not move.
 */
const EVIDENCE_REQUIRED: Readonly<Partial<Record<ReturnReason, number>>> = {
  TRANSIT_DAMAGE: 2,
  SEAL_BROKEN: 1,
};

/* ==========================================================================
 * The customer-facing shapes — allow-lists, built field by field
 * ======================================================================== */

/** The live window on one machine, decided here and never in the browser. */
export interface ReturnWindow {
  /** ISO 8601. The exact instant, because §3A.4 says the refusal states it. */
  closesAt: string;
  /** The server's verdict. Not `closesAt` minus a browser's idea of now. */
  open: boolean;
  /**
   * Whole hours left, floored, never negative. Information, not pressure —
   * §3A.4 is explicit that this is not a countdown to hurry anybody.
   */
  hoursRemaining: number;
}

export interface ReturnableMachine {
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  specSummary: string | null;
  passportPath: string;
  /** ISO 8601, or null when the machine has not arrived. Null is not "today". */
  deliveredAt: string | null;
  /** Null when nothing has started running, or when no window is configured. */
  window: ReturnWindow | null;
  openReturn: { returnNumber: string; status: string } | null;
  /**
   * Why this machine cannot be returned, in a sentence. Null means it can be.
   * A machine is never silently absent from the list: "it is not here" and "it
   * cannot be returned because the window closed on Tuesday" are different
   * things and only one of them tells the buyer what to do next.
   */
  blockedReason: string | null;
}

export interface ReturnEligibility {
  /** The server's own instant, so the page can say what it was reckoned against. */
  asOf: string;
  /** `ordering.inspection_window_hours`. Null when unset — then no window is claimed. */
  windowHours: number | null;
  machines: readonly ReturnableMachine[];
}

export interface ReturnView {
  returnNumber: string;
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  reasonCode: string;
  reasonLabel: string;
  /** The buyer's own words, verbatim. We do not edit what they wrote. */
  description: string;
  evidenceCount: number;
  /** How many photographs this reason calls for. Zero for the four that need none. */
  evidenceRequired: number;
  /**
   * The shortfall, and it is on the payload rather than refused at the door
   * because there is no route through which a buyer can upload one yet. Never
   * negative, and never rendered as a tick — a return that still owes evidence
   * says so.
   */
  evidenceStillNeeded: number;
  status: string;
  raisedAt: string;
  raisedOn: string;
  resolution: string | null;
  passportPath: string;
  /** True while we still have to do something. Decided here. */
  open: boolean;
}

interface RaiseReturnRequest {
  orderNumber: string;
  serialNumbers: readonly string[];
  reasonCode: ReturnReason;
  description: string;
  evidenceKeys: readonly string[];
}

const HOUR_MS = 3_600_000;
const WINDOW_KEY = 'ordering.inspection_window_hours';

/** `uq_return_open_per_unit`'s predicate, restated for the view's `open` flag. */
const CLOSED = new Set(['REJECTED', 'CANCELLED', 'REFUNDED', 'REPLACED', 'RETURNED_TO_BUYER']);

@Injectable()
export class ReturnsService {
  constructor(
    private readonly repo: ReturnsRepository,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly ordering: OrderingLookup,
  ) {}

  /* ------------------------------------------------------------------------
   * What can be returned, and what cannot, and why
   * ---------------------------------------------------------------------- */

  /**
   * Every machine on an order — or on the whole account — with its window.
   *
   * A foreign order comes back with **no machines**, not a refusal:
   * `ownedUnitsForOrder` is scoped by `ordering` and returns empty for an order
   * that is not this organisation's, which is indistinguishable from an order
   * number that was typed wrong. The route turns that into 404 rather than 403.
   */
  async eligibility(orderNumber?: string): Promise<ReturnEligibility> {
    const orgId = this.buyerOrgId();
    const owned = orderNumber
      ? await this.ordering.ownedUnitsForOrder(orderNumber)
      : await this.ordering.ownedUnits();

    const now = this.clock.now();
    const windowHours = await this.windowHours();
    const open = await this.repo.openByOrderLineUnit(
      orgId,
      owned.map((u) => u.orderLineUnitId),
    );

    return {
      asOf: now.toISOString(),
      windowHours,
      machines: owned.map((u) => {
        const window = this.windowFor(u.deliveredAt, windowHours, now);
        const existing = open.get(u.orderLineUnitId) ?? null;
        return {
          serialNumber: u.serialNumber,
          orderNumber: u.orderNumber,
          title: u.title,
          specSummary: u.specSummary,
          passportPath: `/unit/${u.serialNumber}`,
          deliveredAt: u.deliveredAt?.toISOString() ?? null,
          window,
          openReturn: existing && { returnNumber: existing.returnNumber, status: existing.status },
          blockedReason: this.blockedReason(u.deliveredAt, window, windowHours, existing),
        };
      }),
    };
  }

  /* ------------------------------------------------------------------------
   * Reading returns
   * ---------------------------------------------------------------------- */

  async list(): Promise<{ returns: readonly ReturnView[] }> {
    const orgId = this.buyerOrgId();
    const rows = await this.repo.forOrg(orgId);
    return { returns: await this.decorate(rows) };
  }

  /**
   * One return, by its number.
   *
   * Another organisation's return is `NotFoundError`, never `ForbiddenError` —
   * the same reasoning T23 gives for claim numbers. The org id is in the
   * repository's WHERE clause and a miss is indistinguishable from a typo.
   */
  async view(returnNumber: string): Promise<ReturnView> {
    const orgId = this.buyerOrgId();
    const row = await this.repo.forOrgByNumber(orgId, returnNumber);
    if (!row) throw new NotFoundError('return', { reason: 'no_such_return_for_this_org' });
    const [view] = await this.decorate([row]);
    return view!;
  }

  /* ------------------------------------------------------------------------
   * Raising one
   * ---------------------------------------------------------------------- */

  /**
   * Raise a return over one or more machines on one order.
   *
   * One `platform.return_request` row per machine, because that is what the
   * table is: the return of a serial, inspected on its own and settled on its
   * own. Three machines returned together get three numbers and three
   * inspections, which is the honest shape — one of them may come back
   * CLAIM_VALID and another CLAIM_INVALID.
   *
   * **Every refusal names the machine and what to do instead.** Not on this
   * account, not delivered, window closed with the exact instant and the
   * warranty route, already has a return open with its number. None of them is a
   * red border with no message.
   */
  async raise(input: RaiseReturnRequest): Promise<{ returns: readonly ReturnView[] }> {
    const orgId = this.buyerOrgId();
    const owned = await this.ordering.ownedUnitsForOrder(input.orderNumber);
    if (owned.length === 0) {
      throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });
    }

    const serials = [...new Set(input.serialNumbers.map((s) => s.trim().toUpperCase()))];
    if (serials.length === 0) {
      throw new ValidationError('Choose at least one machine to send back.', {
        serialNumbers: 'Pick the machines you are returning.',
      });
    }

    const bySerial = new Map(owned.map((u) => [u.serialNumber, u]));
    const strangers = serials.filter((s) => !bySerial.has(s));
    if (strangers.length > 0) {
      throw new ValidationError(
        `${strangers.join(', ')} ${strangers.length === 1 ? 'is not a machine' : 'are not machines'} ` +
          `on order ${input.orderNumber}. Check the serial against the case label — ` +
          'the machines on this order are listed on its Machines tab.',
        { serialNumbers: 'One of these serials is not on this order.' },
      );
    }

    const description = input.description.trim();
    if (description.length < 20) {
      throw new ValidationError(
        'Tell us what is wrong, in a sentence or two. "Faulty" does not tell the engineer who ' +
          'inspects it on return what to look for, and a return we cannot judge is one that takes ' +
          'a week longer than it should.',
        { description: 'Describe the problem in at least 20 characters.' },
      );
    }

    const now = this.clock.now();
    const windowHours = await this.windowHours();
    const openAlready = await this.repo.openByOrderLineUnit(
      orgId,
      serials.map((s) => bySerial.get(s)!.orderLineUnitId),
    );

    // Every machine is checked BEFORE anything is written, so a mixed selection
    // refuses whole rather than raising two returns and failing on the third —
    // which would leave the buyer looking at an error over a return that partly
    // happened.
    for (const serial of serials) {
      const machine = bySerial.get(serial)!;
      const window = this.windowFor(machine.deliveredAt, windowHours, now);
      const existing = openAlready.get(machine.orderLineUnitId) ?? null;
      const blocked = this.blockedReason(machine.deliveredAt, window, windowHours, existing);
      if (blocked !== null) {
        throw new PreconditionFailedError(`${serial}: ${blocked}`, {
          reason: 'not_returnable',
          serialNumber: serial,
          windowClosesAt: window?.closesAt ?? null,
        });
      }
    }

    const created: ReturnRow[] = [];
    for (const serial of serials) {
      created.push(
        await this.repo.raise({
          returnNumber: this.nextReturnNumber(),
          orderLineUnitId: bySerial.get(serial)!.orderLineUnitId,
          buyerOrgId: orgId,
          reasonCode: input.reasonCode,
          description,
          evidenceKeys: input.evidenceKeys,
        }),
      );
    }

    return { returns: await this.decorate(created) };
  }

  /**
   * The discrepancy a broken seal opens by itself — the buyer's check at
   * handover, called from `ordering` through the barrel.
   *
   * §3A.3 is explicit that this must be **one tap, not a support call**: Rule
   * 7(4) take-back is ours and non-delegable, so a buyer who finds a broken seal
   * at their door must not then have to persuade somebody that they did. The
   * seal check is the tap; this is what it opens.
   *
   * **Idempotent by the index, not by care.** `uq_return_open_per_unit` is a
   * partial unique index and this is a button a person can press twice, so the
   * live return on that machine is returned unchanged rather than a second one
   * being raised. `ordering` supplies the facts it owns and no org id at all —
   * the buyer's organisation is read from the request context here, so there is
   * no argument for a caller to get wrong.
   */
  async openSealDiscrepancy(input: {
    orderLineUnitId: string;
    serialNumber: string;
    sealCode: string;
    /** BROKEN or MISSING. Both are the same claim about custody. */
    finding: 'BROKEN' | 'MISSING';
  }): Promise<{ returnNumber: string; alreadyOpen: boolean }> {
    const orgId = this.buyerOrgId();
    const existing = (await this.repo.openByOrderLineUnit(orgId, [input.orderLineUnitId])).get(
      input.orderLineUnitId,
    );
    if (existing) return { returnNumber: existing.returnNumber, alreadyOpen: true };

    const found =
      input.finding === 'BROKEN'
        ? `Seal ${input.sealCode} was found broken on ${input.serialNumber} when the buyer took ` +
          'delivery, so the machine was not accepted.'
        : `Seal ${input.sealCode} was not on ${input.serialNumber} when the buyer took delivery, ` +
          'so the machine was not accepted.';

    const row = await this.repo.raise({
      returnNumber: this.nextReturnNumber(),
      orderLineUnitId: input.orderLineUnitId,
      buyerOrgId: orgId,
      reasonCode: 'SEAL_BROKEN',
      // Opened by us, on the buyer's behalf, and it says so. The buyer adds
      // their own account on the return record; nothing here is put in their
      // mouth, and nothing here names who supplied the machine.
      description: `${found} Raised automatically by the buyer's own seal check at handover — ` +
        'nobody had to ask for it. We collect the machine and settle this ourselves.',
      evidenceKeys: [],
    });
    return { returnNumber: row.returnNumber, alreadyOpen: false };
  }

  /* ------------------------------------------------------------------------
   * The window, in one place
   * ---------------------------------------------------------------------- */

  /**
   * `deliveredAt + ordering.inspection_window_hours`, both ends from `ClockPort`.
   *
   * Null when the machine has not arrived — nothing has started running, which
   * is not the same as a window that has closed — and null when the key is
   * absent, because a window we cannot state is one we must not draw.
   */
  windowFor(deliveredAt: Date | null, windowHours: number | null, now: Date): ReturnWindow | null {
    if (deliveredAt === null || windowHours === null) return null;
    const closesAt = new Date(deliveredAt.getTime() + windowHours * HOUR_MS);
    const remainingMs = closesAt.getTime() - now.getTime();
    return {
      closesAt: closesAt.toISOString(),
      open: remainingMs > 0,
      hoursRemaining: Math.max(Math.floor(remainingMs / HOUR_MS), 0),
    };
  }

  async windowHours(): Promise<number | null> {
    const raw = (await this.repo.config([WINDOW_KEY])).get(WINDOW_KEY);
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  /**
   * Why not, in one sentence, ordered most terminal first.
   *
   * Every arm names the next step. §3A.4 requires the closed-window case to
   * state the exact closing timestamp and route to warranty rather than ending
   * the conversation — a machine out of its return window is still under cover,
   * and telling somebody only that they are too late is how a remedy they still
   * have goes unused.
   */
  private blockedReason(
    deliveredAt: Date | null,
    window: ReturnWindow | null,
    windowHours: number | null,
    existing: ReturnRow | null,
  ): string | null {
    if (existing) {
      return `a return is already open on this machine, ${existing.returnNumber}. Add anything ` +
        'else you have found to that one rather than starting a second.';
    }
    if (deliveredAt === null) {
      return 'it has not reached you yet, so the inspection window has not started. There is ' +
        'nothing to send back until it arrives.';
    }
    if (windowHours === null || window === null) {
      return 'we cannot state the length of the inspection window right now, and we will not ' +
        'refuse a return against a deadline we cannot name. Tell us and we will handle it by hand ' +
        '— this is our problem, not yours.';
    }
    if (!window.open) {
      return `the ${windowHours}-hour inspection window closed at ${window.closesAt}. The machine ` +
        'is still under warranty, so a fault now is a warranty claim rather than a return, and ' +
        'that costs you nothing either.';
    }
    return null;
  }

  /* ------------------------------------------------------------------------
   * Internals
   * ---------------------------------------------------------------------- */

  /**
   * The allow-list, built field by field from the return row and `ordering`'s
   * owned-unit view. `approved_by` is not selected by the repository at all, so
   * there is no member of our staff on this shape and no vendor identifier it
   * could travel in.
   */
  private async decorate(rows: readonly ReturnRow[]): Promise<ReturnView[]> {
    if (rows.length === 0) return [];
    const owned = await this.ordering.ownedUnits();
    const byLineUnit = new Map(owned.map((u) => [u.orderLineUnitId, u]));

    return rows.map((r) => {
      const machine = byLineUnit.get(r.orderLineUnitId);
      const known = RETURN_REASONS.includes(r.reasonCode as ReturnReason)
        ? (r.reasonCode as ReturnReason)
        : null;
      const reason = known ? REASON_LABEL[known] : r.reasonCode;
      const required = known ? (EVIDENCE_REQUIRED[known] ?? 0) : 0;
      return {
        returnNumber: r.returnNumber,
        // A return always has a serial; the fallback is for the machine that has
        // gone back to us since, and it is the words rather than a blank.
        serialNumber: machine?.serialNumber ?? 'No longer on your account',
        orderNumber: machine?.orderNumber ?? '',
        title: machine?.title ?? null,
        reasonCode: r.reasonCode,
        reasonLabel: reason,
        description: r.description ?? '',
        evidenceCount: r.evidenceKeys.length,
        evidenceRequired: required,
        evidenceStillNeeded: Math.max(required - r.evidenceKeys.length, 0),
        status: r.status,
        raisedAt: r.raisedAt.toISOString(),
        raisedOn: r.raisedAt.toISOString().slice(0, 10),
        resolution: r.resolution,
        passportPath: machine ? `/unit/${machine.serialNumber}` : '',
        open: !CLOSED.has(r.status),
      };
    });
  }

  /**
   * `TT-RET-2608-4F2A91C3`.
   *
   * ponytail: the month plus eight hex characters, exactly like `platform.ticket`
   * and `warranty_claim` and for the same reason — nothing reconciles return
   * numbers, so a gapless counter would buy an advisory lock and a contention
   * point for a property nobody needs. The UNIQUE on the column is the backstop
   * and a collision is a retry, not a corruption. Give it a sequence the day
   * somebody wants "how many returns this month" answered by subtraction.
   */
  private nextReturnNumber(): string {
    const month = this.clock.todayInIst().slice(2, 7).replace('-', '');
    const suffix = Math.floor(Math.random() * 0xffff_ffff)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0');
    return `TT-RET-${month}-${suffix}`;
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Returns belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }
}
