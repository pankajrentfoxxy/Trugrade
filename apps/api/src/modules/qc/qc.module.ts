import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { QcService } from './qc.service';
import { QcRepository } from './internal/qc.repository';
import { QcIngestionController } from './qc-ingestion.controller';
import { IngestionService } from './internal/ingestion.service';
import { DeviceSureClient } from './internal/devicesure.client';
import { IdentityModule } from '../identity';
import { SchedulingService } from './internal/scheduling.service';
import { SealingService } from './internal/sealing.service';
import { VisitClosingService } from './internal/visit-closing.service';
import { ReverificationService } from './internal/reverification.service';
import { QcExpiryService } from './internal/qc-expiry.service';
import { AuditRecheckService } from './internal/audit-recheck.service';
import { VendorQualityService } from './internal/vendor-quality.service';
import { ToleranceService } from './internal/tolerance.service';
import { VerdictService } from './internal/verdict.service';
import { GradeCorrectionService } from './internal/grade-correction.service';
import { ReportPdfService } from './internal/report-pdf.service';
import { QcPassportService, QcPublicController } from './qc-public.controller';
import { QcConsoleService, QcController } from './qc.controller';
import { VendorCorrectionRepository } from './internal/vendor-correction.repository';
import { VendorCorrectionsController } from './vendor-corrections.controller';

/**
 * Registers the QC core: the repository every other service in this module
 * builds on, the module's public service, and DeviceSure ingestion.
 *
 * The tolerance engine, the verdict and grade correction are wired here too.
 * They were the last three that were not, which meant grading, mismatch
 * detection and the whole grade-correction flow existed only where a test
 * constructed them by hand: every one of them is reachable from
 * `VerdictService.evaluate()`, and nothing in a running process could reach
 * `VerdictService`. `QcService` stays the only export, because
 * the barrel is the module's whole public surface and a repository leaking out
 * of it is how the seam is lost. `IngestionService` is deliberately not
 * exported: it is reached over HTTP, by a webhook and by the technician app, and
 * no other module calls it in process.
 *
 * `ObjectStorePort` and `QcPlatformPort` need no import here — `AdaptersModule`
 * is `@Global()`, which is what lets every module take a port without each one
 * restating the wiring.
 */
@Module({
  // `IdentityModule` is imported for `OtpService` only, which it exports on
  // purpose (`kyc` needs it too). Vendor sign-off on a visit is an OTP flow, and
  // re-implementing TTL, the attempt budget and burn-on-last-guess here would be
  // a second OTP implementation to keep correct.
  imports: [PrismaModule, ClockModule, IdentityModule],
  // `QcExpiryService` and `VendorQualityService` carry `@Cron` methods. The
  // scheduler is registered once, globally, by `JobsModule`
  // (`ScheduleModule.forRoot()`), and discovers decorated methods on any
  // provider in the app — so being listed below is all those two need.
  // `VendorCorrectionsController` answers under /api/vendor, not /api/qc, and
  // lives here rather than in the `vendor` module because `GradeCorrectionService`
  // is internal to `qc` — exporting it through the barrel to reach a controller
  // would make the whole correction lifecycle another module's to call.
  controllers: [
    QcIngestionController,
    QcPublicController,
    QcController,
    VendorCorrectionsController,
  ],
  providers: [
    QcService,
    QcRepository,
    IngestionService,
    DeviceSureClient,
    SchedulingService,
    SealingService,
    VisitClosingService,
    ReverificationService,
    QcExpiryService,
    AuditRecheckService,
    VendorQualityService,
    ToleranceService,
    VerdictService,
    GradeCorrectionService,
    QcPassportService,
    ReportPdfService,
    QcConsoleService,
    VendorCorrectionRepository,
  ],
  exports: [QcService],
})
export class QcModule {}
