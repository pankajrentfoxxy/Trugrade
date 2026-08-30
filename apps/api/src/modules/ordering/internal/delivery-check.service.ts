import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { PlatformService } from '../../platform';
import { QcService, type QcVerdict } from '../../qc';
import { CatalogLookup } from './catalog-lookup';
import { dispatchLabels, UNKNOWN_DISPATCH_LABEL } from './dispatch-label';

/**
 * The buyer's own seal check at handover — T24,
 * `03_UX_SPEC.md` §3A.3 `/account/orders/[id]/delivery`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * A seal is what turns "inspected on 12 August" from a claim about *a* laptop
 * into a claim about *this* laptop: the machine sits at a supply point for weeks
 * between the inspection and the sale, and the sticker is the only thing
 * spanning that gap. It is checkable by somebody with no account and no
 * training — the code on the sticker matches the code on the manifest, and the
 * sticker is not broken — and until now nobody had ever been given the means to
 * check it.
 *
 * **APPLIED is not INTACT, and this is the screen that turns one into the
 * other.** APPLIED means we sealed the machine and nobody has looked since;
 * INTACT means somebody looked and found it unbroken. `SealChip` renders the
 * first neutral and the second green for exactly this reason, and most sellable
 * stock is APPLIED — so a green chip on every sealed machine was telling the
 * person doing the checking that the check was already done.
 *
 * ---------------------------------------------------------------------------
 * THE TWO REFUSALS THAT CARRY LEGAL WEIGHT
 * ---------------------------------------------------------------------------
 * **A code that is not on this delivery is a safety message, not a validation
 * error.** §3A.3 writes the sentence out: *"Seal 88-041992 is not on this
 * delivery. Do not accept this machine."* A machine carrying a seal from another
 * consignment is either the wrong machine or a machine that has been opened and
 * re-sealed, and both are reasons to keep the lorry doors shut. The manifest is
 * the order's own machines and nothing wider — a lookup across every seal on the
 * platform would answer "yes, that is a real seal" about a laptop that was never
 * sold to this buyer.
 *
 * **Any broken or missing seal blocks receipt and opens a discrepancy by
 * itself.** Rule 7(4) take-back is ours and non-delegable, so §3A.3 requires
 * this to be one tap and not a support call. `platform` raises the return
 * through the barrel; this module does not write into `platform.*`.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK
 * ---------------------------------------------------------------------------
 * `sub_order.delivered_at` is the instant, stamped by `DeliveryService` from
 * `ClockPort` with no parameter to override it, and the window's length is
 * `ordering.inspection_window_hours` — the one key `procurement`'s payables
 * screen already measures against, because the window that lets a buyer send a
 * machine back is the same window that makes the vendor's money eligible. Both
 * ends are decided here and handed to the page as verdicts. **The page never
 * decides**; a laptop clock two days fast must not be able to refuse a buyer a
 * remedy they are owed.
 */

/* ==========================================================================
 * The customer-facing shapes — allow-lists, built field by field
 * ======================================================================== */

/** The seal state as `qc` reports it, plus the absence of one, which is a state. */
export interface DeliverySeal {
  code: string;
  /** `APPLIED` | `INTACT` | `BROKEN` | `MISSING` | `REPLACED`. */
  status: string;
}

export interface DeliveryMachine {
  serialNumber: string;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  /**
   * Null means **no seal is recorded on this machine at all** — which is not a
   * seal that passed and not one that failed. It blocks the handover on its own,
   * because a machine with nothing to check is a machine nobody can vouch for.
   */
  seal: DeliverySeal | null;
  /**
   * What our own inspection concluded. MISMATCH is on this shape because §3A.3
   * expects the buyer to be able to act on one at the door, and a verdict they
   * cannot see is one they cannot act on.
   *
   * **Whether a return is already open on this machine is deliberately not
   * here.** `platform` owns returns and already answers that question per serial
   * on `GET /buyer/returns/eligibility?order=`; a second copy of it, resolved
   * through a second seam, is a second thing to be wrong about whether a buyer
   * has a remedy open.
   */
  verdict: QcVerdict | null;
  passportPath: string;
  /** Null when this machine is ready to be accepted; otherwise why not. */
  blockedReason: string | null;
}

