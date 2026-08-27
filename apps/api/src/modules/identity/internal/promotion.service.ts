import { Injectable } from '@nestjs/common';
import type {
  address_type as AddressTypeEnum,
  constitution_type as ConstitutionEnum,
} from '@prisma/client';
import { PrismaService } from '../../../shared/db/prisma.service';
import { gstStateName } from '../../../shared/india/gst-states';
import { ValidationError } from '../../../shared/errors/domain-errors';
import { AuditService } from './audit.service';

/**
 * The `identity` half of onboarding step promotion.
 *
 * A completed step's answers have to land in the tables the rest of the product
 * reads, and three of those tables are this module's: `organization`,
 * `org_address` and `org_contact`. `kyc` runs the stepper and owns the
 * transaction; it asks *here* for these three, through the barrel, because a
 * module that writes another module's tables is a module boundary that exists
 * only in the folder names.
 *
 * **`organization.constitution` is the field this whole file is really for.**
 * Three rules read it and all three are inert while it is NULL: the CIN field
 * requirement, the board-resolution requirement, and VR-008's PAN-class check.
 * They are not broken — they have never had an input.
 *
 * **Idempotency is by natural key, and the natural keys are the ones a person
 * would use.** A reviewer sends a step back with `request-fix`, the applicant
 * corrects one field and completes it again; the second promotion must update
 * the row the first one wrote. `org_contact` keys on `(org_id, contact_type)` —
 * one finance contact per business — and `org_address` on `(org_id, type,
 * label)`, the address's own name.
 *
 * ponytail: renaming an address therefore writes a new row and leaves the old
 * one. Correct-but-not-clever: `org_address` is referenced by `listing`,
 * `order`, `shipment` and `vendor_facility` with `ON DELETE NO ACTION`, so the
 * alternative — delete and re-insert — breaks live references. If stale rows
 * ever become a problem the answer is `is_active = FALSE` on the ones a step no
 * longer names, which needs a rule about who is allowed to retire an address.
 */

/** What the ledger's promotion table calls `organization`. Every field optional. */
export interface OrgProfilePatch {
  legalName?: string;
  tradeName?: string;
  /** The `constitution_type` enum. Rejected here rather than at the database. */
  constitution?: string;
  website?: string;
  yearEstablished?: number | null;
  employeeCountBand?: string;
  annualTurnoverBand?: string;
}

export interface AddressPromotion {
  /** The caller's own handle. `upsertAddresses` returns the row id under it. */
  ref: string;
  type: 'REGISTERED' | 'BILLING' | 'SHIPPING' | 'PICKUP';
  /** The idempotency key within `(org_id, type)`, and what a person calls it. */
  label: string;
  line1: string;
  line2?: string;
  city: string;
  /** The GST state code, e.g. "06". The name is derived, never accepted. */
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark?: string;
  deliveryInstructions?: string;
  isPickupEnabled?: boolean;
  isBillingEnabled?: boolean;
  isDefault?: boolean;
}

export interface ContactPromotion {
  /** `org_contact.contact_type`. The CHECK constraint is the closed list. */
  contactType: string;
  fullName: string;
  designation?: string;
  mobile: string;
  alternateMobile?: string;
  email?: string;
  whatsappNumber?: string;
  /** A `ref` from the same `upsertAddresses` call, resolved to an address id. */
  addressRef?: string;
  isPrimary?: boolean;
  preferredLanguage?: string;
  availableFrom?: Date;
  availableTo?: Date;
}

const CONSTITUTIONS: readonly string[] = [
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PVT_LTD',
  'LTD',
  'TRUST',
  'SOCIETY',
  'OTHER',
];

