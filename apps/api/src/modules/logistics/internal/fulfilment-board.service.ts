import { Injectable } from '@nestjs/common';
import {
  BOARD_PAGE_SIZE,
  boardSlice,
  boardSort,
  type BoardEnvelope,
  type BoardFacetOption,
  type BoardQuery,
  type BoardViewCount,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';

/**
 * The fulfilment boards: shipments, pickups, riders, carriers, NDR.
 *
 * **Every board's saved-view counts come back with its page**, from one
 * statement, because a badge that disagrees with what the board shows when you
 * click it is worse than no badge. `count(*) FILTER (WHERE …)` over the filtered
 * set gives all of them for the cost of the scan the page needed anyway.
 *
 * **No board opens on All.** A board that opens on everything has handed the
 * filtering back to the operator, which is the thing that stops working at
 * volume: shipments open on Failed, pickups on Today, NDR on Open. The default
 * is the first view in each list, and the boards below are ordered accordingly.
 *
 * One module schema per statement. Where a board needs a vendor's name or an
 * order number, it is resolved in a second statement and merged in TypeScript —
 * `no-cross-schema-join` forbids the join that would be shorter, and it is right
 * to.
 */

export interface ShipmentRow {
  id: string;
  awb: string | null;
  leg: string;
  status: string;
  carrier: string | null;
  mode: string | null;
  subOrderId: string;
  orderNumber: string | null;
  boxes: number;
  declaredValue: string;
  quotedFreight: string | null;
  freightCost: string | null;
  sealId: string | null;
  sealVerifiedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  etaFrom: string | null;
  createdAt: string;
}

export interface PickupRow {
  id: string;
  subOrderId: string;
  supplyPoint: string | null;
  status: string;
  riderId: string | null;
  riderName: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  expected: number;
  scanned: number;
  sealsIntact: boolean | null;
  brokenSeals: string[];
  completedAt: string | null;
}

export interface RiderRow {
  id: string;
  userId: string | null;
  name: string | null;
  phone: string;
  zone: string | null;
  vehicleType: string | null;
  isActive: boolean;
  openPickups: number;
  openDeliveries: number;
}

export interface CarrierRow {
  id: string;
  code: string;
  name: string;
  adapterKey: string;
  supportsLeg: string[];
  isActive: boolean;
  priority: number;
  live: boolean;
  shipments: number;
  delivered: number;
  onTimePct: number | null;
  avgDays: number | null;
}

export interface NdrRow {
  id: string;
  deliveryTaskId: string;
  shipmentId: string | null;
  awb: string | null;
  carrier: string | null;
  attemptNo: number;
  attemptedAt: string;
  outcome: string;
  reason: string | null;
  nextAttemptOn: string | null;
  /** Only what this carrier's adapter actually accepts for this row. */
  legalActions: string[];
}

export interface ShipmentDetail {
  id: string;
  awb: string | null;
  status: string;
  carrier: string | null;
  orderNumber: string | null;
  routeType: string | null;
  quotedFreight: string | null;
  freightCost: string | null;
  sealId: string | null;
  sealVerifiedAt: string | null;
  podKey: string | null;
  labelKey: string | null;
  /** The carrier the router picked, as recorded at booking. */
  chosenCarrier: string | null;
  /** Who was considered and rejected, and why. The question ops actually asks. */
  excluded: Array<{ carrier: string; reason: string }>;
  bookingError: string | null;
  tracking: Array<{ code: string; description: string | null; location: string | null; at: string }>;
  attempts: Array<{ attemptNo: number; outcome: string; reason: string | null; at: string }>;
  custody: Array<{ scan: string; from: string; to: string; at: string }>;
}

type Counts = Record<string, bigint | number>;

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class FulfilmentBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  // -------------------------------------------------------------------------
  // Shipments
  // -------------------------------------------------------------------------

  /**
   * Default view is Failed, not All.
   *
   * A shipments board exists so somebody can find the consignments that are not
   * moving. Opening it on 1,573 rows sorted by date puts the six that need a
   * human on page thirty-nine.
   */
  async shipments(query: BoardQuery): Promise<BoardEnvelope<ShipmentRow>> {
    const view = query.view ?? 'failed';
    const like = likeOf(query.q);
    const carrier = query.facet?.carrier ?? null;
    const leg = query.facet?.leg ?? null;
    const mode = query.facet?.mode ?? null;

    // Every view's count and the page's own total, from one scan. The filters
    // are bound parameters; only the view predicate below is interpolated, and
    // that comes from a frozen map rather than from the caller.
    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE s.status::text IN ('EXCEPTION','FAILED','RTO','CANCELLED')) AS failed,
             count(*) FILTER (WHERE s.status::text IN ('BOOKED','MANIFESTED')) AS booked,
             count(*) FILTER (WHERE s.status::text IN ('PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY')) AS moving,
             count(*) FILTER (WHERE s.status::text = 'DELIVERED') AS delivered,
             count(*) FILTER (WHERE s.seal_verified_at IS NULL AND s.delivered_at IS NOT NULL) AS unverified
        FROM logistics.shipment s
       WHERE (${like}::text IS NULL
              OR s.awb_number ILIKE ${like} OR s.seal_id ILIKE ${like}
              OR s.id::text = ${query.q ?? null})
         AND (${carrier}::uuid IS NULL OR s.carrier_id = ${carrier}::uuid)
         AND (${leg}::text IS NULL OR s.leg::text = ${leg})
         AND (${mode}::text IS NULL OR s.mode::text = ${mode})`;

    const views: BoardViewCount[] = [
      { key: 'failed', label: 'Failed', count: num(counts?.failed) },
      { key: 'moving', label: 'In transit', count: num(counts?.moving) },
      { key: 'booked', label: 'Booked', count: num(counts?.booked) },
      { key: 'unverified', label: 'Seal unchecked', count: num(counts?.unverified) },
      { key: 'delivered', label: 'Delivered', count: num(counts?.delivered) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];

    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);
    const sort = boardSort(SHIPMENT_SORTS, 'created', query.sort, query.dir);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        awb_number: string | null;
        leg: string;
        status: string;
        carrier_id: string | null;
        mode: string | null;
        sub_order_id: string;
        boxes: number;
        declared_value: string;
        quoted_freight: string | null;
        freight_cost: string | null;
        seal_id: string | null;
        seal_verified_at: Date | null;
        dispatched_at: Date | null;
        delivered_at: Date | null;
        eta_from: Date | null;
        created_at: Date;
      }>
    >(
      `SELECT s.id, s.awb_number, s.leg::text AS leg, s.status::text AS status, s.carrier_id,
              s.mode::text AS mode, s.sub_order_id, s.boxes, s.declared_value::text AS declared_value,
              s.quoted_freight::text AS quoted_freight, s.freight_cost::text AS freight_cost,
              s.seal_id, s.seal_verified_at, s.dispatched_at, s.delivered_at, s.eta_from, s.created_at
         FROM logistics.shipment s
        WHERE ($1::text IS NULL
               OR s.awb_number ILIKE $1 OR s.seal_id ILIKE $1 OR s.id::text = $2)
          AND ($3::uuid IS NULL OR s.carrier_id = $3::uuid)
          AND ($4::text IS NULL OR s.leg::text = $4)
          AND ($5::text IS NULL OR s.mode::text = $5)
          AND ${SHIPMENT_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY ${sort.column} ${sort.dir} NULLS LAST, s.id
        LIMIT $6 OFFSET $7`,
      like,
      query.q ?? null,
      carrier,
      leg,
      mode,
      per,
      offset,
    );

    const carriers = await this.carrierNames();
    const orders = await this.orderNumbersForSubOrders(rows.map((r) => r.sub_order_id));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        awb: r.awb_number,
        leg: r.leg,
        status: r.status,
        carrier: r.carrier_id ? (carriers.get(r.carrier_id) ?? null) : null,
        mode: r.mode,
        subOrderId: r.sub_order_id,
        orderNumber: orders.get(r.sub_order_id) ?? null,
        boxes: r.boxes,
        declaredValue: r.declared_value,
        quotedFreight: r.quoted_freight,
        freightCost: r.freight_cost,
        sealId: r.seal_id,
        sealVerifiedAt: iso(r.seal_verified_at),
        dispatchedAt: iso(r.dispatched_at),
        deliveredAt: iso(r.delivered_at),
        etaFrom: iso(r.eta_from),
        createdAt: r.created_at.toISOString(),
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: {
        carrier: await this.carrierFacet(),
        leg: await this.facet('logistics.shipment', 'leg'),
        mode: await this.facet('logistics.shipment', 'mode'),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Pickups
  // -------------------------------------------------------------------------

  async pickups(query: BoardQuery): Promise<BoardEnvelope<PickupRow>> {
    const view = query.view ?? 'today';
    const like = likeOf(query.q);
    const now = this.clock.now();

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE t.slot_from::date = ${now}::date) AS today,
             count(*) FILTER (WHERE t.assigned_rider_id IS NULL AND t.status::text = 'PENDING') AS unassigned,
             count(*) FILTER (WHERE t.seals_intact IS FALSE) AS seal_broken,
             count(*) FILTER (WHERE t.status::text = 'COMPLETED') AS done
        FROM logistics.pickup_task t
       WHERE (${like}::text IS NULL OR t.id::text = ${query.q ?? null}
              OR EXISTS (SELECT 1 FROM unnest(t.expected_serials) x WHERE x ILIKE ${like}))`;

    const views: BoardViewCount[] = [
      { key: 'today', label: 'Today', count: num(counts?.today) },
      { key: 'unassigned', label: 'Unassigned', count: num(counts?.unassigned) },
      { key: 'seal_broken', label: 'Seal broken', count: num(counts?.seal_broken) },
      { key: 'done', label: 'Completed', count: num(counts?.done) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];

    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        sub_order_id: string;
        vendor_org_id: string;
        status: string;
        assigned_rider_id: string | null;
        slot_from: Date | null;
        slot_to: Date | null;
        expected: number;
        scanned: number;
        seals_intact: boolean | null;
        broken_seal_codes: string[] | null;
        completed_at: Date | null;
      }>
    >(
      `SELECT t.id, t.sub_order_id, t.vendor_org_id, t.status::text AS status,
              t.assigned_rider_id, t.slot_from, t.slot_to,
              coalesce(array_length(t.expected_serials, 1), 0) AS expected,
              coalesce(array_length(t.scanned_serials, 1), 0) AS scanned,
              t.seals_intact, t.broken_seal_codes, t.completed_at
         FROM logistics.pickup_task t
        WHERE ($1::text IS NULL OR t.id::text = $2
               OR EXISTS (SELECT 1 FROM unnest(t.expected_serials) x WHERE x ILIKE $1))
          AND ${PICKUP_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY t.slot_from ASC NULLS LAST, t.id
        LIMIT $3 OFFSET $4`,
      like,
      query.q ?? null,
      per,
      offset,
    );

    const riders = await this.riderNames();
    const points = await this.supplyPointsForSubOrders(rows.map((r) => r.sub_order_id));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        subOrderId: r.sub_order_id,
        supplyPoint: points.get(r.sub_order_id) ?? null,
        status: r.status,
        riderId: r.assigned_rider_id,
        riderName: r.assigned_rider_id ? (riders.get(r.assigned_rider_id) ?? null) : null,
        slotFrom: iso(r.slot_from),
        slotTo: iso(r.slot_to),
        expected: Number(r.expected),
        scanned: Number(r.scanned),
        sealsIntact: r.seals_intact,
        brokenSeals: r.broken_seal_codes ?? [],
        completedAt: iso(r.completed_at),
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: {},
    };
  }

  // -------------------------------------------------------------------------
  // Riders
  // -------------------------------------------------------------------------

  async riders(query: BoardQuery): Promise<BoardEnvelope<RiderRow>> {
    const view = query.view ?? 'on_duty';
    const like = likeOf(query.q);

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE r.is_active) AS on_duty,
             count(*) FILTER (WHERE NOT r.is_active) AS off_duty
        FROM logistics.rider r
       WHERE (${like}::text IS NULL OR r.phone ILIKE ${like} OR r.zone ILIKE ${like})`;

    const views: BoardViewCount[] = [
      { key: 'on_duty', label: 'On duty', count: num(counts?.on_duty) },
      { key: 'off_duty', label: 'Off duty', count: num(counts?.off_duty) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        user_id: string | null;
        phone: string;
        zone: string | null;
        vehicle_type: string | null;
        is_active: boolean;
        open_pickups: bigint;
        open_deliveries: bigint;
      }>
    >(
      `SELECT r.id, r.user_id, r.phone, r.zone, r.vehicle_type::text AS vehicle_type, r.is_active,
              (SELECT count(*) FROM logistics.pickup_task p
                WHERE p.assigned_rider_id = r.id AND p.status::text <> 'COMPLETED') AS open_pickups,
              (SELECT count(*) FROM logistics.delivery_task d
                WHERE d.rider_id = r.id AND d.status::text NOT IN ('DELIVERED','CANCELLED')) AS open_deliveries
         FROM logistics.rider r
        WHERE ($1::text IS NULL OR r.phone ILIKE $1 OR r.zone ILIKE $1)
          AND ${RIDER_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY r.is_active DESC, r.zone NULLS LAST, r.phone
        LIMIT $2 OFFSET $3`,
      like,
      per,
      offset,
    );

    const names = await this.userNames(rows.map((r) => r.user_id).filter(isString));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.user_id ? (names.get(r.user_id) ?? null) : null,
        phone: r.phone,
        zone: r.zone,
        vehicleType: r.vehicle_type,
        isActive: r.is_active,
        openPickups: num(r.open_pickups),
        openDeliveries: num(r.open_deliveries),
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: { zone: await this.facet('logistics.rider', 'zone') },
    };
  }

  // -------------------------------------------------------------------------
  // Carriers
  // -------------------------------------------------------------------------

  /**
   * On-time is measured against `eta_from`, and is null rather than 100% when
   * nothing has been delivered. A carrier with no deliveries has no record, and
   * printing a perfect score for one is how a rate card gets chosen on a number
   * that means nothing.
   */
  async carriers(query: BoardQuery): Promise<BoardEnvelope<CarrierRow>> {
    const view = query.view ?? 'active';

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE c.is_active) AS active,
             count(*) FILTER (WHERE NOT c.is_active) AS inactive
        FROM logistics.carrier c`;

    const views: BoardViewCount[] = [
      { key: 'active', label: 'Active', count: num(counts?.active) },
      { key: 'inactive', label: 'Inactive', count: num(counts?.inactive) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        code: string;
        name: string;
        adapter_key: string;
        supports_leg: string[];
        is_active: boolean;
        priority: number;
        shipments: bigint;
        delivered: bigint;
        on_time: bigint;
        avg_days: number | null;
      }>
    >(
      `SELECT c.id, c.code, c.name, c.adapter_key, c.supports_leg::text[] AS supports_leg,
              c.is_active, c.priority,
              (SELECT count(*) FROM logistics.shipment s WHERE s.carrier_id = c.id) AS shipments,
              (SELECT count(*) FROM logistics.shipment s
                WHERE s.carrier_id = c.id AND s.delivered_at IS NOT NULL) AS delivered,
              (SELECT count(*) FROM logistics.shipment s
                WHERE s.carrier_id = c.id AND s.delivered_at IS NOT NULL
                  AND s.eta_from IS NOT NULL AND s.delivered_at <= s.eta_from) AS on_time,
              (SELECT avg(extract(epoch FROM (s.delivered_at - s.dispatched_at)) / 86400.0)
                 FROM logistics.shipment s
                WHERE s.carrier_id = c.id AND s.delivered_at IS NOT NULL
                  AND s.dispatched_at IS NOT NULL) AS avg_days
         FROM logistics.carrier c
        WHERE ${CARRIER_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY c.is_active DESC, c.priority, c.code
        LIMIT $1 OFFSET $2`,
      per,
      offset,
    );

    return {
      rows: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        adapterKey: r.adapter_key,
        supportsLeg: r.supports_leg ?? [],
        isActive: r.is_active,
        priority: r.priority,
        // Whether the real adapter is wired, rather than the fake. The console
        // shows this because "we booked it" means two different things.
        live: LIVE_ADAPTERS.has(r.adapter_key),
        shipments: num(r.shipments),
        delivered: num(r.delivered),
        onTimePct: num(r.delivered) === 0 ? null : Math.round((num(r.on_time) / num(r.delivered)) * 100),
        avgDays: r.avg_days === null ? null : Math.round(Number(r.avg_days) * 10) / 10,
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: {},
    };
  }

  // -------------------------------------------------------------------------
  // NDR
  // -------------------------------------------------------------------------

  /**
   * Each row offers only the actions its carrier's adapter actually accepts.
   *
   * Porter has no NDR workflow at all — a failed trip is cancelled and re-booked
   * — so its rows carry an empty action list, and the console shows the refused
   * ones disabled rather than hiding them. An operator who clicks Reattempt and
   * gets a provider error has been told nothing; one who sees it greyed with the
   * carrier's name has been told everything.
   */
  async ndr(query: BoardQuery, legalActionsFor: (carrierCode: string) => string[]): Promise<BoardEnvelope<NdrRow>> {
    const view = query.view ?? 'open';
    const like = likeOf(query.q);

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE a.next_attempt_on IS NOT NULL) AS open,
             count(*) FILTER (WHERE a.next_attempt_on IS NULL) AS closed
        FROM logistics.delivery_attempt a
       WHERE a.outcome::text <> 'DELIVERED'`;

    const views: BoardViewCount[] = [
      { key: 'open', label: 'Open', count: num(counts?.open) },
      { key: 'closed', label: 'Closed', count: num(counts?.closed) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        delivery_task_id: string;
        attempt_no: number;
        attempted_at: Date;
        outcome: string;
        reason_note: string | null;
        next_attempt_on: Date | null;
      }>
    >(
      `SELECT a.id, a.delivery_task_id, a.attempt_no, a.attempted_at, a.outcome::text AS outcome,
              a.reason_note, a.next_attempt_on
         FROM logistics.delivery_attempt a
        WHERE a.outcome::text <> 'DELIVERED'
          AND ($1::text IS NULL OR a.reason_note ILIKE $1)
          AND ${NDR_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY a.attempted_at DESC
        LIMIT $2 OFFSET $3`,
      like,
      per,
      offset,
    );

    const tasks = await this.shipmentsForTasks(rows.map((r) => r.delivery_task_id));
    const carriers = await this.carrierCodes();

    return {
      rows: rows.map((r) => {
        const link = tasks.get(r.delivery_task_id);
        const code = link?.carrierId ? (carriers.get(link.carrierId) ?? null) : null;
        return {
          id: r.id,
          deliveryTaskId: r.delivery_task_id,
          shipmentId: link?.shipmentId ?? null,
          awb: link?.awb ?? null,
          carrier: code,
          attemptNo: r.attempt_no,
          attemptedAt: r.attempted_at.toISOString(),
          outcome: r.outcome,
          reason: r.reason_note,
          nextAttemptOn: iso(r.next_attempt_on),
          legalActions: code ? legalActionsFor(code) : [],
        };
      }),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: {},
    };
  }

  // -------------------------------------------------------------------------
  // One shipment, in full
  // -------------------------------------------------------------------------

  /**
   * Everything the record drawer shows, including **why this carrier and not
   * the others**.
   *
   * `shipment.detail` carries the routing decision as it was made — the chosen
   * carrier and every candidate that was excluded, with the reason. That is the
   * question ops actually asks when a consignment goes wrong ("why did this go
   * BlueDart?"), and it cannot be reconstructed afterwards: rate cards change,
   * serviceability changes, and a rule edited last week would give a different
   * answer today. Recorded at booking, read here, never recomputed.
   */
  async shipmentDetail(id: string): Promise<ShipmentDetail | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        awb_number: string | null;
        status: string;
        carrier_id: string | null;
        sub_order_id: string;
        seal_id: string | null;
        seal_verified_at: Date | null;
        seal_verified_by: string | null;
        quoted_freight: string | null;
        freight_cost: string | null;
        route_type: string | null;
        pod_key: string | null;
        label_key: string | null;
        detail: { chosen?: string; excluded?: Array<{ carrier: string; reason: string }>; bookingError?: string } | null;
      }>
    >`
      SELECT id, awb_number, status::text AS status, carrier_id, sub_order_id,
             seal_id, seal_verified_at, seal_verified_by,
             quoted_freight::text AS quoted_freight, freight_cost::text AS freight_cost,
             route_type::text AS route_type, pod_key, label_key, detail
        FROM logistics.shipment WHERE id = ${id}::uuid`;
    if (!row) return null;

    const tracking = await this.prisma.$queryRaw<
      Array<{ status_code: string; description: string | null; location: string | null; occurred_at: Date }>
    >`SELECT status_code, description, location, occurred_at
        FROM logistics.shipment_tracking WHERE shipment_id = ${id}::uuid
       ORDER BY occurred_at`;

    const attempts = await this.prisma.$queryRaw<
      Array<{ attempt_no: number; outcome: string; reason_note: string | null; attempted_at: Date }>
    >`SELECT a.attempt_no, a.outcome::text AS outcome, a.reason_note, a.attempted_at
        FROM logistics.delivery_attempt a
        JOIN logistics.delivery_task t ON t.id = a.delivery_task_id
       WHERE t.shipment_id = ${id}::uuid
       ORDER BY a.attempt_no`;

    const units = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT unit_id FROM logistics.shipment_unit WHERE shipment_id = ${id}::uuid`;

    const custody = units.length
      ? await this.prisma.$queryRaw<
          Array<{ scan_type: string; from_party: string; to_party: string; occurred_at: Date }>
        >`SELECT scan_type::text AS scan_type, from_party::text AS from_party,
                 to_party::text AS to_party, occurred_at
            FROM logistics.custody_event
           WHERE unit_id = ANY(${units.map((u) => u.unit_id)}::uuid[])
           ORDER BY occurred_at`
      : [];

    const carriers = await this.carrierNames();
    const orders = await this.orderNumbersForSubOrders([row.sub_order_id]);

    return {
      id: row.id,
      awb: row.awb_number,
      status: row.status,
      carrier: row.carrier_id ? (carriers.get(row.carrier_id) ?? null) : null,
      orderNumber: orders.get(row.sub_order_id) ?? null,
      routeType: row.route_type,
      quotedFreight: row.quoted_freight,
      freightCost: row.freight_cost,
      sealId: row.seal_id,
      sealVerifiedAt: iso(row.seal_verified_at),
      podKey: row.pod_key,
      labelKey: row.label_key,
      chosenCarrier: row.detail?.chosen ?? null,
      excluded: row.detail?.excluded ?? [],
      bookingError: row.detail?.bookingError ?? null,
      tracking: tracking.map((t) => ({
        code: t.status_code,
        description: t.description,
        location: t.location,
        at: t.occurred_at.toISOString(),
      })),
      attempts: attempts.map((a) => ({
        attemptNo: a.attempt_no,
        outcome: a.outcome,
        reason: a.reason_note,
        at: a.attempted_at.toISOString(),
      })),
      custody: custody.map((c) => ({
        scan: c.scan_type,
        from: c.from_party,
        to: c.to_party,
        at: c.occurred_at.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Cross-schema lookups, each its own statement
  // -------------------------------------------------------------------------

  private async carrierNames(): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM logistics.carrier`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async carrierCodes(): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; code: string }>>`
      SELECT id, code FROM logistics.carrier`;
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  private async carrierFacet(): Promise<BoardFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; n: bigint }>>`
      SELECT c.id, c.name,
             (SELECT count(*) FROM logistics.shipment s WHERE s.carrier_id = c.id) AS n
        FROM logistics.carrier c ORDER BY c.name`;
    return rows.map((r) => ({ value: r.id, label: r.name, count: num(r.n) }));
  }

  private async riderNames(): Promise<Map<string, string>> {
    const riders = await this.prisma.$queryRaw<Array<{ id: string; user_id: string | null; phone: string }>>`
      SELECT id, user_id, phone FROM logistics.rider`;
    const names = await this.userNames(riders.map((r) => r.user_id).filter(isString));
    return new Map(
      riders.map((r) => [r.id, (r.user_id ? names.get(r.user_id) : null) ?? r.phone]),
    );
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  private async orderNumbersForSubOrders(subOrderIds: string[]): Promise<Map<string, string>> {
    if (!subOrderIds.length) return new Map();
    const subs = await this.prisma.$queryRaw<Array<{ id: string; order_id: string }>>`
      SELECT id, order_id FROM ordering.sub_order WHERE id = ANY(${subOrderIds}::uuid[])`;
    const orderIds = [...new Set(subs.map((s) => s.order_id))];
    if (!orderIds.length) return new Map();
    const orders = await this.prisma.$queryRaw<Array<{ id: string; order_number: string }>>`
      SELECT id, order_number FROM ordering."order" WHERE id = ANY(${orderIds}::uuid[])`;
    const byId = new Map(orders.map((o) => [o.id, o.order_number]));
    return new Map(
      subs.flatMap((s) => {
        const n = byId.get(s.order_id);
        return n ? ([[s.id, n]] as Array<[string, string]>) : [];
      }),
    );
  }

  private async supplyPointsForSubOrders(subOrderIds: string[]): Promise<Map<string, string>> {
    if (!subOrderIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; purchase_order_id: string | null }>
    >`SELECT id, purchase_order_id FROM ordering.sub_order WHERE id = ANY(${subOrderIds}::uuid[])`;
    const poIds = rows.map((r) => r.purchase_order_id).filter(isString);
    if (!poIds.length) return new Map();
    const pos = await this.prisma.$queryRaw<
      Array<{ id: string; supply_point_label: string | null }>
    >`SELECT id, supply_point_label FROM procurement.purchase_order WHERE id = ANY(${poIds}::uuid[])`;
    const byPo = new Map(pos.map((p) => [p.id, p.supply_point_label]));
    return new Map(
      rows.flatMap((r) => {
        const label = r.purchase_order_id ? byPo.get(r.purchase_order_id) : null;
        return label ? ([[r.id, label]] as Array<[string, string]>) : [];
      }),
    );
  }

  private async shipmentsForTasks(
    taskIds: string[],
  ): Promise<Map<string, { shipmentId: string; awb: string | null; carrierId: string | null }>> {
    if (!taskIds.length) return new Map();
    const tasks = await this.prisma.$queryRaw<Array<{ id: string; shipment_id: string }>>`
      SELECT id, shipment_id FROM logistics.delivery_task WHERE id = ANY(${taskIds}::uuid[])`;
    const shipmentIds = [...new Set(tasks.map((t) => t.shipment_id))];
    if (!shipmentIds.length) return new Map();
    const shipments = await this.prisma.$queryRaw<
      Array<{ id: string; awb_number: string | null; carrier_id: string | null }>
    >`SELECT id, awb_number, carrier_id FROM logistics.shipment WHERE id = ANY(${shipmentIds}::uuid[])`;
    const byId = new Map(shipments.map((s) => [s.id, s]));
    return new Map(
      tasks.flatMap((t) => {
        const s = byId.get(t.shipment_id);
        return s
          ? ([[t.id, { shipmentId: s.id, awb: s.awb_number, carrierId: s.carrier_id }]] as Array<
              [string, { shipmentId: string; awb: string | null; carrierId: string | null }]
            >)
          : [];
      }),
    );
  }

  /** Facet options straight off a column. Table and column are literals here, never input. */
  private async facet(table: string, column: string): Promise<BoardFacetOption[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string | null; n: bigint }>>(
      `SELECT ${column}::text AS v, count(*) AS n FROM ${table}
        WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    return rows.flatMap((r) =>
      r.v ? [{ value: r.v, label: r.v.replace(/_/g, ' '), count: num(r.n) }] : [],
    );
  }
}

const isString = (v: string | null): v is string => v !== null;

const likeOf = (q?: string): string | null =>
  q && q.trim() ? `%${q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;

/**
 * View predicates as SQL fragments.
 *
 * Interpolated, so they are looked up by key from a frozen map and an unknown
 * key falls through to TRUE. No caller string reaches the statement.
 */
const SHIPMENT_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  failed: `s.status::text IN ('EXCEPTION','FAILED','RTO','CANCELLED')`,
  booked: `s.status::text IN ('BOOKED','MANIFESTED')`,
  moving: `s.status::text IN ('PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY')`,
  delivered: `s.status::text = 'DELIVERED'`,
  unverified: `s.seal_verified_at IS NULL AND s.delivered_at IS NOT NULL`,
  all: 'TRUE',
});

const PICKUP_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  today: `t.slot_from::date = current_date`,
  unassigned: `t.assigned_rider_id IS NULL AND t.status::text = 'PENDING'`,
  seal_broken: `t.seals_intact IS FALSE`,
  done: `t.status::text = 'COMPLETED'`,
  all: 'TRUE',
});

const RIDER_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  on_duty: 'r.is_active',
  off_duty: 'NOT r.is_active',
  all: 'TRUE',
});

const CARRIER_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  active: 'c.is_active',
  inactive: 'NOT c.is_active',
  all: 'TRUE',
});

const NDR_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  open: 'a.next_attempt_on IS NOT NULL',
  closed: 'a.next_attempt_on IS NULL',
  all: 'TRUE',
});

const SHIPMENT_SORTS = Object.freeze({
  created: 's.created_at',
  dispatched: 's.dispatched_at',
  delivered: 's.delivered_at',
  value: 's.declared_value',
  freight: 's.freight_cost',
  awb: 's.awb_number',
});

/** Adapters that talk to a real provider. The rest are in-process fakes. */
const LIVE_ADAPTERS = new Set(['bluedart', 'porter', 'inhouse']);

export { BOARD_PAGE_SIZE };
