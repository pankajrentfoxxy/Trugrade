import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig } from '../../../shared/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { gstStateName } from '../../../shared/india/gst-states';
import {
  AuditService,
  IdentityService,
  OrgPromotionService,
  type AddressPromotion,
  type ContactPromotion,
} from '../../identity';
import { VendorPromotionService } from '../../vendor';
import {
  nested,
  objects,
  str,
  timeOfDay,
  type Draft,
} from '../../../shared/onboarding/draft';
import { DEV_PII_KEY } from './verification.service';

/**
 * Step promotion: where a completed step's answers actually go.
 *
 * `OnboardingService.completeStep(orgId, stepCode, promote)` has always taken a
 * promotion and cleared `draft_json` right after running it. Nothing supplied
 * one, so for 642 drafts "complete" meant "delete": `vendor_capability`,
 * `vendor_facility`, `vendor_profile`, `org_contact` and `gst_profile` were all
 * empty no matter what anyone typed. This is the promotion.
 *
 * **It is a dispatcher, not an implementation.** Each destination table is
 * written by the module that owns it — `identity` writes `organization`,
 * `org_address` and `org_contact`; `vendor` writes the five `vendor.*` tables;
 * only `gst_profile` and `pan_record` are written here, because they are
 * `kyc`'s. What lives here is the ORDER, and the order is forced by the schema:
 * `vendor_facility.address_id` is `NOT NULL`, so identity's addresses must exist
 * and give up their ids before a facility row can be written.
 *
 * **Everything runs inside `completeStep`'s transaction.** `PrismaService`
 * carries the transactional client in async-local storage, so every call below
 * joins it without being handed one. That is what makes a half-finished
 * promotion safe: it rolls back the completion with it, and the applicant still
 * has their draft.
 *
 * **A verified value is read from `verification_check`, never from the draft.**
 * `gst_profile.api_verified_at` is `NOT NULL` and means "the portal told us
 * this". The wizard keeps the outcome in its draft for its own rendering, and a
 * draft is client-supplied — promoting from it would let anyone post a
 * `gst_profile` row claiming a registration we never checked. So the GSTIN is
 * matched against this org's own `verification_check` history by input hash, and
 * a GSTIN with no PASS is left for the reviewer rather than written as verified.
 */

/** Mirrors `VerificationService.hashInput`. The same input must hash the same. */
const hashInput = (value: string): string =>
  createHash('sha256').update(value.toUpperCase().trim()).digest('hex');

/** `RECEIVING_DAYS` on the buyer's delivery step. */
const RECEIVING_DAYS: Readonly<Record<string, string>> = {
  MON_FRI: 'Monday to Friday',
  MON_SAT: 'Monday to Saturday',
  ALL: 'All days, including Sunday',
};

export interface PromotionRequest {
  orgId: string;
  /** The person completing the step. Lands on the agreement acceptance. */
  userId: string;
  stepCode: string;
  answers: Draft;
}