@Injectable()
export class OrgPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Write the answers from a business-profile step onto the organisation.
   *
   * Only keys the caller actually supplies are written. A step that did not ask
   * for a trade name must not blank the one an earlier step recorded, and a
   * patch of `undefined` is Prisma's own way of saying "leave it".
   *
   * The audit row carries the *before* state because `constitution` changes what
   * the applicant is asked for — a reviewer looking at a suddenly-required CIN
   * needs to be able to see when the answer that required it was given.
   */
  async updateOrgProfile(
    orgId: string,
    patch: OrgProfilePatch,
    actorUserId?: string,
  ): Promise<void> {
    const before = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    if (!before) throw new ValidationError('That organisation no longer exists.', { orgId: 'Unknown organisation.' });

    if (patch.constitution !== undefined && !CONSTITUTIONS.includes(patch.constitution)) {
      throw new ValidationError(
        `"${patch.constitution}" is not a constitution we recognise. Choose the one on your registration certificate.`,
        { constitution: 'Choose your business constitution from the list.' },
      );
    }

    await this.prisma.db.organization.update({
      where: { id: orgId },
      data: {
        legal_name: patch.legalName || undefined,
        trade_name: patch.tradeName || undefined,
        constitution: (patch.constitution as ConstitutionEnum | undefined) || undefined,
        website: patch.website || undefined,
        year_established: patch.yearEstablished ?? undefined,
        employee_count_band: patch.employeeCountBand || undefined,
        annual_turnover_band: patch.annualTurnoverBand || undefined,
        updated_at: new Date(),
        updated_by: actorUserId ?? undefined,
      },
    });

    await this.audit.record({
      action: 'identity.organization.profile_promoted',
      entityType: 'organization',
      entityId: orgId,
      before: { constitution: before.constitution, legalName: before.legal_name },
      after: { ...patch },
      actorUserId,
      actorOrgId: orgId,
    });
  }

  /**
   * Upsert addresses by `(org_id, type, label)` and hand back their ids.
   *
   * The ids are what a caller needs: `vendor_facility.address_id` is `NOT NULL`
   * and `UNIQUE`, so the vendor module cannot write a facility until this has
   * run. That ordering is the reason this returns a map instead of nothing.
   *
   * `contact_name` and `contact_mobile` are `NOT NULL` and are refused here
   * rather than defaulted. The column is read as "the person at this address" by
   * the pick-up scheduler and printed on the e-way bill; a placeholder in it is
   * a driver calling a number nobody answers.
   */
  async upsertAddresses(
    orgId: string,
    addresses: readonly AddressPromotion[],
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};

    for (const address of addresses) {
      const state = gstStateName(address.stateCode);
      if (!state) {
        throw new ValidationError(
          `"${address.stateCode}" is not a live GST state code, so we cannot record ${address.label}.`,
          { state: 'Choose the state this address is in.' },
        );
      }
      if (!address.contactName.trim() || !address.contactMobile.trim()) {
        throw new ValidationError(
          `We need a person and a mobile number for ${address.label} — the driver calls them on the day.`,
          { contactName: 'Name someone we can reach at this address.' },
        );
      }

      const data = {
        type: address.type as AddressTypeEnum,
        label: address.label,
        line1: address.line1,
        line2: address.line2 || null,
        city: address.city,
        state,
        state_code: address.stateCode,
        pincode: address.pincode,
        contact_name: address.contactName.trim(),
        contact_mobile: address.contactMobile.trim(),
        landmark: address.landmark || null,
        delivery_instructions: address.deliveryInstructions || null,
        is_pickup_enabled: address.isPickupEnabled ?? false,
        is_billing_enabled: address.isBillingEnabled ?? false,
        is_default: address.isDefault ?? false,
        is_active: true,
      };

      const existing = await this.prisma.db.org_address.findFirst({
        where: { org_id: orgId, type: data.type, label: address.label },
        select: { id: true },
      });

      const row = existing
        ? await this.prisma.db.org_address.update({ where: { id: existing.id }, data })
        : await this.prisma.db.org_address.create({ data: { org_id: orgId, ...data } });

      ids[address.ref] = row.id;
    }

    return ids;
  }

  /**
   * Upsert functional contacts by `(org_id, contact_type)`.
   *
   * One row per role per business, which is what the screens ask for — they hold
   * contacts as a map keyed by role, not as a list. Without that key a
   * `request-fix` round trip leaves two finance contacts and no way to tell
   * which one is current.
   */
  async upsertContacts(
    orgId: string,
    contacts: readonly ContactPromotion[],
    addressIds: Record<string, string> = {},
  ): Promise<void> {
    for (const contact of contacts) {
      if (!contact.fullName.trim() || !contact.mobile.trim()) continue;

      const data = {
        full_name: contact.fullName.trim(),
        designation: contact.designation || null,
        mobile: contact.mobile.trim(),
        alternate_mobile: contact.alternateMobile || null,
        email: contact.email || null,
        whatsapp_number: contact.whatsappNumber || null,
        address_id: contact.addressRef ? (addressIds[contact.addressRef] ?? null) : null,
        is_primary: contact.isPrimary ?? true,
        preferred_language: (contact.preferredLanguage || 'en').toLowerCase(),
        available_from: contact.availableFrom ?? null,
        available_to: contact.availableTo ?? null,
        is_active: true,
      };

      const existing = await this.prisma.db.org_contact.findFirst({
        where: { org_id: orgId, contact_type: contact.contactType },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.db.org_contact.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.db.org_contact.create({
          data: { org_id: orgId, contact_type: contact.contactType, ...data },
        });
      }
    }
  }
}
