import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { QcPlatformPort } from '../../../shared/adapters/ports';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events';

/**
 * The DeviceSure licence lifecycle (retrofit change 6.5).
 *
 * Under the self-serve QC model the vendor runs the tool that sets their own
 * payout. That is only defensible because the licence is revocable: suspend a
 * vendor and their agents stop certifying, so the machines stop being sellable.
 * Revocation *is* the enforcement mechanism the entire quality model rests on —
 * there is no second control behind it.
 *
 * Which is why this listens to the outbox rather than being called inline from
 * KYC. An HTTP call to DeviceSure inside the approval transaction either holds a
 * database lock open across a network hop, or succeeds and then gets rolled back
 * — issuing a licence to a vendor who was never approved.
 */
@Injectable()
export class LicenceService implements OnModuleInit {
  private readonly logger = new Logger(LicenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qc: QcPlatformPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.on('vendor.verified', 'vendor.licence.issue', async (e) => {
      await this.issue(e.payload.orgId);
    });
    this.bus.on('vendor.suspended', 'vendor.licence.revoke', async (e) => {
      if (e.payload.revokeQcLicence) await this.revoke(e.payload.orgId, e.payload.reason);
    });
  }

  /**
   * Issue on approval. Idempotent by state, not by a flag: the outbox retries on
   * failure, and a retry that issued a *second* licence would leave a revoked
   * vendor holding a working key.
   */
  async issue(orgId: string): Promise<void> {
    const profile = await this.prisma.db.vendor_profile.findUnique({
      where: { org_id: orgId },
      select: { devicesure_status: true },
    });
    if (!profile) throw new Error(`No vendor profile for org ${orgId}`);
    if (profile.devicesure_status === 'ACTIVE') return;

    const { licenceKey } = await this.qc.issueVendorLicence({
      organizationId: orgId,
      maxAgents: 3,
      features: ['FULL_QC', 'SEAL_PRINT'],
    });

    await this.prisma.db.vendor_profile.update({
      where: { org_id: orgId },
      data: {
        devicesure_org_id: orgId,
        devicesure_licence_key: licenceKey,
        devicesure_status: 'ACTIVE',
        devicesure_issued_at: this.clock.now(),
        devicesure_revoked_at: null,
        // Q15: our expert attends the first listing whatever the licence says.
        // Issuing the key does not promote them — `first_supervised_visit_at`
        // does, and only QC can set it.
        qc_mode: 'SUPERVISED',
      },
    });
    this.logger.log(`Issued DeviceSure licence to ${orgId}`);
  }

  /**
   * Revoke on suspension. The local row is written **after** DeviceSure confirms,
   * so a failed call leaves the row ACTIVE and the outbox retries. Marking it
   * revoked locally while their agents keep certifying is the one outcome that
   * would be worse than the error.
   */
  async revoke(orgId: string, reason: string): Promise<void> {
    await this.qc.revokeVendorLicence(orgId, reason);
    await this.prisma.db.vendor_profile.update({
      where: { org_id: orgId },
      data: {
        devicesure_status: 'REVOKED',
        devicesure_revoked_at: this.clock.now(),
        // Back to supervised. Reinstatement is not a silent return to self-serve.
        qc_mode: 'SUPERVISED',
        first_supervised_visit_at: null,
      },
    });
    this.logger.warn(`Revoked DeviceSure licence for ${orgId}: ${reason}`);
  }
}