export interface DeliveryConsignment {
  /**
   * 1-based, and the ONLY handle a buyer gets on a consignment.
   * `sub_order_number` is an internal grouping and the word "sub-order" never
   * reaches a buyer — to them this is one order from one seller, arriving in a
   * number of deliveries.
   */
  index: number;
  /** `Delivery 1 of 3 · Supply Point A · Gurugram`. A dispatch point, never a seller. */
  label: string;
  status: string;
  /** ISO 8601, or null when it has not arrived. Null is not "today" and not zero. */
  deliveredAt: string | null;
  /** Null when nothing has started running, or when the window length is unset. */
  window: { closesAt: string; open: boolean; hoursRemaining: number } | null;
  machines: readonly DeliveryMachine[];
  /** ISO 8601 of the buyer's own confirmation, from `ordering.order_event`. */
  receiptConfirmedAt: string | null;
  /**
   * Why receipt cannot be confirmed yet, in a sentence, or null when it can.
   * Decided here: "every seal on this consignment has been looked at and none of
   * them is broken" is a statement about rows, not about a form's state.
   */
  blockedReason: string | null;
}

export interface DeliveryView {
  orderNumber: string;
  status: string;
  /** The server's own instant, so the page can say what it was reckoned against. */
  asOf: string;
  /** `ordering.inspection_window_hours`. Null when unset — then no window is claimed. */
  windowHours: number | null;
  consignments: readonly DeliveryConsignment[];
}

/** What the person at the door found. */
export interface SealCheckRequest {
  sealCode: string;
  outcome: 'INTACT' | 'BROKEN' | 'MISSING';
  note?: string;
}

export interface SealCheckResult {
  sealCode: string;
  serialNumber: string;
  status: string;
  /** The discrepancy this check opened, when it opened one. */
  returnNumber: string | null;
  delivery: DeliveryView;
}

/* ==========================================================================
 * Rows
 * ======================================================================== */

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
}

interface ConsignmentRow {
  id: string;
  sub_order_number: string;
  status: string;
  delivered_at: Date | null;
}

interface MachineRow {
  order_line_unit_id: string;
  sub_order_id: string;
  unit_id: string;
  serial_number: string;
  qc_report_id: string | null;
  sku_id: string;
}

interface ReceiptRow {
  sub_order_id: string;
  occurred_at: Date;
}

const HOUR_MS = 3_600_000;
const WINDOW_KEY = 'ordering.inspection_window_hours';

/** `ordering.order_event.event_type` for the buyer's own acceptance at the door. */
const RECEIPT_EVENT = 'BUYER_RECEIPT_CONFIRMED';

/** The seal states that stop a handover. Both mean the same thing about custody. */
const COMPROMISED = new Set(['BROKEN', 'MISSING']);

