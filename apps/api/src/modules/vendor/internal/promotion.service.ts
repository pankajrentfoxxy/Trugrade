import { Injectable } from '@nestjs/common';
import { GRADES, offeredGradesFromMix, type Grade } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ValidationError } from '../../../shared/errors/domain-errors';
import type { AddressPromotion, ContactPromotion } from '../../identity';
import {
  bool,
  decimal,
  dateOnly,
  int,
  nested,
  objects,
  str,
  strings,
  timeOfDay,
  type Draft,
} from '../../../shared/onboarding/draft';

/**
 * The `vendor` half of onboarding step promotion.
 *
 * Four of the seven vendor steps land in this module's tables:
 * `vendor_profile`, `vendor_capability`, `vendor_facility` with its
 * `facility_hours` and `facility_holiday`, and `agreement_acceptance` with
 * `vendor_payout_preference`.
 *
 * **The facility step also needs `identity.org_address` and
 * `identity.org_contact`, and this module does not write them.**
 * `vendor_facility.address_id` is `NOT NULL UNIQUE` and points into another
 * module's schema, so the promotion is deliberately in two halves:
 * `planFacilityAddresses` / `planFacilityContacts` say what identity should
 * write — in identity's own vocabulary — and `promoteFacilities` takes the ids
 * back. `kyc`, which owns the transaction, is what carries them between. A
 * shortcut here would be one `INSERT INTO identity.org_address` and the seam
 * would be gone; the two-step shape is what keeps it a seam.
 *
 * **Idempotency is by the constraints that already exist**, read from the
 * baseline migration rather than assumed: `facility_hours` is unique on
 * `(facility_id, day_of_week)`, `facility_holiday` on `(facility_id,
 * holiday_date)`, `vendor_facility` on `address_id`, `vendor_profile` and
 * `vendor_payout_preference` on `org_id`. `vendor_capability` has none, so its
 * natural key is `(org_id, category)` — the screen asks the same answers across
 * the categories a supplier ticks, so one row per category is what an answer is.
 */

/** Nothing is e-signed. What is recorded is who accepted which version, when. */
const VENDOR_AGREEMENTS: ReadonlyArray<{ code: string; version: string }> = [
  { code: 'VENDOR_AGREEMENT', version: '1.0' },
  { code: 'GRADING_POLICY', version: '1.0' },
  { code: 'DATA_WIPE_UNDERTAKING', version: '1.0' },
  { code: 'RETURNS_POLICY', version: '1.0' },
];

/**
 * `agreement_acceptance.doc_hash` is `NOT NULL` and means "the bytes they were
 * shown". There is no document store and no e-sign adapter — `AADHAAR_ESIGN` is
 * a string in a union with nothing behind it — so there are no bytes to hash.
 *
 * This sentinel goes in rather than a plausible-looking SHA-256, because the
 * column's whole purpose is evidence and a fabricated hash is evidence of
 * something that did not happen. It is legible to the reviewer who reads it.
 * When the agreements are served from somewhere, hash what is served.
 */
const NO_DOCUMENT_HASH = 'unhashed:no-document-store';

/** `vendor_facility.facility_type`, verbatim from its CHECK constraint. */
const FACILITY_TYPES: readonly string[] = ['WAREHOUSE', 'OFFICE', 'REFURB_UNIT', 'RETAIL'];
/** TRUCK is legacy in the DB; registration no longer offers it. */
const VEHICLE_ACCESS: readonly string[] = ['TEMPO', 'BIKE_ONLY'];
const SUPPLY_CATEGORIES: readonly string[] = [
  'BUSINESS_LAPTOP',
  'CONSUMER',
  'MACBOOK',
  'CHROMEBOOK',
];
const BUSINESS_CATEGORIES: readonly string[] = [
  'REFURBISHER',
  'DEALER',
  'ITAD',
  'CORPORATE_LIQUIDATOR',
  'OEM_PARTNER',
  'LEASING',
  'TRADER',
];
const PAYOUT_CYCLES: readonly string[] = ['WEEKLY', 'T_PLUS_2', 'MONTHLY'];