@Injectable()
export class StepPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
    private readonly orgs: OrgPromotionService,
    private readonly vendors: VendorPromotionService,
  ) {}

  /**
   * The step-code table from the build ledger, as code.
   *
   * DOCUMENTS_BANK is deliberately absent: `POST /onboarding/bank-account` has
   * already committed the account, run the penny drop, started the payout freeze
   * and alerted the owner. Re-promoting it here would write a second
   * `bank_account` row and restart the freeze on a step somebody re-completed
   * after a reviewer's note. ACCOUNT and DOCUMENTS have no destination beyond
   * rows their own routes already wrote.
   */
  async promote({ orgId, userId, stepCode, answers }: PromotionRequest): Promise<void> {
    // Kept for every step, promoted or not. It is the only record of what was
    // typed into a step whose answers have no column yet — the CIN, the LLPIN,
    // the brand list — and `draft_json` is about to be cleared. Append-only and
    // redacting PAN and account numbers on the way in.
    await this.audit.record({
      action: 'kyc.onboarding.step_answers',
      entityType: 'onboarding_progress',
      entityId: `${orgId}:${stepCode}`,
      after: answers,
      actorUserId: userId,
      actorOrgId: orgId,
    });

    switch (stepCode) {
      case 'BUSINESS_PROFILE':
        return this.promoteBusinessProfile(orgId, userId, answers);
      case 'STATUTORY':
        return this.promoteStatutory(orgId, answers);
      case 'CONTACTS_ADDRESSES':
        return this.promoteContactsAddresses(orgId, answers);
      case 'CAPABILITY':
        return this.vendors.promoteCapability(orgId, answers);
      case 'FACILITY_CONTACTS':
        return this.promoteFacilityContacts(orgId, answers);
      case 'AGREEMENT':
        return this.vendors.promoteAgreement(orgId, userId, answers);
      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * BUSINESS_PROFILE — `organization` (constitution) and `vendor_profile`.
   *
   * `constitution` is the highest-value field in this whole file. Three rules
   * read it and all three have been inert because nothing has ever written it:
   * the CIN field requirement and the board-resolution requirement both gate on
   * `required_for_constitutions`, and VR-008 refuses a PAN whose fourth
   * character contradicts the declared constitution. None of them was broken —
   * they had no input.
   *
   * The buyer's version of this step asks for no address; the vendor's asks for
   * the registered office and the operating address, and both go on purchase
   * orders. `org_address.contact_name` is `NOT NULL` and this step asks for no
   * contact, so the person named is the one completing the step — a real,
   * verified person at that business rather than a placeholder. When identity
   * has no mobile for them the addresses are left unwritten (they survive in the
   * audit row above) rather than written with an unreachable number.
   */
  private async promoteBusinessProfile(orgId: string, userId: string, draft: Draft): Promise<void> {
    await this.orgs.updateOrgProfile(
      orgId,
      {
        legalName: str(draft, 'legalName'),
        tradeName: str(draft, 'tradeName'),
        constitution: str(draft, 'constitution') || undefined,
        website: str(draft, 'website'),
        yearEstablished: yearOf(draft),
        employeeCountBand: str(draft, 'staffBand') || str(draft, 'employeeBand'),
        annualTurnoverBand: str(draft, 'annualVolume'),
      },
      userId,
    );

    // A no-op for a buyer: their step asks for no business category, and
    // `promoteBusinessProfile` writes nothing without one.
    await this.vendors.promoteBusinessProfile(orgId, draft);

    const user = await this.identity.getUser(userId);
    if (!user.mobile) return;

    const addresses: AddressPromotion[] = [];
    const registered = nested(draft, 'registered');
    if (str(registered, 'line1')) {
      addresses.push({
        ref: 'registered',
        type: 'REGISTERED',
        label: 'Registered office',
        line1: str(registered, 'line1'),
        line2: str(registered, 'line2'),
        city: str(registered, 'city'),
        stateCode: str(registered, 'state'),
        pincode: str(registered, 'pincode'),
        contactName: user.fullName,
        contactMobile: user.mobile,
        isBillingEnabled: true,
        isDefault: true,
      });
    }

    const operating = nested(draft, 'operating');
    const sameAsRegistered = draft.operatingSameAsRegistered === true;
    if (!sameAsRegistered && str(operating, 'line1')) {
      addresses.push({
        ref: 'operating',
        type: 'PICKUP',
        label: 'Operating address',
        line1: str(operating, 'line1'),
        line2: str(operating, 'line2'),
        city: str(operating, 'city'),
        stateCode: str(operating, 'state'),
        pincode: str(operating, 'pincode'),
        contactName: user.fullName,
        contactMobile: user.mobile,
        isPickupEnabled: true,
      });
    }

    if (addresses.length > 0) await this.orgs.upsertAddresses(orgId, addresses);
  }

  // -------------------------------------------------------------------------

  /**
   * STATUTORY — `gst_profile` and `pan_record`, both from verified evidence.
   *
   * A GSTIN the portal never confirmed is not written. That is not caution for
   * its own sake: `gst_profile` is what `sourcing.service` reads to decide a
   * place of supply and therefore whether an order is IGST or CGST+SGST, and a
   * row nobody checked would make that decision on an applicant's typing. The
   * unverified ones are already in `verification_check` with their reason, which
   * is what the reviewer's screen shows.
   */
  private async promoteStatutory(orgId: string, draft: Draft): Promise<void> {
    const rows = objects(draft, 'gstins');
    const primary = str(draft, 'primaryGstin');
    let promoted = 0;

    for (const row of rows) {
      const gstin = str(row, 'gstin').toUpperCase();
      if (gstin.length !== 15) continue;

      const taxpayer = await this.verifiedPayload<{
        legalName?: string;
        tradeName?: string;
        status?: string;
        stateCode?: string;
        taxpayerType?: string;
      }>(orgId, 'GSTIN', gstin);
      if (!taxpayer) continue;

      const stateCode = taxpayer.data.stateCode ?? gstin.slice(0, 2);
      if (!gstStateName(stateCode)) continue;

      await this.prisma.db.gst_profile.upsert({
        where: { org_id_gstin: { org_id: orgId, gstin } },
        create: {
          org_id: orgId,
          gstin,
          legal_name_as_per_gst: taxpayer.data.legalName ?? str(draft, 'legalName'),
          trade_name: taxpayer.data.tradeName ?? null,
          state_code: stateCode,
          status: taxpayer.data.status ?? 'ACTIVE',
          api_verified_at: taxpayer.checkedAt,
          api_response_json: taxpayer.data,
          is_primary: gstin === primary,
        },
        update: {
          legal_name_as_per_gst: taxpayer.data.legalName ?? str(draft, 'legalName'),
          trade_name: taxpayer.data.tradeName ?? null,
          state_code: stateCode,
          status: taxpayer.data.status ?? 'ACTIVE',
          api_verified_at: taxpayer.checkedAt,
          api_response_json: taxpayer.data,
          is_primary: gstin === primary,
        },
      });
      promoted += 1;
    }

    // One primary registration decides the billing entity and the tax split on
    // every invoice, so any registration that lost the flag has to lose it here
    // too — two primaries is a question the invoicing code cannot answer.
    if (promoted > 0 && primary) {
      await this.prisma.db.gst_profile.updateMany({
        where: { org_id: orgId, gstin: { not: primary } },
        data: { is_primary: false },
      });
    }

    await this.promotePan(orgId, draft);
  }

  /**
   * `pan_record`, encrypted at the column.
   *
   * Raw SQL because `pgp_sym_encrypt` has to run inside the database call:
   * reading the key into JS, encrypting there and handing Prisma a Buffer would
   * put the plaintext in a second place for no gain. Same reasoning, and the
   * same key, as the `bank_account` insert in `VerificationService`.
   *
   * `verified` and `api_verified_at` come from the check, so a PAN typed but
   * never confirmed is stored as unverified rather than silently trusted.
   */
  private async promotePan(orgId: string, draft: Draft): Promise<void> {
    const pan = str(draft, 'pan').toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return;

    const holder = await this.verifiedPayload<{ name?: string }>(orgId, 'PAN', pan);
    const key = this.config.get('PII_ENCRYPTION_KEY') ?? DEV_PII_KEY;

    await this.prisma.$executeRaw`
      INSERT INTO kyc.pan_record
        (org_id, pan_enc, pan_last4, pan_hash, name_as_per_pan, verified, api_verified_at)
      VALUES
        (${orgId}::uuid, pgp_sym_encrypt(${pan}, ${key}), ${pan.slice(-4)}, ${hashInput(pan)},
         ${holder?.data.name ?? null}, ${holder !== null}, ${holder?.checkedAt ?? null})
      ON CONFLICT (org_id) DO UPDATE SET
        pan_enc         = EXCLUDED.pan_enc,
        pan_last4       = EXCLUDED.pan_last4,
        pan_hash        = EXCLUDED.pan_hash,
        name_as_per_pan = COALESCE(EXCLUDED.name_as_per_pan, kyc.pan_record.name_as_per_pan),
        verified        = EXCLUDED.verified,
        api_verified_at = COALESCE(EXCLUDED.api_verified_at, kyc.pan_record.api_verified_at)`;
  }

  /** The most recent PASS for this exact input, or null. Never the draft's copy. */
  private async verifiedPayload<T>(
    orgId: string,
    checkType: string,
    input: string,
  ): Promise<{ data: T; checkedAt: Date } | null> {
    const check = await this.prisma.db.verification_check.findFirst({
      where: {
        org_id: orgId,
        check_type: checkType,
        input_hash: hashInput(input),
        status: 'PASS',
      },
      orderBy: { checked_at: 'desc' },
    });
    if (!check) return null;
    return { data: (check.response_summary ?? {}) as T, checkedAt: check.checked_at };
  }

  // -------------------------------------------------------------------------

  /**
   * CONTACTS_ADDRESSES — the buyer's people, billing addresses and docks.
   *
   * A billing address is keyed on the GSTIN it bills, which is exactly how the
   * screen asks for it: one address per registration, because that is what
   * decides the place of supply on the invoice raised against it.
   *
   * The dock's receiving days and hours have no columns — `org_address` has
   * `delivery_instructions` and nothing structured — so they are written into
   * that field as a sentence the driver can read. A failed delivery is a return
   * leg and a second dispatch fee, so dropping the answer is the expensive
   * option. Reported: they want columns.
   */
  private async promoteContactsAddresses(orgId: string, draft: Draft): Promise<void> {
    const contacts = nested(draft, 'contacts');
    const finance = nested(contacts, 'FINANCE');
    const procurement = nested(contacts, 'PROCUREMENT');

    const addresses: AddressPromotion[] = [];

    objects(draft, 'billing').forEach((billing) => {
      const gstin = str(billing, 'gstin').toUpperCase();
      if (!str(billing, 'line1') || !gstin) return;
      // The finance contact receives the tax invoice; procurement is the
      // fallback because a business that named neither cannot be billed at all.
      const person = str(finance, 'fullName') ? finance : procurement;
      if (!str(person, 'fullName') || !str(person, 'mobile')) return;
      addresses.push({
        ref: `billing:${gstin}`,
        type: 'BILLING',
        label: gstin,
        line1: str(billing, 'line1'),
        line2: str(billing, 'line2'),
        city: str(billing, 'city'),
        stateCode: str(billing, 'state') || gstin.slice(0, 2),
        pincode: str(billing, 'pincode'),
        contactName: str(person, 'fullName'),
        contactMobile: str(person, 'mobile'),
        isBillingEnabled: true,
      });
    });

    objects(draft, 'delivery').forEach((delivery, index) => {
      if (!str(delivery, 'line1')) return;
      const label = str(delivery, 'label') || `Delivery address ${index + 1}`;
      addresses.push({
        ref: `delivery:${label}`,
        type: 'SHIPPING',
        label,
        line1: str(delivery, 'line1'),
        line2: str(delivery, 'line2'),
        city: str(delivery, 'city'),
        stateCode: str(delivery, 'state'),
        pincode: str(delivery, 'pincode'),
        contactName: str(delivery, 'contactName'),
        contactMobile: str(delivery, 'contactMobile'),
        landmark: str(delivery, 'landmark') || undefined,
        deliveryInstructions: receivingWindow(delivery) || undefined,
      });
    });

    const addressIds =
      addresses.length > 0 ? await this.orgs.upsertAddresses(orgId, addresses) : {};

    const people: ContactPromotion[] = [];
    for (const [role, value] of Object.entries(contacts)) {
      const person = nested({ p: value }, 'p');
      if (!str(person, 'fullName') || !str(person, 'mobile')) continue;
      people.push({
        contactType: role,
        fullName: str(person, 'fullName'),
        designation: str(person, 'designation'),
        mobile: str(person, 'mobile'),
        email: str(person, 'email'),
        isPrimary: true,
      });
    }

    if (people.length > 0) await this.orgs.upsertContacts(orgId, people, addressIds);
  }

  // -------------------------------------------------------------------------

  /**
   * FACILITY_CONTACTS — identity's addresses first, then vendor's facilities.
   *
   * The two-call shape is the seam, not ceremony. `vendor` plans the rows in
   * `identity`'s vocabulary, `identity` writes them and returns their ids, and
   * `vendor` writes its own tables against those ids. Neither module touches the
   * other's schema, and because both calls run inside `completeStep`'s
   * transaction a failure in the second rolls back the first.
   */
  private async promoteFacilityContacts(orgId: string, draft: Draft): Promise<void> {
    const planned = this.vendors.planFacilityAddresses(draft);
    const addressIds = planned.length > 0 ? await this.orgs.upsertAddresses(orgId, planned) : {};

    const contacts = this.vendors.planFacilityContacts(draft);
    if (contacts.length > 0) await this.orgs.upsertContacts(orgId, contacts, addressIds);

    await this.vendors.promoteFacilities(orgId, draft, addressIds);
  }
}

/** `year_established` is an `INT`; the wizard holds it as typed. */
function yearOf(draft: Draft): number | null {
  const raw = str(draft, 'yearEstablished');
  if (!/^\d{4}$/.test(raw)) return null;
  return Number(raw);
}

/** "Monday to Saturday, 09:00 to 18:00. Ring the bell at gate 2." */
function receivingWindow(delivery: Draft): string {
  const days = RECEIVING_DAYS[str(delivery, 'days')];
  const opens = timeOfDay(str(delivery, 'opensAt')) ? str(delivery, 'opensAt') : null;
  const closes = timeOfDay(str(delivery, 'closesAt')) ? str(delivery, 'closesAt') : null;
  const window =
    days && opens && closes
      ? `${days}, ${opens} to ${closes}.`
      : days
        ? `${days}.`
        : '';
  return [window, str(delivery, 'gateInstructions')].filter(Boolean).join(' ').trim();
}
