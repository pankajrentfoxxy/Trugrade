import { Injectable, Logger } from '@nestjs/common';
import { Money, money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import {
  IllegalStateTransitionError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { QcRepository, type QcVisitRow } from './qc.repository';
import type { QcVisitStatus, VendorTier, VisitFeeBearer } from '../dto/qc.dto';

/**
 * Getting one technician to one vendor site for one day, and proving they got
 * there.
 *
 * A `qc_visit` is deliberately not a calendar entry with a person attached. Six
 * separate facts have to agree before a technician can be sent, and every one of
 * them costs real money when it is wrong: a wasted day of travel, a vendor who
 * blocked out staff for nothing, or — the expensive one — a tool licence seat we
 * are billed for and did not have.
 *
 * The six, in the order they are checked, because the cheap checks come first:
 *
 *   1. **The site is open.** `vendor.facility_hours` for that weekday, and no
 *      `vendor.facility_holiday` row. A technician standing outside a shuttered
 *      warehouse is the single most common field-ops failure, and it is entirely
 *      preventable from data the vendor already gave us at onboarding.
 *   2. **The technician covers the zone.** `qc_technician.zones` against the
 *      facility's pincode, resolved through `identity.pincode_master`.
 *   3. **The technician is certified for the tool.** `certified_tools` against
 *      the visit's `qc_tool_provider.code`. An uncertified operator invalidates
 *      the certificate, which is the thing we are selling.
 *   4. **They said they were free.** A `technician_availability` row covering the
 *      slot, status AVAILABLE.
 *   5. **They have the hours and the legs.** `daily_capacity_units` (40) across
 *      every visit already booked that day, and `max_sites_per_day` (3).
 *   6. **We have a seat.** `qc_tool_provider.licence_seats` caps the number of
 *      distinct technicians running that tool on one day.
 *
 * **`licence_seats` is NULL until a commercial agreement is recorded, and NULL
 * means "no cap recorded" — never zero.** Reading it as zero refuses to schedule
 * anybody, and it would do so silently, on a column nobody thinks about, on the
 * day a new tool is added. `seatCap()` is the one place that decision lives.
 *
 * Every read here is a single-schema statement. `qc`, `vendor`, `identity` and
 * `listing` are four modules' schemas and `no-cross-schema-join` is an error, so
 * the facts are fetched separately and combined in TypeScript. That is the rule
 * working as intended rather than a workaround: the day `vendor` becomes its own
 * service, this file changes four queries into four calls and nothing else.
 */

/** `qc.geo_variance_alert_metres` — the distance that turns a check-in into a signal. */
const GEO_VARIANCE_KEY = 'qc.geo_variance_alert_metres';

/**
 * The visit lifecycle, as `public.qc_visit_status` allows it.
 *
 * There is no CHECK behind this — the enum permits any value in any order — so
 * the map is the only thing standing between a coherent visit history and a
 * visit that went COMPLETED before anybody arrived. Terminal states have no
 * exits on purpose: a cancelled visit is re-run as a new visit, so the
 * `reschedule_count` on the original stays true.
 */
export const VISIT_TRANSITIONS: Readonly<Record<QcVisitStatus, readonly QcVisitStatus[]>> = Object.freeze({
  REQUESTED: ['QUOTED', 'SCHEDULED', 'CANCELLED'],
  QUOTED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['TECH_ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW_VENDOR'],
  TECH_ASSIGNED: ['EN_ROUTE', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW_VENDOR', 'NO_SHOW_TECH'],
  EN_ROUTE: ['IN_PROGRESS', 'NO_SHOW_VENDOR', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'PARTIALLY_COMPLETED'],
  RESCHEDULED: ['SCHEDULED', 'TECH_ASSIGNED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  CANCELLED: [],
  NO_SHOW_VENDOR: [],
  NO_SHOW_TECH: [],
});

/** The statuses a date and a technician may still be (re)written on. */
const SCHEDULABLE_FROM: readonly QcVisitStatus[] = [
  'REQUESTED',
  'QUOTED',
  'SCHEDULED',
  'TECH_ASSIGNED',
  'RESCHEDULED',
];

/** A visit that still counts against a technician's day. */
const LIVE_VISIT_STATUSES: readonly QcVisitStatus[] = [
  'SCHEDULED',
  'TECH_ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
];

export interface ScheduleInput {
  scheduledDate: string;
  slotFrom: string;
  slotTo: string;
  /** Omit to pencil in a date without naming a person: the visit lands on SCHEDULED. */
  technicianId?: string;
}

export interface SlotWindow {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
}

export interface SlotCandidate {
  technicianId: string;
  employeeCode: string;
  scheduledDate: string;
  slotFrom: string;
  slotTo: string;
  /** Units already committed that day, before this visit. */
  unitsBooked: number;
  sitesBooked: number;
}

export interface SamplePlan {
  tier: VendorTier;
  samplePct: number;
  unitsOnManifest: number;
  unitsToInspect: number;
  /** The sampled subset, when a manifest exists. Empty when it does not yet. */
  unitIds: string[];
  fullInspection: boolean;
  /** Consignment value the decision was taken against, when it could be read. */
  consignmentValue: Money | null;
  /** Why this percentage, in a sentence an ops person can act on. */
  reason: string;
}

export interface CheckInInput {
  latitude: number;
  longitude: number;
}

export interface CheckInResult {
  visit: QcVisitRow;
  geoVarianceMetres: number | null;
  /** TRUE when the variance exceeded `qc.geo_variance_alert_metres`. */
  alerted: boolean;
}

/** A `HH:MM` or `HH:MM:SS` slot boundary, normalised to what a `time` column returns. */
function normaliseTime(value: string, field: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!m) {
    throw new ValidationError('Enter a time as HH:MM, on the 24-hour clock.', {
      [field]: 'Expected HH:MM or HH:MM:SS.',
    });
  }
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

function requireDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Enter a date as YYYY-MM-DD.', { [field]: 'Expected YYYY-MM-DD.' });
  }
  return value;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine on a spherical earth is accurate to about 0.3% — three metres in a
 * kilometre. The threshold this feeds is 500 m and the question it answers is
 * "is the technician at the warehouse or somewhere else entirely", so a geodesic
 * solver would be more arithmetic for an answer that does not change.
 */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: QcRepository,
  ) {}

  // =========================================================================
  // Status
  // =========================================================================

  /**
   * The transitions that carry no side effects: quoting, setting off, calling a
   * no-show, cancelling.
   *
   * `schedule()` and `checkIn()` are separate methods precisely because they do
   * carry side effects — booking a slot and capturing geo — and folding them in
   * here would make a status change and an anti-fraud control the same call.
   */
  async advance(
    visitId: string,
    to: QcVisitStatus,
    opts: { reason?: string } = {},
  ): Promise<QcVisitRow> {
    const visit = await this.mustFind(visitId);
    this.assertTransition(visit.status, to);

    // A cancellation or a no-show without a reason is a row nobody can explain
    // to the vendor who took the day off, or to the technician it is recorded
    // against. `cancellation_reason` is the column all four land in.
    const needsReason: readonly QcVisitStatus[] = [
      'CANCELLED',
      'NO_SHOW_VENDOR',
      'NO_SHOW_TECH',
      'RESCHEDULED',
    ];
    const reason = opts.reason?.trim();
    if (needsReason.includes(to) && (!reason || reason.length < 3)) {
      throw new ValidationError('Say why, in a few words at least — this goes on the record.', {
        reason: 'Give a reason of at least 3 characters.',
      });
    }

    return this.prisma.runInTransaction(async () => {
      // A visit that is no longer happening must give the slot back, or the
      // technician's day stays full of a visit that was cancelled a week ago.
      if (to === 'CANCELLED' || to === 'RESCHEDULED' || to === 'NO_SHOW_VENDOR') {
        await this.releaseSlot(visit);
      }
      const updated = await this.repo.updateVisit(visitId, {
        status: to,
        ...(reason ? { cancellationReason: reason } : {}),
        ...(to === 'RESCHEDULED' ? { rescheduleCount: visit.rescheduleCount + 1 } : {}),
      });
      return updated!;
    });
  }

  /**
   * Record the agreed fee and move REQUESTED to QUOTED.
   *
   * The fee was already computed when the vendor submitted the listing; this is
   * where ops confirm or waive it. A waiver needs a written reason for the same
   * reason a cancellation does — `fee_waiver_reason` is what an auditor reads
   * when the visit economics do not add up.
   */
  async quote(
    visitId: string,
    input: { visitFee: Money; feeBearer: VisitFeeBearer; feeWaiverReason?: string },
  ): Promise<QcVisitRow> {
    const visit = await this.mustFind(visitId);
    this.assertTransition(visit.status, 'QUOTED');

    if (input.feeBearer === 'WAIVED' && !input.feeWaiverReason?.trim()) {
      throw new ValidationError('A waived visit fee needs a reason on the record.', {
        feeWaiverReason: 'Say why the fee is being waived.',
      });
    }

    const updated = await this.repo.updateVisit(visitId, {
      status: 'QUOTED',
      visitFee: input.visitFee,
      feeBearer: input.feeBearer,
      ...(input.feeWaiverReason ? { feeWaiverReason: input.feeWaiverReason.trim() } : {}),
    });
    return updated!;
  }

  // =========================================================================
  // Scheduling
  // =========================================================================

  /**
   * Fix the date, the slot and — optionally — the technician.
   *
   * With no technician the visit lands on SCHEDULED: the vendor has a date and
   * ops still have to find a person. With one it lands on TECH_ASSIGNED, and
   * every check in this file's header has to pass first.
   *
   * Re-calling this on an already-scheduled visit is a move, not a second
   * booking: the old availability slot is released inside the same transaction.
   */
  async schedule(visitId: string, input: ScheduleInput): Promise<QcVisitRow> {
    const visit = await this.mustFind(visitId);
    if (!SCHEDULABLE_FROM.includes(visit.status)) {
      throw new IllegalStateTransitionError('qc_visit', visit.status, 'SCHEDULED');
    }

    const date = requireDate(input.scheduledDate, 'scheduledDate');
    const slotFrom = normaliseTime(input.slotFrom, 'slotFrom');
    const slotTo = normaliseTime(input.slotTo, 'slotTo');
    if (slotTo <= slotFrom) {
      throw new ValidationError('The slot has to end after it starts.', {
        slotTo: 'End time must be later than the start time.',
      });
    }
    if (date < this.clock.todayInIst()) {
      // VR-160: "today" is Asia/Kolkata, not the server's UTC day. A visit
      // booked at 04:00 IST on the 3rd is not in the past because UTC says the 2nd.
      throw new ValidationError('That date has already passed.', {
        scheduledDate: 'Pick today or a later date.',
      });
    }

    await this.assertSiteOpen(visit.facilityId, date, slotFrom, slotTo);

    if (!input.technicianId) {
      return (await this.repo.updateVisit(visitId, {
        status: 'SCHEDULED',
        scheduledDate: date,
        slotFrom,
        slotTo,
      }))!;
    }

    const rejection = await this.rejectionFor(visit, input.technicianId, date, slotFrom, slotTo);
    if (rejection) throw new PreconditionFailedError(rejection.message, rejection.detail);

    return this.prisma.runInTransaction(async () => {
      await this.releaseSlot(visit);
      await this.repo.upsertAvailability(input.technicianId!, [
        { theDate: date, slotFrom, slotTo, status: 'BOOKED', note: visit.visitNumber },
      ]);
      const updated = await this.repo.updateVisit(visitId, {
        status: 'TECH_ASSIGNED',
        scheduledDate: date,
        slotFrom,
        slotTo,
        technicianId: input.technicianId,
      });
      return updated!;
    });
  }

  /**
   * Every (technician, slot) pair that would pass `schedule()` in a date window.
   *
   * Deliberately built from the same `rejectionFor()` predicate the booking path
   * uses, rather than a parallel query with the same joins. Two implementations
   * of "can this person do this day" drift, and they drift in the direction that
   * offers a slot the booking then refuses — which reads to ops as a bug in the
   * calendar rather than a rule they have not been told about.
   */
  async findSlots(visitId: string, window: SlotWindow): Promise<SlotCandidate[]> {
    const visit = await this.mustFind(visitId);
    const from = requireDate(window.from, 'from');
    const to = requireDate(window.to, 'to');

    const candidates = await this.candidateTechnicians(visit);
    if (candidates.length === 0) return [];

    const slots = await this.repo.findAvailability({
      technicianIds: candidates.map((t) => t.id),
      from,
      to,
      status: 'AVAILABLE',
    });

    const byId = new Map(candidates.map((t) => [t.id, t]));
    const out: SlotCandidate[] = [];
    for (const slot of slots) {
      const tech = byId.get(slot.technicianId);
      if (!tech) continue;
      const rejection = await this.rejectionFor(
        visit,
        slot.technicianId,
        slot.theDate,
        slot.slotFrom,
        slot.slotTo,
      );
      if (rejection) continue;
      const load = await this.dayLoad(slot.technicianId, slot.theDate, visit.id);
      out.push({
        technicianId: slot.technicianId,
        employeeCode: tech.employeeCode,
        scheduledDate: slot.theDate,
        slotFrom: slot.slotFrom,
        slotTo: slot.slotTo,
        unitsBooked: load.units,
        sitesBooked: load.sites,
      });
    }
    // Emptiest day first: spreading the load beats filling one technician to 40
    // and leaving the next site unservable.
    return out.sort(
      (a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        a.unitsBooked - b.unitsBooked ||
        a.slotFrom.localeCompare(b.slotFrom),
    );
  }

  // =========================================================================
  // Arrival — the anti-fraud control
  // =========================================================================

  /**
   * The technician checks in at the site. EN_ROUTE becomes IN_PROGRESS.
   *
   * `geo_variance_metres` is the distance between where they say they are and
   * the address the vendor registered. It is recorded on every check-in, not
   * only on the suspicious ones, because a variance is only interpretable
   * against the distribution of every other visit — and a column populated
   * exclusively on alerts has no distribution.
   *
   * Above the threshold this warns and continues. It does **not** block: a
   * genuine second gate 600 m down the road is more likely than fraud, and a
   * technician locked out of the app at a vendor's warehouse has no recourse.
   * The signal is for the QC manager, who can see the unit-level evidence too.
   */
  async checkIn(visitId: string, input: CheckInInput): Promise<CheckInResult> {
    const visit = await this.mustFind(visitId);
    this.assertTransition(visit.status, 'IN_PROGRESS');

    if (
      !Number.isFinite(input.latitude) ||
      !Number.isFinite(input.longitude) ||
      Math.abs(input.latitude) > 90 ||
      Math.abs(input.longitude) > 180
    ) {
      throw new ValidationError('We could not read your location. Try checking in again.', {
        latitude: 'Expected a decimal latitude and longitude.',
      });
    }

    const site = await this.facilityCoordinates(visit.addressId);
    const variance =
      site === null
        ? null
        : metresBetween(site.latitude, site.longitude, input.latitude, input.longitude);

    const threshold = await this.configInt(GEO_VARIANCE_KEY);
    const alerted = variance !== null && variance > threshold;

    if (alerted) {
      // Logged rather than published: there is no `qc.visit.geo_variance` event
      // in the contracts package, and inventing an event name here would create
      // a queue topic nobody has agreed to. Flagged in the return value instead.
      this.logger.warn(
        `Visit ${visit.visitNumber}: check-in ${variance} m from the registered facility (alert above ${threshold} m).`,
      );
    }
    if (site === null) {
      // An address with no coordinates cannot be an anti-fraud control, and a
      // NULL variance that reads as "nothing wrong" is the failure mode worth
      // naming out loud.
      this.logger.warn(
        `Visit ${visit.visitNumber}: the registered address has no coordinates, so arrival could not be verified.`,
      );
    }

    const now = this.clock.now();
    const updated = await this.repo.updateVisit(visitId, {
      status: 'IN_PROGRESS',
      arrivedAt: now,
      startedAt: now,
      arrivalGeoLat: input.latitude,
      arrivalGeoLng: input.longitude,
      ...(variance === null ? {} : { geoVarianceMetres: variance }),
    });

    return { visit: updated!, geoVarianceMetres: variance, alerted };
  }

  // =========================================================================
  // Sampling
  // =========================================================================

  /**
   * How much of this consignment to inspect, from `qc_sampling_rule`.
   *
   * Two things about this are worth stating plainly.
   *
   * **The tier alone does not earn the discount.** The rule row carries
   * `min_units_inspected`, `min_pass_rate` and `min_grade_accuracy`, and they
   * are re-checked here against `qc.vendor_quality` and the latest
   * `platform.vendor_scorecard`. A GOLD vendor whose grade accuracy has slipped
   * below the rule's floor falls back to 100% until the nightly scorecard job
   * catches up and re-tiers them. Falling back is the safe direction to be wrong
   * in; trusting a stale tier column is not.
   *
   * **The plan is advisory, and it does not by itself make a unit sellable.**
   * `listing.unit_is_sellable()` requires a QC report *and* an intact seal on
   * every unit, so an uninspected unit can never reach the storefront whatever
   * this returns. The percentage sizes the visit — how many units the technician
   * commits a day to — rather than deciding which units may be listed. If the
   * commercial intent is that unsampled units list on the vendor's track record,
   * that is a change to `listing.unit_is_sellable`, not to this method.
   */
  async planSample(visitId: string): Promise<SamplePlan> {
    const visit = await this.mustFind(visitId);
    const tier = await this.vendorTier(visit.vendorOrgId);
    const rule = await this.repo.findActiveSamplingRule(tier);

    const manifest = await this.repo.findVisitUnits({ visitId });
    const total = manifest.length > 0 ? manifest.length : visit.unitsRequested;

    if (!rule) {
      // No active rule for the tier is not a licence to sample: it is a missing
      // policy, and the conservative reading of a missing policy is "inspect
      // everything".
      return this.fullPlan(
        tier,
        100,
        total,
        manifest,
        null,
        `No active sampling rule for ${tier}.`,
      );
    }

    const value = await this.consignmentValue(manifest.map((u) => u.unitId));
    if (rule.alwaysFullAboveValue && value && value.gte(rule.alwaysFullAboveValue)) {
      return this.fullPlan(
        tier,
        100,
        total,
        manifest,
        value,
        `Consignment value ${value.format()} is at or above the ${rule.alwaysFullAboveValue.format()} full-inspection threshold.`,
      );
    }

    const shortfall = await this.tierShortfall(visit.vendorOrgId, rule);
    if (shortfall) {
      return this.fullPlan(tier, 100, total, manifest, value, shortfall);
    }

    const pct = Math.max(0, Math.min(100, rule.samplePct));
    const count = Math.min(total, Math.ceil((total * pct) / 100));
    return {
      tier,
      samplePct: pct,
      unitsOnManifest: total,
      unitsToInspect: count,
      unitIds: this.sampleUnits(manifest, count),
      fullInspection: pct >= 100,
      consignmentValue: value,
      reason: `${tier} earns ${pct}% sampling under the rule effective ${rule.effectiveFrom}.`,
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async mustFind(visitId: string): Promise<QcVisitRow> {
    const visit = await this.repo.findVisitById(visitId);
    if (!visit) throw new NotFoundError('inspection visit', { visitId });
    return visit;
  }

  private assertTransition(from: QcVisitStatus, to: QcVisitStatus): void {
    if (!VISIT_TRANSITIONS[from].includes(to)) {
      throw new IllegalStateTransitionError('qc_visit', from, to);
    }
  }

  /**
   * Hand a booked slot back to the technician's calendar.
   *
   * Availability is keyed `(technician_id, the_date, slot_from)`, so this is an
   * upsert back to AVAILABLE rather than a delete: deleting would lose the fact
   * that the technician had offered the slot in the first place, and the next
   * roster publish would silently not restore it.
   */
  private async releaseSlot(visit: QcVisitRow): Promise<void> {
    if (!visit.technicianId || !visit.scheduledDate || !visit.slotFrom || !visit.slotTo) return;
    await this.repo.upsertAvailability(visit.technicianId, [
      {
        theDate: visit.scheduledDate,
        slotFrom: visit.slotFrom,
        slotTo: visit.slotTo,
        status: 'AVAILABLE',
        note: null,
      },
    ]);
  }

  /**
   * The one predicate. Returns `null` when the technician can take the visit, or
   * the reason they cannot, phrased for whoever is looking at the calendar.
   */
  private async rejectionFor(
    visit: QcVisitRow,
    technicianId: string,
    date: string,
    slotFrom: string,
    slotTo: string,
  ): Promise<{ message: string; detail: Record<string, unknown> } | null> {
    const tech = await this.repo.findTechnicianById(technicianId);
    if (!tech || !tech.isActive) {
      return {
        message: 'That technician is not available for assignment.',
        detail: { technicianId, reason: 'technician_inactive' },
      };
    }

    const toolCode = await this.toolCode(visit.toolProviderId);
    if (toolCode && !tech.certifiedTools.includes(toolCode)) {
      // An uncertified operator invalidates the certificate, which is the only
      // thing the buyer is actually paying a premium for.
      return {
        message: `${tech.employeeCode} is not certified on ${toolCode}.`,
        detail: { technicianId, toolCode, reason: 'not_certified' },
      };
    }

    const zones = await this.zoneTokens(visit.addressId);
    if (zones.length > 0 && !zones.some((z) => tech.zones.includes(z))) {
      return {
        message: `${tech.employeeCode} does not cover this site's zone.`,
        detail: { technicianId, zones, covers: tech.zones, reason: 'zone_mismatch' },
      };
    }

    const free = await this.repo.findAvailability({
      technicianIds: [technicianId],
      from: date,
      to: date,
    });
    const covering = free.find(
      (s) => s.slotFrom <= slotFrom && s.slotTo >= slotTo && s.status === 'AVAILABLE',
    );
    const heldByThisVisit = free.some(
      (s) => s.status === 'BOOKED' && s.note === visit.visitNumber && s.slotFrom === slotFrom,
    );
    if (!covering && !heldByThisVisit) {
      return {
        message: `${tech.employeeCode} has not offered ${slotFrom.slice(0, 5)}–${slotTo.slice(0, 5)} on ${date}.`,
        detail: { technicianId, date, slotFrom, slotTo, reason: 'no_availability' },
      };
    }

    const load = await this.dayLoad(technicianId, date, visit.id);
    if (load.units + visit.unitsRequested > tech.dailyCapacityUnits) {
      return {
        message: `${tech.employeeCode} would be at ${load.units + visit.unitsRequested} units on ${date}, over the ${tech.dailyCapacityUnits}-unit day.`,
        detail: {
          technicianId,
          booked: load.units,
          adding: visit.unitsRequested,
          capacity: tech.dailyCapacityUnits,
          reason: 'over_daily_capacity',
        },
      };
    }
    if (load.sites + 1 > tech.maxSitesPerDay) {
      return {
        message: `${tech.employeeCode} already has ${load.sites} sites on ${date}, the maximum for one day.`,
        detail: {
          technicianId,
          sites: load.sites,
          max: tech.maxSitesPerDay,
          reason: 'over_max_sites',
        },
      };
    }

    const seats = await this.seatCap(visit.toolProviderId);
    if (seats !== null) {
      const inUse = await this.techniciansOnTool(visit.toolProviderId!, date, technicianId);
      if (inUse + 1 > seats) {
        return {
          message: `All ${seats} ${toolCode ?? 'tool'} licence seats are in use on ${date}.`,
          detail: { date, seats, inUse, reason: 'no_licence_seat' },
        };
      }
    }

    return null;
  }

  /** Units and distinct sites already committed to this technician on this date. */
  private async dayLoad(
    technicianId: string,
    date: string,
    excludeVisitId: string,
  ): Promise<{ units: number; sites: number }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ units: bigint | number; sites: bigint | number }>
    >`
      SELECT COALESCE(SUM(units_requested), 0)::int AS units,
             COUNT(DISTINCT facility_id)::int       AS sites
        FROM qc.qc_visit
       WHERE technician_id = ${technicianId}::uuid
         AND scheduled_date = ${date}::date
         AND id <> ${excludeVisitId}::uuid
         AND status = ANY(${[...LIVE_VISIT_STATUSES]}::text[]::public.qc_visit_status[])`;
    return { units: Number(row?.units ?? 0), sites: Number(row?.sites ?? 0) };
  }

  /** Distinct technicians already running this tool on this date, excluding one. */
  private async techniciansOnTool(
    toolProviderId: string,
    date: string,
    excludeTechnicianId: string,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>`
      SELECT COUNT(DISTINCT technician_id)::int AS n
        FROM qc.qc_visit
       WHERE tool_provider_id = ${toolProviderId}::uuid
         AND scheduled_date = ${date}::date
         AND technician_id IS NOT NULL
         AND technician_id <> ${excludeTechnicianId}::uuid
         AND status = ANY(${[...LIVE_VISIT_STATUSES]}::text[]::public.qc_visit_status[])`;
    return Number(row?.n ?? 0);
  }

  /**
   * The hard cap on concurrent technicians, or `null` for "no cap recorded".
   *
   * `licence_seats` is NULL until somebody records a commercial agreement, and
   * the whole point of this method existing is that `?? 0` in a caller would
   * refuse to schedule anyone at all — silently, on a column nobody looks at,
   * the first day a tool provider is added.
   */
  private async seatCap(toolProviderId: string | null): Promise<number | null> {
    if (!toolProviderId) return null;
    const [row] = await this.prisma.$queryRaw<Array<{ licence_seats: number | null }>>`
      SELECT licence_seats FROM qc.qc_tool_provider WHERE id = ${toolProviderId}::uuid`;
    return row?.licence_seats ?? null;
  }

  private async toolCode(toolProviderId: string | null): Promise<string | null> {
    if (!toolProviderId) return null;
    const [row] = await this.prisma.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM qc.qc_tool_provider WHERE id = ${toolProviderId}::uuid`;
    return row?.code ?? null;
  }

  private async candidateTechnicians(
    visit: QcVisitRow,
  ): Promise<Array<{ id: string; employeeCode: string }>> {
    const toolCode = await this.toolCode(visit.toolProviderId);
    const zones = await this.zoneTokens(visit.addressId);

    // One query per zone token rather than one with `&&`: `findTechnicians`
    // already exists and uses the partial GIN index the containment operator
    // answers, and there are at most three tokens. Re-deriving the SQL here to
    // save two round trips on a scheduling call is the wrong trade.
    const seen = new Map<string, { id: string; employeeCode: string }>();
    const searches = zones.length > 0 ? zones : [undefined];
    for (const zone of searches) {
      const rows = await this.repo.findTechnicians({
        zone,
        tool: toolCode ?? undefined,
        activeOnly: true,
      });
      for (const t of rows) seen.set(t.id, { id: t.id, employeeCode: t.employeeCode });
    }
    return [...seen.values()];
  }

  /**
   * The zone labels a site can be matched on: its pincode, its
   * `identity.pincode_master` zone, and NCR when the pincode is in it.
   *
   * `qc_technician.zones` is a free `TEXT[]` and the seeded data uses both
   * regional labels ('NORTH') and operational ones ('NCR'), so a single
   * authoritative vocabulary does not exist to match against. Returning every
   * label the site legitimately carries and asking for any overlap is honest
   * about that; picking one would silently exclude every technician zoned the
   * other way.
   *
   * An unknown pincode returns just the pincode itself rather than nothing —
   * `pincode_master` is reference data that may not be loaded, and an empty
   * token list must not read as "no technician covers anywhere".
   */
  private async zoneTokens(addressId: string): Promise<string[]> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ pincode: string; zone: string | null; is_ncr: boolean | null }>
    >`
      SELECT a.pincode,
             (SELECT p.zone   FROM identity.pincode_master p WHERE p.pincode = a.pincode) AS zone,
             (SELECT p.is_ncr FROM identity.pincode_master p WHERE p.pincode = a.pincode) AS is_ncr
        FROM identity.org_address a
       WHERE a.id = ${addressId}::uuid`;
    if (!row) return [];
    const tokens = [row.pincode];
    if (row.zone) tokens.push(row.zone);
    if (row.is_ncr) tokens.push('NCR');
    return tokens;
  }

  private async facilityCoordinates(
    addressId: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ latitude: string | null; longitude: string | null }>
    >`
      SELECT latitude, longitude FROM identity.org_address WHERE id = ${addressId}::uuid`;
    if (!row?.latitude || !row.longitude) return null;
    // Coordinates, not money: NUMERIC(9,6) that is genuinely a decimal degree.
    return { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  }

  /**
   * Is the site open, on that weekday, across that slot?
   *
   * The weekday is computed by Postgres (`EXTRACT(DOW)`, 0 = Sunday) rather than
   * in JavaScript. `facility_hours.day_of_week` is documented only as 0–6, and a
   * JS `getDay()` on a date string parsed as UTC is a whole class of off-by-one
   * that appears once a week, in one timezone, for one vendor.
   */
  private async assertSiteOpen(
    facilityId: string,
    date: string,
    slotFrom: string,
    slotTo: string,
  ): Promise<void> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        open_time: string | null;
        close_time: string | null;
        is_closed: boolean | null;
        holiday_reason: string | null;
        is_holiday: boolean;
      }>
    >`
      SELECT h.open_time::text  AS open_time,
             h.close_time::text AS close_time,
             h.is_closed,
             d.reason           AS holiday_reason,
             (d.facility_id IS NOT NULL) AS is_holiday
        FROM (SELECT ${facilityId}::uuid AS fid) f
        LEFT JOIN vendor.facility_hours h
               ON h.facility_id = f.fid
              AND h.day_of_week = EXTRACT(DOW FROM ${date}::date)::int
        LEFT JOIN vendor.facility_holiday d
               ON d.facility_id = f.fid
              AND d.holiday_date = ${date}::date`;

    if (row?.is_holiday) {
      throw new PreconditionFailedError(
        `The site is closed on ${date}${row.holiday_reason ? ` (${row.holiday_reason})` : ''}. Pick another day.`,
        { facilityId, date, reason: 'facility_holiday' },
      );
    }
    // No hours row at all means the vendor never published a calendar. That is a
    // gap in their profile, not a closed warehouse, so it does not block —
    // blocking here would make every vendor who skipped an optional onboarding
    // step unschedulable.
    if (!row || (row.is_closed === null && row.open_time === null)) return;
    if (row.is_closed) {
      throw new PreconditionFailedError(`The site is closed on ${date}. Pick another day.`, {
        facilityId,
        date,
        reason: 'facility_closed_that_weekday',
      });
    }
    if (row.open_time && slotFrom < row.open_time) {
      throw new PreconditionFailedError(
        `The site opens at ${row.open_time.slice(0, 5)} on ${date}.`,
        { facilityId, date, opensAt: row.open_time, reason: 'before_opening' },
      );
    }
    if (row.close_time && slotTo > row.close_time) {
      throw new PreconditionFailedError(
        `The site closes at ${row.close_time.slice(0, 5)} on ${date}.`,
        { facilityId, date, closesAt: row.close_time, reason: 'after_closing' },
      );
    }
  }

  private async vendorTier(vendorOrgId: string): Promise<VendorTier> {
    const [row] = await this.prisma.$queryRaw<Array<{ tier: VendorTier | null }>>`
      SELECT tier FROM identity.organization WHERE id = ${vendorOrgId}::uuid`;
    // BRONZE is the column default and the 100%-sampling tier. An org with no
    // tier recorded gets the strictest treatment, not the loosest.
    return row?.tier ?? 'BRONZE';
  }

  /**
   * Whether the vendor actually meets the thresholds their tier's rule demands.
   * Returns the shortfall as a sentence, or `null` when they qualify.
   */
  private async tierShortfall(
    vendorOrgId: string,
    rule: {
      minUnitsInspected: number;
      minPassRate: number | null;
      minGradeAccuracy: number | null;
    },
  ): Promise<string | null> {
    if (
      rule.minUnitsInspected <= 0 &&
      rule.minPassRate === null &&
      rule.minGradeAccuracy === null
    ) {
      return null;
    }

    const quality = await this.repo.findVendorQuality(vendorOrgId);
    const inspected = quality?.unitsInspected ?? 0;
    if (inspected < rule.minUnitsInspected) {
      return `Only ${inspected} units inspected against the ${rule.minUnitsInspected} this tier's sampling requires.`;
    }
    if (rule.minGradeAccuracy !== null) {
      const accuracy = quality?.gradeAccuracyPct;
      if (accuracy === null || accuracy === undefined || accuracy < rule.minGradeAccuracy) {
        return `Grade accuracy ${accuracy ?? 'not yet measured'} is below the ${rule.minGradeAccuracy}% this tier's sampling requires.`;
      }
    }
    if (rule.minPassRate !== null) {
      const passRate = await this.latestPassRate(vendorOrgId);
      if (passRate === null || passRate < rule.minPassRate) {
        return `QC pass rate ${passRate ?? 'not yet measured'} is below the ${rule.minPassRate}% this tier's sampling requires.`;
      }
    }
    return null;
  }

  /** `platform.vendor_scorecard` holds the pass rate; `qc.vendor_quality` does not. */
  private async latestPassRate(vendorOrgId: string): Promise<number | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ qc_pass_rate: string | null }>>`
      SELECT qc_pass_rate FROM platform.vendor_scorecard
       WHERE vendor_org_id = ${vendorOrgId}::uuid
       ORDER BY period_end DESC LIMIT 1`;
    // A percentage, not money.
    return row?.qc_pass_rate === null || row?.qc_pass_rate === undefined
      ? null
      : Number(row.qc_pass_rate);
  }

  /**
   * What the consignment is worth, for `always_full_above_value`.
   *
   * `listing.unit` and `listing.listing` are one schema, so this is a
   * single-schema join and stays inside `no-cross-schema-join`. It is still a
   * read into another module's tables, taken deliberately and for the same
   * reason `listing.submit` reads `vendor.vendor_facility`: a port for one
   * scalar would be more machinery than the seam is worth today. If `listing`
   * ever leaves this process it becomes one call.
   */
  private async consignmentValue(unitIds: readonly string[]): Promise<Money | null> {
    if (unitIds.length === 0) return null;
    const [row] = await this.prisma.$queryRaw<Array<{ total: string | null }>>`
      SELECT COALESCE(SUM(l.unit_price), 0)::text AS total
        FROM listing.unit u
        JOIN listing.listing l ON l.id = u.listing_id
       WHERE u.id = ANY(${[...unitIds]}::text[]::uuid[])`;
    return row?.total ? money(row.total) : null;
  }

  private fullPlan(
    tier: VendorTier,
    pct: number,
    total: number,
    manifest: readonly { unitId: string }[],
    value: Money | null,
    reason: string,
  ): SamplePlan {
    return {
      tier,
      samplePct: pct,
      unitsOnManifest: total,
      unitsToInspect: total,
      unitIds: manifest.map((u) => u.unitId),
      fullInspection: true,
      consignmentValue: value,
      reason,
    };
  }

  /**
   * Which units to inspect, when not all of them.
   *
   * Sorted by `unit_id` — a server-generated random UUID — rather than by
   * `sequence_no`. Sequence order is the order the vendor presented the
   * machines, so sampling the first N is sampling whichever N the vendor put at
   * the front. Sorting on a value the vendor does not choose is deterministic
   * (the same visit re-plans to the same units, which is what makes the plan
   * auditable) without being predictable in advance.
   */
  private sampleUnits(manifest: readonly { unitId: string }[], count: number): string[] {
    return [...manifest]
      .map((u) => u.unitId)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, count);
  }

  /**
   * One `platform_config` integer, through `v_current_config`.
   *
   * Read through the view, never the table: `platform_config` is effective-dated
   * and holds scheduled future rows, so the table would sometimes answer with a
   * threshold that does not apply yet. A missing or malformed key throws rather
   * than falling back to the number in the phase document — ops raising the geo
   * threshold to 800 m and the code still alerting at 500 is a decision that was
   * made, recorded, and quietly ignored.
   */
  private async configInt(key: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${key}`;
    const v = row?.value_json;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new PreconditionFailedError("We can't do that just now. Please try again shortly.", {
        reason: row ? 'malformed_platform_config' : 'missing_platform_config',
        key,
        value: v,
      });
    }
    return v;
  }
}