/**
 * Presence flags for `typical_grade_mix`. The screen now ticks grades rather
 * than splitting 100%; older drafts still have a percentage object, and both
 * mean "this vendor supplies these grades".
 */
function offeredGradeFlags(draft: Draft): Record<string, number> {
  const selected = strings(draft, 'grades').filter((g): g is Grade =>
    (GRADES as readonly string[]).includes(g),
  );
  const codes = selected.length > 0 ? selected : offeredGradesFromMix(nested(draft, 'gradeMix'));
  return Object.fromEntries(codes.map((g) => [g, 1]));
}

/** The whole of one facility as the wizard saved it, before anything is written. */
interface PlannedFacility {
  ref: string;
  label: string;
  facilityType: string;
  vehicleAccess: string;
  dispatchSameAsFacility: boolean;
  /** Present only when the dispatch address is a different building. */
  dispatchRef: string | null;
  storageCapacityUnits: number | null;
  hasLoadingDock: boolean;
  liftAvailable: boolean;
  testingStations: number | null;
  specialInstructions: string | null;
  /** The postal fields as the wizard saved them. Identity turns them into rows. */
  address: Draft;
  dispatchAddress: Draft;
  hours: Array<{ day: number; closed: boolean; open: Date | null; close: Date | null }>;
  holidays: Array<{ date: Date; reason: string | null }>;
}

