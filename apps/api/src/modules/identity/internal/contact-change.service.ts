import { Injectable, Logger } from '@nestjs/common';
import { normaliseEmail, normaliseMobile } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { AppConfig } from '../../../shared/config';
import { RequestContextService } from '../../../shared/db/org-scope';
import { NotificationPort } from '../../../shared/adapters/ports';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { OtpService } from './otp.service';
import { AuditService, maskValue } from './audit.service';

/**
 * Changing the registered email or mobile.
 *
 * This is the first move in almost every account takeover, so it is deliberately
 * not an UPDATE on `user_account`. Two OTPs must land, and they prove two
 * *different* things:
 *
 *   - the code to the **new** address proves that address exists and is
 *     reachable, so an account cannot be walked into a typo'd or hostile inbox;
 *   - the code to the **old** address proves the person driving the change still
 *     controls the account *today*. Someone who has stolen a live session already
 *     has everything they need to pass the new-address half on their own — the
 *     old-address half is the only one they cannot forge, and dropping it is the
 *     classic hole.
 *
 * The old address is told the outcome whichever way it goes, and that message
 * goes out `isTransactional` — a security alert is not a marketing preference,
 * and the person making the change has no way to switch it off. `notified_old_at`
 * records that it actually went: if the provider fails it stays null rather than
 * claiming an alert that never arrived.
 *
 * A pending request is inert. It holds no lock on the account and does not block
 * signing in with the current address, so an attacker cannot open one as a
 * denial-of-service against the real owner.
 */

/** Free-form per `NotificationPort`; the bodies live with the provider. */
const OTP_TEMPLATE_OLD = 'AUTH_CONTACT_CHANGE_OTP_OLD';
const OTP_TEMPLATE_NEW = 'AUTH_CONTACT_CHANGE_OTP_NEW';
const ALERT_TEMPLATE = 'AUTH_CONTACT_CHANGE_ALERT';

/**
 * How long the whole two-code exercise stays open. Longer than one OTP's own
 * five-minute life on purpose — the flow legitimately spans two codes and a
 * resend — but short enough that a request abandoned on a shared machine is not
 * still completable an hour later.
 */
const REQUEST_TTL_SECONDS = 900;

export type ContactField = 'EMAIL' | 'MOBILE';
export type ContactChangeSide = 'OLD' | 'NEW';

export interface ContactChangeView {
  requestId: string;
  field: ContactField;
  /**
   * Masked both ways. This response describes an account to whoever holds the
   * session, and a half-hijacked session must not learn either address in full.
   */
  oldValueMasked: string;
  newValueMasked: string;
  oldVerified: boolean;
  newVerified: boolean;
  status: string;
  expiresAt: Date;
  completed: boolean;
  /** Only outside production, so an E2E test does not need a mail-server scrape. */
  devCodes?: { old?: string; new?: string };
}

/** The columns every helper below reads. Narrower than the Prisma row on purpose. */
type ChangeRow = {
  id: string;
  user_id: string;
  field: string;
  old_value_masked: string;
  new_value: string;
  otp_old_verified_at: Date | null;
  otp_new_verified_at: Date | null;
  status: string;
  created_at: Date;
};

@Injectable()
export class ContactChangeService {
  private readonly logger = new Logger(ContactChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly ctx: RequestContextService,
    private readonly notifications: NotificationPort,
    private readonly config: AppConfig,
  ) {}