@Injectable()
export class DeliveryCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
    private readonly clock: ClockPort,
    private readonly qc: QcService,
    private readonly catalog: CatalogLookup,
    private readonly platform: PlatformService,
  ) {}

  /* ------------------------------------------------------------------------
   * The manifest
   * ---------------------------------------------------------------------- */

  /**
   * What arrived, by consignment, with each machine's seal and each window.
   *
   * **Per consignment and not per order.** Three consignments arriving on three
   * days open three windows, and a screen that averaged them into one deadline
   * would tell a buyer their remedy on Tuesday's delivery expired with Monday's.
   *
   * An order belonging to another organisation is `NotFoundError`, not
   * `ForbiddenError` — order numbers are sequential, so "you may not see
   * TT-26-00004" confirms it exists and turns the route into an order-volume
   * oracle for anyone with an account.
   */
  async manifest(orderNumber: string): Promise<DeliveryView> {
    const orgId = this.buyerOrgId();

    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    return this.build(order);
  }

  /* ------------------------------------------------------------------------
   * The check
   * ---------------------------------------------------------------------- */

  /**
   * Scan a code, say what you found.
   *
   * The order of the refusals is the order they matter in at a lorry door:
   *
   *   1. the code is not on this delivery — do not accept the machine;
   *   2. the consignment has not arrived, so there is nothing to check;
   *   3. the inspection window has closed, and the remedy is now a warranty
   *      claim rather than a return.
   *
   * A BROKEN or MISSING finding then does two things in the same call, and doing
   * only one of them would be worse than doing neither: the seal is recorded
   * compromised (which `qc` makes terminal and which takes the unit off the
   * storefront on the spot) and a return is opened, so the buyer's remedy exists
   * before they have finished putting their phone away.
   */
  async check(orderNumber: string, input: SealCheckRequest): Promise<SealCheckResult> {
    const orgId = this.buyerOrgId();
    const code = input.sealCode.trim().toUpperCase();

    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    const machines = await this.machines(order.id);
    const seals = await this.sealsByReport(machines);

    // The manifest is THIS order's machines and nothing wider. A lookup across
    // every seal on the platform would answer "yes, that is a real seal" about a
    // laptop that was never sold to this buyer, which is the opposite of what
    // the person at the door is asking.
    const match = machines.find((m) => {
      const seal = m.qc_report_id ? seals.get(m.qc_report_id) : null;
      return seal?.code === code;
    });
    if (!match) {
      throw new ValidationError(
        `Seal ${code} is not on this delivery. Do not accept this machine.`,
        {
          sealCode:
            'This code is not on any machine we sent you. Keep the machine on the vehicle and ' +
            'call us — we will not ask you to sign for it.',
        },
      );
    }

    const consignments = await this.consignments(order.id);
    const consignment = consignments.find((c) => c.id === match.sub_order_id);
    if (!consignment || consignment.delivered_at === null) {
      throw new PreconditionFailedError(
        `The consignment carrying ${match.serial_number} is not recorded as delivered yet, so ` +
          'there is nothing to check. If the machine is in front of you, tell us — the delivery ' +
          'record is ours to correct, not yours.',
        { reason: 'not_delivered', serialNumber: match.serial_number },
      );
    }

    const now = this.clock.now();
    const windowHours = await this.windowHours();
    const window = this.windowFor(consignment.delivered_at, windowHours, now);
    if (window !== null && !window.open) {
      throw new PreconditionFailedError(
        `The ${windowHours}-hour inspection window on this consignment closed at ` +
          `${window.closesAt}, so a seal check now is not the handover check. The machine is ` +
          'still under warranty — a fault found today is a warranty claim, and that costs you ' +
          'nothing either.',
        { reason: 'window_closed', closesAt: window.closesAt },
      );
    }

    const seal = await this.qc.recordSealCheck({
      unitId: match.unit_id,
      sealCode: code,
      outcome: input.outcome,
      verifiedBy: this.ctx.requirePrincipal().userId,
      note: input.note,
    });

    // The discrepancy is `platform`'s to raise, and it is raised from the buyer's
    // own request context — so there is no org id crossing the seam that could be
    // the wrong one.
    const discrepancy = COMPROMISED.has(seal.status)
      ? await this.platform.openSealDiscrepancy({
          orderLineUnitId: match.order_line_unit_id,
          serialNumber: match.serial_number,
          sealCode: code,
          finding: seal.status === 'MISSING' ? 'MISSING' : 'BROKEN',
        })
      : null;

    return {
      sealCode: code,
      serialNumber: match.serial_number,
      status: seal.status,
      returnNumber: discrepancy?.returnNumber ?? null,
      delivery: await this.build(order),
    };
  }

  /* ------------------------------------------------------------------------
   * Confirming receipt
   * ---------------------------------------------------------------------- */

  /**
   * The buyer signs for one consignment.
   *
   * **Recorded as an `ordering.order_event` and not as a proof-of-delivery
   * document, because there is no proof-of-delivery document.**
   * `logistics.delivery_task` is empty and has no writer; a POD row invented
   * here would be a rider's signature and photograph that nobody took. The
   * timeline table is the honest place for "the buyer confirmed receipt", and it
   * is append-only, which is the right shape for an acceptance.
   *
   * It refuses while anything on the consignment is unchecked or compromised,
   * and the refusal names the machines rather than reporting that the form is
   * incomplete — §3A.3's rule that any broken or mismatched seal blocks POD
   * completion is a rule about machines, so the message is about machines.
   *
   * Idempotent: a second press returns the manifest unchanged rather than
   * writing a second acceptance, because it is a button and buttons get pressed
   * twice.
   */
  async confirmReceipt(orderNumber: string, deliveryIndex: number): Promise<DeliveryView> {
    const orgId = this.buyerOrgId();

    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    // The position the buyer sees — "Delivery 2 of 3" — resolved against the
    // same ordering the manifest was built in. `sub_order_number` never travels.
    const consignments = await this.consignments(order.id);
    const index = deliveryIndex - 1;
    if (index < 0 || index >= consignments.length) {
      throw new NotFoundError('consignment', { reason: 'no_such_delivery_on_order' });
    }

    const view = await this.build(order);
    const built = view.consignments[index]!;

    // A second press is the manifest, unchanged. An acceptance is not a thing to
    // record twice, and a button gets pressed twice.
    if (built.receiptConfirmedAt !== null) return view;
    if (built.blockedReason !== null) {
      throw new PreconditionFailedError(built.blockedReason, {
        reason: 'not_ready_to_sign',
        deliveryIndex,
      });
    }

    await this.prisma.$executeRaw`
      INSERT INTO ordering.order_event
             (order_id, sub_order_id, event_type, note, occurred_at, actor_id)
      VALUES (${order.id}::uuid, ${consignments[index]!.id}::uuid, ${RECEIPT_EVENT},
              'Receipt confirmed by the buyer. Every seal on this consignment was checked at handover.',
              ${this.clock.now()}, ${this.ctx.requirePrincipal().userId}::uuid)`;

    return this.build(order);
  }

  /* ------------------------------------------------------------------------
   * Building the view
   * ---------------------------------------------------------------------- */

  private async build(order: OrderRow): Promise<DeliveryView> {
    const now = this.clock.now();
    const windowHours = await this.windowHours();
    const consignments = await this.consignments(order.id);
    const machines = await this.machines(order.id);

    const [seals, descriptions, labels, receipts] = await Promise.all([
      this.sealsByReport(machines),
      this.describe(machines),
      dispatchLabels(
        this.prisma,
        machines.map((m) => m.unit_id),
      ),
      this.receipts(order.id),
    ]);

    return {
      orderNumber: order.order_number,
      status: order.status,
      asOf: now.toISOString(),
      windowHours,
      consignments: consignments.map((c, index) => {
        // Computed once and used three times. The window decides the manifest
        // rows, the consignment sentence and the payload field, and three
        // separate calls would be three chances for them to disagree.
        const win = this.windowFor(c.delivered_at, windowHours, now);
        const own = machines.filter((m) => m.sub_order_id === c.id);
        const built = own.map((m) => {
          const inspection = m.qc_report_id ? (seals.get(m.qc_report_id) ?? null) : null;
          const description = descriptions.get(m.sku_id) ?? null;
          const seal =
            inspection && inspection.code !== null
              ? { code: inspection.code, status: inspection.status }
              : null;
          return {
            serialNumber: m.serial_number,
            title: description?.title ?? null,
            specSummary: description?.specSummary ?? null,
            seal,
            verdict: inspection?.verdict ?? null,
            passportPath: `/unit/${m.serial_number}`,
            blockedReason: machineBlockedReason(seal, win?.open ?? null),
          };
        });

        return {
          index: index + 1,
          // `Delivery 1 of 3 · Supply Point A · Gurugram` — §3A.3's own wording.
          // The supply point comes from `dispatchLabels`, this module's one
          // definition of the anonymised label, and never from a vendor name.
          label: `Delivery ${index + 1} of ${consignments.length} · ${
            (own[0] && labels.get(own[0].unit_id)) ?? UNKNOWN_DISPATCH_LABEL
          }`,
          status: c.status,
          deliveredAt: c.delivered_at?.toISOString() ?? null,
          window: win,
          machines: built,
          receiptConfirmedAt: receipts.get(c.id)?.toISOString() ?? null,
          blockedReason: consignmentBlockedReason(c.delivered_at, win?.open ?? null, built),
        };
      }),
    };
  }

  private async consignments(orderId: string): Promise<ConsignmentRow[]> {
    return this.prisma.$queryRaw<ConsignmentRow[]>`
      SELECT id, sub_order_number, status::text AS status, delivered_at
        FROM ordering.sub_order
       WHERE order_id = ${orderId}::uuid
         AND status <> 'CANCELLED'::public.order_status
       ORDER BY sub_order_number`;
  }

  private async machines(orderId: string): Promise<MachineRow[]> {
    return this.prisma.$queryRaw<MachineRow[]>`
      SELECT olu.id AS order_line_unit_id, ol.sub_order_id, olu.unit_id, olu.serial_number,
             olu.qc_report_id, ol.sku_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order  so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
         AND so.status <> 'CANCELLED'::public.order_status
       ORDER BY olu.serial_number`;
  }

  /** The buyer's own acceptance per consignment, newest kept. */
  private async receipts(orderId: string): Promise<Map<string, Date>> {
    const rows = await this.prisma.$queryRaw<ReceiptRow[]>`
      SELECT sub_order_id, MAX(occurred_at) AS occurred_at
        FROM ordering.order_event
       WHERE order_id = ${orderId}::uuid
         AND event_type = ${RECEIPT_EVENT}
         AND sub_order_id IS NOT NULL
       GROUP BY sub_order_id`;
    return new Map(rows.map((r) => [r.sub_order_id, r.occurred_at]));
  }

  /**
   * QC through `qc`'s own allow-list, keyed on the report the machine was sold
   * against. Not "the current report for this unit": a re-inspection after a
   * broken seal is a different document, and redrawing the buyer's manifest from
   * it would make the verdict they were sold under disappear from their record.
   */
  private async sealsByReport(
    machines: readonly MachineRow[],
  ): Promise<Map<string, { code: string | null; status: string; verdict: QcVerdict | null }>> {
    const reportIds = machines
      .map((m) => m.qc_report_id)
      .filter((id): id is string => id !== null);
    const inspections = await this.qc.inspectionsByReport(reportIds);
    return new Map(
      inspections.map((i) => [
        i.reportId,
        { code: i.seal?.code ?? null, status: i.seal?.status ?? 'NOT_APPLIED', verdict: i.verdict },
      ]),
    );
  }

  private async describe(
    machines: readonly MachineRow[],
  ): Promise<Map<string, { title: string | null; specSummary: string | null } | null>> {
    return new Map(
      await Promise.all(
        [...new Set(machines.map((m) => m.sku_id))].map(
          async (id) => [id, await this.catalog.describe(id)] as const,
        ),
      ),
    );
  }

  private async windowHours(): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${WINDOW_KEY}`;
    const raw = rows[0]?.value_json;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  private windowFor(
    deliveredAt: Date | null,
    windowHours: number | null,
    now: Date,
  ): { closesAt: string; open: boolean; hoursRemaining: number } | null {
    if (deliveredAt === null || windowHours === null) return null;
    const closesAt = new Date(deliveredAt.getTime() + windowHours * HOUR_MS);
    const remainingMs = closesAt.getTime() - now.getTime();
    return {
      closesAt: closesAt.toISOString(),
      open: remainingMs > 0,
      hoursRemaining: Math.max(Math.floor(remainingMs / HOUR_MS), 0),
    };
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Orders belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }
}

/* ==========================================================================
 * The verdicts the page is handed rather than computing
 * ======================================================================== */

/**
 * Why one machine is not ready to be accepted.
 *
 * **APPLIED is a reason, and that is the whole point of the screen.** A seal
 * nobody has looked at is not an intact one, so an unchecked machine blocks the
 * handover exactly as a broken one does — for a different reason, said
 * differently.
 */
function machineBlockedReason(seal: DeliverySeal | null, windowOpen: boolean | null): string | null {
  // Whole sentences, because this one is rendered on its own under the machine
  // rather than after a serial and a colon — a clause fragment starting in lower
  // case reads as a stray line on a screen somebody is scanning at a lorry door.
  if (seal === null || seal.status === 'NOT_APPLIED') {
    return 'We have no seal recorded on this machine, so there is nothing to check against. Do not accept it — call us and we will collect it.';
  }
  // Neither of these claims a return exists. A seal can be recorded broken by
  // somebody other than the buyer — at pickup, or in an audit — and a message
  // that said "we have already opened the return" would be asserting a record
  // this module cannot see. What we CAN promise is that the remedy is ours.
  if (seal.status === 'BROKEN') {
    return 'The seal was found broken, so nobody can vouch for what is inside. Do not accept this machine — sending it back is our job and it costs you nothing.';
  }
  if (seal.status === 'MISSING') {
    return 'There was no seal on the machine, which is the same as a broken one. Do not accept it — sending it back is our job and it costs you nothing.';
  }
  if (seal.status === 'APPLIED') {
    // The window decides whether this is a task or a fact. "Compare the code on
    // the lid" once the window has shut is an instruction that cannot be
    // followed, and a screen that gives one is a screen somebody stops reading.
    return windowOpen === false
      ? 'Nobody checked this seal, and the inspection window has closed. That is not a seal we found intact — it is a check that did not happen, and the machine is covered by its warranty either way.'
      : 'Nobody has checked this seal yet. Compare the code on the lid with the code here, then say what you found.';
  }
  if (seal.status === 'REPLACED') {
    return 'This seal has been replaced since it was applied. Check the code on the lid against the one here before you accept the machine.';
  }
  // INTACT. Somebody looked and found it unbroken, which is the only state that
  // clears a machine. The QC verdict is deliberately NOT a blocker here: a
  // MISMATCH is something the buyer decides to act on, not something we decide
  // for them at their own door, and the screen gives them the action.
  return null;
}

/** Why a whole consignment cannot be signed for, naming the machines. */
function consignmentBlockedReason(
  deliveredAt: Date | null,
  windowOpen: boolean | null,
  machines: readonly DeliveryMachine[],
): string | null {
  if (deliveredAt === null) {
    return 'This delivery has not arrived yet. There is nothing to check until it does.';
  }
  if (machines.length === 0) {
    return 'No machine is assigned to this delivery yet.';
  }

  const compromised = machines.filter(
    (m) => m.seal !== null && COMPROMISED.has(m.seal.status),
  );
  if (compromised.length > 0) {
    const serials = compromised.map((m) => m.serialNumber).join(', ');
    return `${serials} ${compromised.length === 1 ? 'has' : 'have'} a seal we cannot vouch for, ` +
      'so this delivery cannot be signed for. Take-back on those machines is ours and it is not ' +
      'something you have to argue for — do not accept them, and use "Report a discrepancy" if ' +
      'no return is open on them yet.';
  }

  const unchecked = machines.filter((m) => m.seal === null || m.seal.status === 'APPLIED');
  if (unchecked.length > 0 && windowOpen === false) {
    // The window shut with nobody having looked. That is not a pass and it is
    // not a failure either — it is a check that did not happen, and telling
    // somebody to "check each one before you sign" when they no longer can is
    // an instruction that cannot be followed.
    return `${unchecked.length} of ${machines.length} ${machines.length === 1 ? 'seal was' : 'seals were'} ` +
      'never checked, and the inspection window has closed. Nothing here needs doing now — the ' +
      'machines are still under warranty and a fault found today is a claim, at our cost.';
  }
  if (unchecked.length > 0) {
    const serials = unchecked.map((m) => m.serialNumber).join(', ');
    // The noun agrees with the DENOMINATOR and the verb with the numerator:
    // "1 of 2 machines has", never "1 of 2 machine has". Every count on this
    // product carries its denominator, so this shape comes up constantly.
    const noun = machines.length === 1 ? 'machine' : 'machines';
    const verb = unchecked.length === 1 ? 'has' : 'have';
    return `${unchecked.length} of ${machines.length} ${noun} ${verb} a seal nobody has looked ` +
      `at yet — ${serials}. Check each one against the code on its lid before you sign.`;
  }

  return null;
}