@Injectable()
export class VendorPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  // -------------------------------------------------------------------------
  // BUSINESS_PROFILE — the vendor half. `organization` is identity's.
  // -------------------------------------------------------------------------

  /**
   * `business_category` is `NOT NULL` with no default and no sensible one: the
   * five values decide how a supplier is described to a reviewer and none of
   * them is "we did not ask". So an unanswered category writes no row at all
   * rather than a row asserting one. The answers stay in the step's audit entry
   * and the applicant is asked again when a reviewer sends the step back.
   */
  async promoteBusinessProfile(orgId: string, draft: Draft): Promise<void> {
    const category = str(draft, 'category');
    if (!category) return;
    if (!BUSINESS_CATEGORIES.includes(category)) {
      throw new ValidationError(
        `"${category}" is not one of the business types we can record. Choose the one that best describes you.`,
        { category: 'Choose what best describes your business.' },
      );
    }

    const incorporation = dateOnly(str(draft, 'incorporationDate'));

    await this.prisma.db.vendor_profile.upsert({
      where: { org_id: orgId },
      create: {
        org_id: orgId,
        business_category: category,
        incorporation_date: incorporation,
      },
      update: {
        business_category: category,
        // An absent date must not blank one an earlier completion recorded:
        // a proprietorship is never asked for it, and the field requirement
        // that asks is on a different step.
        incorporation_date: incorporation ?? undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // CAPABILITY — one row per category the supplier ticked
  // -------------------------------------------------------------------------

  /**
   * `can_dropship` and `can_provide_serials_upfront` are no longer asked on the
   * screen; the column defaults (`TRUE`) apply when the draft omits them.
   *
   * Categories the supplier removed are deactivated rather than deleted:
   * `ix_vcap_routing` is partial on `is_active`, so a deactivated row stops
   * routing enquiries immediately, and the history of what they once offered is
   * worth keeping.
   */
  async promoteCapability(orgId: string, draft: Draft): Promise<void> {
    const categories = strings(draft, 'categories').filter((c) => SUPPLY_CATEGORIES.includes(c));
    const gradeMix = offeredGradeFlags(draft);
    const canProvideSerials = bool(draft, 'canProvideSerialsUpfront') ?? true;
    const channels = strings(draft, 'sourcingChannels');
    const monthlyCapacity = int(draft, 'monthlyCapacity');

    if (categories.length === 0) {
      // Categories are optional on the screen. Routing stops, but the grade
      // ticks still have to land somewhere the listing wizard can read them.
      await this.prisma.db.vendor_capability.updateMany({
        where: { org_id: orgId },
        data: {
          is_active: false,
          ...(Object.keys(gradeMix).length > 0 ? { typical_grade_mix: gradeMix } : {}),
        },
      });
      if (Object.keys(gradeMix).length > 0) {
        const existing = await this.prisma.db.vendor_capability.findFirst({
          where: { org_id: orgId },
          select: { id: true },
        });
        if (!existing) {
          await this.prisma.db.vendor_capability.create({
            data: {
              org_id: orgId,
              category: 'BUSINESS_LAPTOP',
              typical_grade_mix: gradeMix,
              sourcing_channels: channels,
              can_provide_serials_upfront: canProvideSerials,
              has_inhouse_testing: draft.hasInhouseTesting === true,
              has_inhouse_repair: draft.hasInhouseRepair === true,
              lead_time_days: int(draft, 'leadTimeDays') ?? 24,
              monthly_capacity_units: monthlyCapacity ?? 0,
              is_active: false,
            },
          });
        }
      }
      return;
    }

    const shared = {
      ...(monthlyCapacity != null ? { monthly_capacity_units: monthlyCapacity } : {}),
      typical_grade_mix: Object.keys(gradeMix).length > 0 ? gradeMix : undefined,
      sourcing_channels: channels,
      can_provide_serials_upfront: canProvideSerials,
      has_inhouse_testing: draft.hasInhouseTesting === true,
      has_inhouse_repair: draft.hasInhouseRepair === true,
      lead_time_days: int(draft, 'leadTimeDays') ?? 24,
      is_active: true,
    };

    for (const category of categories) {
      // ponytail: `brand_id` stays NULL — "this category, any brand". The screen
      // asks for brands as a flat list with ONE capacity across all of them, so
      // a row per brand would invent a per-brand capacity nobody stated. The
      // brand answer has no column that can hold it as asked; recorded in the
      // step's audit entry and reported.
      const existing = await this.prisma.db.vendor_capability.findFirst({
        where: { org_id: orgId, category, brand_id: null },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.db.vendor_capability.update({ where: { id: existing.id }, data: shared });
      } else {
        await this.prisma.db.vendor_capability.create({
          data: {
            org_id: orgId,
            category,
            ...shared,
            monthly_capacity_units: monthlyCapacity ?? 0,
          },
        });
      }
    }

    await this.prisma.db.vendor_capability.updateMany({
      where: { org_id: orgId, category: { notIn: categories } },
      data: { is_active: false },
    });
  }

  // -------------------------------------------------------------------------
  // FACILITY_CONTACTS — planned here, written half here and half by identity
  // -------------------------------------------------------------------------

  /**
   * The addresses this step needs identity to write, in identity's vocabulary.
   *
   * Pure: it reads the draft and returns rows to be created. Nothing is written
   * until `kyc` has passed these to `identity` and handed the ids back to
   * `promoteFacilities`, which is the ordering `vendor_facility.address_id NOT
   * NULL` forces on us anyway.
   *
   * **`org_address.contact_name` is `NOT NULL` and this step never asks for one
   * per facility** — deliberately, because asking twice on one screen is how two
   * answers to one question reach the database. The person it wants is the
   * warehouse contact captured on the same screen, and the operations contact
   * when there is no warehouse one. When neither has been given the promotion
   * refuses and says so, rather than writing a placeholder into a column the
   * pick-up scheduler reads as a person to call.
   */
  planFacilityAddresses(draft: Draft): AddressPromotion[] {
    const facilities = this.readFacilities(draft);
    // Resolved only once there is an address to name someone on. A step whose
    // facilities are all still blank has nothing to refuse over.
    if (facilities.length === 0) return [];

    const contact = this.warehouseContact(draft);
    const planned: AddressPromotion[] = [];

    for (const facility of facilities) {
      const address = facility.address;
      planned.push({
        ref: facility.ref,
        type: 'PICKUP',
        label: facility.label,
        line1: str(address, 'line1'),
        line2: str(address, 'line2'),
        city: str(address, 'city'),
        stateCode: str(address, 'state'),
        pincode: str(address, 'pincode'),
        contactName: contact.fullName,
        contactMobile: contact.mobile,
        deliveryInstructions: facility.specialInstructions ?? undefined,
        isPickupEnabled: true,
      });

      if (facility.dispatchRef) {
        const dispatch = facility.dispatchAddress;
        planned.push({
          ref: facility.dispatchRef,
          type: 'PICKUP',
          // Its own label so it is its own row: this address becomes "Dispatch
          // From" on every e-way bill the vendor's goods travel under, and a
          // consignment whose e-way bill names the wrong origin can be detained
          // with a penalty against the invoice value.
          label: `${facility.label} — dispatch`,
          line1: str(dispatch, 'line1'),
          line2: str(dispatch, 'line2'),
          city: str(dispatch, 'city'),
          stateCode: str(dispatch, 'state'),
          pincode: str(dispatch, 'pincode'),
          contactName: contact.fullName,
          contactMobile: contact.mobile,
          isPickupEnabled: true,
        });
      }
    }

    return planned;
  }

  /** The four functional contacts, in identity's vocabulary. */
  planFacilityContacts(draft: Draft): ContactPromotion[] {
    const contacts = nested(draft, 'contacts');
    const planned: ContactPromotion[] = [];

    for (const [role, value] of Object.entries(contacts)) {
      const person = nested({ person: value }, 'person');
      const fullName = str(person, 'fullName');
      const mobile = str(person, 'mobile');
      if (!fullName || !mobile) continue;

      planned.push({
        contactType: role,
        fullName,
        designation: str(person, 'designation'),
        mobile,
        email: str(person, 'email'),
        whatsappNumber: str(person, 'whatsapp'),
        preferredLanguage: str(person, 'language'),
        isPrimary: true,
      });
    }

    return planned;
  }

  /**
   * The facilities themselves, once identity has given the addresses ids.
   *
   * `dispatch_address_id` NULL means "the facility's own address" — a
   * normalisation whose fallback every consumer has to remember. The screen asks
   * the question with nothing pre-selected, so by the time a step is completed
   * the answer is real; an unanswered one is refused here rather than written as
   * NULL, which would be indistinguishable from "same" for the rest of time.
   */
  async promoteFacilities(
    orgId: string,
    draft: Draft,
    addressIds: Record<string, string>,
  ): Promise<void> {
    for (const facility of this.readFacilities(draft)) {
      const addressId = addressIds[facility.ref];
      if (!addressId) continue;

      const dispatchAddressId = facility.dispatchRef
        ? (addressIds[facility.dispatchRef] ?? null)
        : null;

      const data = {
        facility_type: facility.facilityType,
        storage_capacity_units: facility.storageCapacityUnits,
        has_loading_dock: facility.hasLoadingDock,
        vehicle_access: facility.vehicleAccess,
        lift_available: facility.liftAvailable,
        testing_stations: facility.testingStations,
        is_pickup_enabled: true,
        special_instructions: facility.specialInstructions,
        dispatch_address_id: dispatchAddressId,
      };

      const row = await this.prisma.db.vendor_facility.upsert({
        where: { address_id: addressId },
        create: { org_id: orgId, address_id: addressId, ...data },
        update: data,
      });

      for (const hours of facility.hours) {
        await this.prisma.db.facility_hours.upsert({
          where: { facility_id_day_of_week: { facility_id: row.id, day_of_week: hours.day } },
          create: {
            facility_id: row.id,
            day_of_week: hours.day,
            open_time: hours.open,
            close_time: hours.close,
            is_closed: hours.closed,
          },
          update: { open_time: hours.open, close_time: hours.close, is_closed: hours.closed },
        });
      }

      // Holidays are the one set here that is safe to prune: nothing references
      // `facility_holiday`, and a holiday the supplier removed is a day they
      // now expect us to collect on.
      await this.prisma.db.facility_holiday.deleteMany({
        where: {
          facility_id: row.id,
          holiday_date: { notIn: facility.holidays.map((h) => h.date) },
        },
      });
      for (const holiday of facility.holidays) {
        await this.prisma.db.facility_holiday.upsert({
          where: {
            facility_id_holiday_date: { facility_id: row.id, holiday_date: holiday.date },
          },
          create: { facility_id: row.id, holiday_date: holiday.date, reason: holiday.reason },
          update: { reason: holiday.reason },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // AGREEMENT
  // -------------------------------------------------------------------------

  /**
   * Record the acceptances and the payout preference.
   *
   * An acceptance is an event, so the key is `(org_id, agreement_code, version)`
   * and a repeat of the same version updates the existing row rather than
   * stacking a second one — otherwise a `request-fix` round trip reads as a
   * supplier who accepted the same document twice. A *new* version is a new row,
   * which is what the column is for.
   */
  async promoteAgreement(orgId: string, userId: string, draft: Draft): Promise<void> {
    const accepted = nested(draft, 'accepted');
    const now = this.clock.now();

    for (const agreement of VENDOR_AGREEMENTS) {
      if (accepted[agreement.code] !== true) continue;

      const existing = await this.prisma.db.agreement_acceptance.findFirst({
        where: { org_id: orgId, agreement_code: agreement.code, version: agreement.version },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.db.agreement_acceptance.update({
          where: { id: existing.id },
          data: { user_id: userId, accepted_at: now },
        });
      } else {
        await this.prisma.db.agreement_acceptance.create({
          data: {
            org_id: orgId,
            user_id: userId,
            agreement_code: agreement.code,
            version: agreement.version,
            doc_hash: NO_DOCUMENT_HASH,
            accepted_at: now,
          },
        });
      }
    }

    const pricingMode = str(draft, 'pricingMode');
    const requestedCycle = str(draft, 'payoutCycle');
    const invoiceUpload = bool(draft, 'invoiceUploadRequired');

    if (!pricingMode && !requestedCycle && invoiceUpload === null) return;

    if (pricingMode && pricingMode !== 'NET_PAYOUT' && pricingMode !== 'COMMISSION') {
      throw new ValidationError(
        `"${pricingMode}" is not a payout basis we support. Choose whether you name the amount you want or the sale price and a rate.`,
        { pricingMode: 'Choose how you want to be paid.' },
      );
    }
    if (requestedCycle && !PAYOUT_CYCLES.includes(requestedCycle)) {
      throw new ValidationError(
        `"${requestedCycle}" is not a payout cycle we run.`,
        { payoutCycle: 'Choose a payout cycle.' },
      );
    }

    // The cycle is a REQUEST, and `vendor_payout_preference` is where a request
    // lives. What a supplier is actually paid on is `vendor_profile
    // .settlement_cycle`, which stays WEEKLY until it is earned — Q6 grants T+2
    // by tier and every applicant here is brand new. Writing the request into
    // the granted column would be a promise we break in three weeks.
    const preference = {
      preferred_cycle: requestedCycle || 'WEEKLY',
      invoice_upload_required: invoiceUpload ?? false,
      pricing_mode: pricingMode || 'NET_PAYOUT',
    };

    await this.prisma.db.vendor_payout_preference.upsert({
      where: { org_id: orgId },
      create: { org_id: orgId, ...preference },
      update: preference,
    });

    // COMMISSION means "I name the sale price and a rate", so the rate is the
    // negotiated one for this vendor — which is the column `reviewCaptures`
    // reads back as `agreedCommissionPct`.
    const commissionRate = decimal(draft, 'commissionRate');
    if (pricingMode === 'COMMISSION' && commissionRate !== null) {
      await this.prisma.db.vendor_profile.updateMany({
        where: { org_id: orgId },
        data: { commission_rate_override: commissionRate },
      });
    }
  }

  // -------------------------------------------------------------------------

  /**
   * The facilities, validated against what the columns will accept.
   *
   * A facility with neither a name nor a first line is the empty row the wizard
   * always renders, and is skipped. One that is partly filled is refused with
   * the reason, because a half-written facility is a pick-up address that
   * silently does not work.
   */
  private readFacilities(draft: Draft): PlannedFacility[] {
    const planned: PlannedFacility[] = [];

    objects(draft, 'facilities').forEach((raw, index) => {
      const label = str(raw, 'label');
      const address = nested(raw, 'address');
      if (!label && !str(address, 'line1')) return;

      if (!label) {
        throw new ValidationError(
          `Give facility ${index + 1} a name — "Gurugram warehouse" — so your team and ours mean the same building.`,
          { label: 'Name this site.' },
        );
      }

      const facilityType = str(raw, 'facilityType');
      if (!FACILITY_TYPES.includes(facilityType)) {
        throw new ValidationError(
          `Tell us what ${label} is — a warehouse, a refurbishment unit, an office or a retail counter.`,
          { facilityType: 'Choose what this site is.' },
        );
      }

      const vehicleAccess = str(raw, 'vehicleAccess');
      if (!VEHICLE_ACCESS.includes(vehicleAccess)) {
        throw new ValidationError(
          `Tell us the largest vehicle that can reach the door at ${label}. We send a vehicle down lanes it cannot reverse out of otherwise.`,
          { vehicleAccess: 'Choose the largest vehicle that can reach the loading point.' },
        );
      }

      const dispatchSame = bool(raw, 'dispatchSameAsFacility');
      if (dispatchSame === null) {
        throw new ValidationError(
          `Say whether goods leave ${label} from that same address. It becomes "Dispatch From" on every e-way bill, and a consignment whose e-way bill names the wrong origin can be detained.`,
          { dispatchSameAsFacility: 'Answer yes or no — we will not assume it.' },
        );
      }

      const hours: PlannedFacility['hours'] = [];
      const rawHours = nested(raw, 'hours');
      for (const [day, value] of Object.entries(rawHours)) {
        const dayOfWeek = Number(day);
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;
        const window = nested({ w: value }, 'w');
        const closed = window.closed === true;
        const open = closed ? null : timeOfDay(str(window, 'opensAt'));
        const close = closed ? null : timeOfDay(str(window, 'closesAt'));
        if (!closed && (!open || !close)) continue;
        hours.push({ day: dayOfWeek, closed, open, close });
      }

      const holidays: PlannedFacility['holidays'] = [];
      for (const holiday of objects(raw, 'holidays')) {
        const date = dateOnly(str(holiday, 'date'));
        if (date) holidays.push({ date, reason: str(holiday, 'reason') || null });
      }

      planned.push({
        ref: `facility:${label}`,
        label,
        facilityType,
        vehicleAccess,
        dispatchSameAsFacility: dispatchSame,
        dispatchRef: dispatchSame ? null : `dispatch:${label}`,
        storageCapacityUnits: int(raw, 'storageCapacityUnits'),
        hasLoadingDock: raw.hasLoadingDock === true,
        liftAvailable: raw.liftAvailable === true,
        testingStations: int(raw, 'testingStations'),
        specialInstructions: str(raw, 'specialInstructions') || null,
        address,
        dispatchAddress: nested(raw, 'dispatchAddress'),
        hours,
        holidays,
      });
    });

    return planned;
  }

  /** The warehouse contact, or operations when there is no warehouse one. */
  private warehouseContact(draft: Draft): { fullName: string; mobile: string } {
    const contacts = nested(draft, 'contacts');
    for (const role of ['WAREHOUSE', 'LOGISTICS']) {
      const person = nested(contacts, role);
      const fullName = str(person, 'fullName');
      const mobile = str(person, 'mobile');
      if (fullName && mobile) return { fullName, mobile };
    }
    throw new ValidationError(
      'We need a warehouse or operations contact before we can record your sites. That person is who the driver calls on the day of collection, and every address has to name one.',
      {
        'contacts.LOGISTICS.fullName':
          'Give us the person who hands stock to the carrier, and their mobile.',
      },
    );
  }
}