  /**
   * Open a request and send both codes.
   *
   * The old address is sent its code **first**, and that ordering is the point:
   * if the new address turns out to be unroutable or rate-limited and this throws
   * half way, the real owner has still been told that somebody tried. The
   * abandoned PENDING row expires on its own and the next attempt supersedes it.
   */
  async request(
    userId: string,
    input: { field: ContactField; newValue: string },
  ): Promise<ContactChangeView> {
    const user = await this.prisma.db.user_account.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('user');

    const { field } = input;
    const current = field === 'EMAIL' ? user.email : user.mobile;
    if (!current) {
      // There is nowhere to send the old-address code, so the takeover check
      // cannot be performed at all. Adding a first contact detail is a different
      // flow with a different authorisation — not this one with a step skipped.
      throw new PreconditionFailedError(
        field === 'EMAIL'
          ? 'This account has no email address on file yet, so we cannot verify the change from it. Ask your organisation owner to add one.'
          : 'This account has no mobile number on file yet, so we cannot verify the change from it. Ask your organisation owner to add one.',
      );
    }

    // Normalised again even though the DTO already did it: this service is also
    // called directly, and both the comparison below and the uniqueness check are
    // only honest against the same canonical form the column stores.
    const newValue =
      field === 'EMAIL' ? normaliseEmail(input.newValue) : normaliseMobile(input.newValue);
    if (!newValue) {
      throw new ValidationError(
        field === 'EMAIL'
          ? 'That does not look like an email address we can send to.'
          : 'That does not look like a mobile number we can send to.',
      );
    }
    if (newValue.toLowerCase() === current.toLowerCase()) {
      throw new ValidationError('That is already the address on this account.');
    }
    await this.assertNotTaken(field, newValue);

    const now = this.clock.now();
    const context = this.ctx.get();

    // One live request at a time. Two open requests means two live old-address
    // codes, which doubles the guess surface for no benefit and lets a confused
    // user complete the wrong one.
    const superseded = await this.prisma.db.contact_change_request.updateMany({
      where: { user_id: userId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (superseded.count > 0) {
      await this.audit.record({
        action: 'identity.contact_change.superseded',
        entityType: 'user_account',
        entityId: userId,
        after: { count: superseded.count, reason: 'A newer request replaced it.' },
        actorUserId: userId,
        actorOrgId: user.org_id,
      });
    }

    const row = await this.prisma.db.contact_change_request.create({
      data: {
        user_id: userId,
        field,
        old_value_masked: maskValue(current),
        new_value: newValue,
        status: 'PENDING',
        ip: context?.ip ?? null,
        user_agent: context?.userAgent ?? null,
        created_at: now,
      },
    });

    const channel = field === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
    const oldCode = await this.otp.issue({
      target: current,
      purpose: 'CONTACT_CHANGE_OLD',
      channel,
      templateCode: OTP_TEMPLATE_OLD,
      refType: 'contact_change_request',
      refId: row.id,
      isProduction: this.config.isProduction,
      variables: { name: user.full_name, newValue: maskValue(newValue) },
    });
    const newCode = await this.otp.issue({
      target: newValue,
      purpose: 'CONTACT_CHANGE_NEW',
      channel,
      templateCode: OTP_TEMPLATE_NEW,
      refType: 'contact_change_request',
      refId: row.id,
      isProduction: this.config.isProduction,
      variables: { name: user.full_name },
    });

    await this.audit.record({
      action: 'identity.contact_change.requested',
      entityType: 'contact_change_request',
      entityId: row.id,
      before: { field, value: row.old_value_masked },
      after: { field, value: maskValue(newValue) },
      actorUserId: userId,
      actorOrgId: user.org_id,
    });

    return this.view(row, { old: oldCode.devCode, new: newCode.devCode });
  }

  /**
   * Verify one half. The change commits only once both halves are stamped —
   * either code presented alone leaves the account exactly as it was.
   */
  async verify(
    userId: string,
    requestId: string,
    side: ContactChangeSide,
    code: string,
  ): Promise<ContactChangeView> {
    // Scoped by user_id as well as id: a request id is not a capability, and a
    // leaked one must not let anyone drive somebody else's change.
    const row = await this.prisma.db.contact_change_request.findFirst({
      where: { id: requestId, user_id: userId },
    });
    if (!row) throw new NotFoundError('contact change request');
    if (row.status !== 'PENDING') {
      throw new PreconditionFailedError(
        `This request is ${row.status.toLowerCase()}. Start a new one to change your ${row.field.toLowerCase()}.`,
      );
    }

    const now = this.clock.now();
    if (this.expiryOf(row.created_at).getTime() <= now.getTime()) {
      await this.terminate(row, 'EXPIRED', 'The request was not completed in time.');
      throw new PreconditionFailedError(
        'This request has expired. Start a new one to change your contact details.',
      );
    }

    const user = await this.prisma.db.user_account.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('user');
    const current = row.field === 'EMAIL' ? user.email : user.mobile;
    const target = side === 'OLD' ? current : row.new_value;
    if (!target) throw new NotFoundError('contact change request');

    try {
      await this.otp.verify({
        target,
        // Scope-bound: the code the old address received cannot be replayed as
        // the new address's half, which is what keeps the two proofs separate.
        purpose: side === 'OLD' ? 'CONTACT_CHANGE_OLD' : 'CONTACT_CHANGE_NEW',
        code,
      });
    } catch (e) {
      // A wrong guess here is a takeover signal, not a typo to shrug at, so it
      // goes on the trail even though the request has not changed state.
      await this.audit.record({
        action: 'identity.contact_change.otp_failed',
        entityType: 'contact_change_request',
        entityId: row.id,
        after: { side, reason: (e as Error).message },
        actorUserId: userId,
        actorOrgId: user.org_id,
      });
      throw e;
    }

    const updated = await this.prisma.db.contact_change_request.update({
      where: { id: row.id },
      data: side === 'OLD' ? { otp_old_verified_at: now } : { otp_new_verified_at: now },
    });

    await this.audit.record({
      action: 'identity.contact_change.otp_verified',
      entityType: 'contact_change_request',
      entityId: row.id,
      after: { side },
      actorUserId: userId,
      actorOrgId: user.org_id,
    });

    if (!updated.otp_old_verified_at || !updated.otp_new_verified_at) {
      return this.view(updated);
    }
    return this.view(await this.complete(updated, user.org_id));
  }

  /** Abandon a request. The old address is told, the same as on success. */
  async cancel(userId: string, requestId: string, reason: string): Promise<ContactChangeView> {
    const row = await this.prisma.db.contact_change_request.findFirst({
      where: { id: requestId, user_id: userId },
    });
    if (!row) throw new NotFoundError('contact change request');
    if (row.status !== 'PENDING') return this.view(row);
    return this.view(await this.terminate(row, 'CANCELLED', reason));
  }

  // -------------------------------------------------------------------------

  /**
   * Both proofs are in. The account column and the request's own state move in
   * one transaction, because a `user_account` carrying a new address while its
   * request still reads PENDING is a row nobody can explain afterwards.
   */
  private async complete(row: ChangeRow, orgId: string): Promise<ChangeRow> {
    const now = this.clock.now();
    const user = await this.prisma.db.user_account.findUnique({ where: { id: row.user_id } });
    const previous = (row.field === 'EMAIL' ? user?.email : user?.mobile) ?? null;

    const updated = await this.prisma.runInTransaction(async () => {
      await this.prisma.db.user_account.update({
        where: { id: row.user_id },
        data:
          row.field === 'EMAIL'
            ? { email: row.new_value, email_verified_at: now, updated_at: now }
            : { mobile: row.new_value, mobile_verified_at: now, updated_at: now },
      });
      return this.prisma.db.contact_change_request.update({
        where: { id: row.id },
        data: { status: 'COMPLETED', completed_at: now },
      });
    });

    await this.audit.record({
      action: 'identity.contact_change.completed',
      entityType: 'contact_change_request',
      entityId: row.id,
      before: { field: row.field, value: row.old_value_masked },
      after: { field: row.field, value: maskValue(row.new_value) },
      actorUserId: row.user_id,
      actorOrgId: orgId,
    });

    // After the commit, and to the address the account has just moved away from:
    // this is the message that lets a real owner say "that was not me" while
    // there is still something to be done about it.
    return this.notifyOld(updated, previous, 'COMPLETED');
  }

  /** Every terminal transition that is not a success, in one place. */
  private async terminate(
    row: ChangeRow,
    status: 'EXPIRED' | 'CANCELLED',
    reason: string,
  ): Promise<ChangeRow> {
    const updated = await this.prisma.db.contact_change_request.update({
      where: { id: row.id },
      data: { status },
    });
    await this.audit.record({
      action: `identity.contact_change.${status.toLowerCase()}`,
      entityType: 'contact_change_request',
      entityId: row.id,
      after: { status, reason },
      actorUserId: row.user_id,
    });
    // Nothing moved, so the account's current value is still the old one.
    const user = await this.prisma.db.user_account.findUnique({ where: { id: row.user_id } });
    const current = (row.field === 'EMAIL' ? user?.email : user?.mobile) ?? null;
    return this.notifyOld(updated, current, status);
  }

  /**
   * Tell the old address what happened.
   *
   * `isTransactional` so no preference can silence it, and swallowed on failure
   * for the same reason the audit write is: a provider outage must not undo a
   * change the user legitimately made. `notified_old_at` is stamped only on a
   * send the provider accepted, so a null there is evidence the alert did not go
   * out rather than an assumption that it did.
   */
  private async notifyOld(
    row: ChangeRow,
    oldAddress: string | null,
    outcome: string,
  ): Promise<ChangeRow> {
    if (!oldAddress) return row;
    try {
      const receipt = await this.notifications.send({
        channel: row.field === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
        to: oldAddress,
        templateCode: ALERT_TEMPLATE,
        locale: 'en',
        variables: {
          field: row.field,
          outcome,
          // Masked: enough for the owner to recognise whether it was them, never
          // enough to be a directory of where the account went.
          newValue: maskValue(row.new_value),
        },
        isTransactional: true,
      });
      // A permanent rejection comes back as `accepted: false` rather than as a
      // throw, so the receipt has to be read. Treating an unsent alert as sent is
      // exactly the lie this column exists to prevent.
      if (!receipt.accepted) {
        this.logger.error(
          `CONTACT CHANGE ALERT REJECTED for request ${row.id} (${outcome}) — ${receipt.reason ?? 'no reason given'}`,
        );
        return row;
      }
    } catch (e) {
      this.logger.error(
        `CONTACT CHANGE ALERT FAILED for request ${row.id} (${outcome}) — ${(e as Error).message}`,
      );
      return row;
    }
    return this.prisma.db.contact_change_request.update({
      where: { id: row.id },
      data: { notified_old_at: this.clock.now() },
    });
  }

  /**
   * Any account already holding the address, a deactivated one included. The
   * unique index does not care about status, so excluding the deactivated here
   * would only move the collision from a clear message to a constraint violation
   * at the moment of the update.
   */
  private async assertNotTaken(field: ContactField, value: string): Promise<void> {
    const taken = await this.prisma.db.user_account.findFirst({
      where: field === 'EMAIL' ? { email: value } : { mobile: value },
      select: { id: true },
    });
    if (!taken) return;
    throw new ConflictError(
      field === 'EMAIL'
        ? 'That email is already registered to another account.'
        : 'That mobile number is already registered to another account.',
    );
  }

  private expiryOf(createdAt: Date): Date {
    return new Date(createdAt.getTime() + REQUEST_TTL_SECONDS * 1000);
  }

  private view(row: ChangeRow, devCodes?: { old?: string; new?: string }): ContactChangeView {
    return {
      requestId: row.id,
      field: row.field as ContactField,
      oldValueMasked: row.old_value_masked,
      newValueMasked: maskValue(row.new_value),
      oldVerified: row.otp_old_verified_at !== null,
      newVerified: row.otp_new_verified_at !== null,
      status: row.status,
      expiresAt: this.expiryOf(row.created_at),
      completed: row.status === 'COMPLETED',
      ...(devCodes && !this.config.isProduction ? { devCodes } : {}),
    };
  }
}
