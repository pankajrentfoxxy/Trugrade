import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { QcService } from './qc.service';
import { QcRepository } from './internal/qc.repository';

/**
 * Registers the QC core: the repository every other service in this module
 * builds on, and the module's public service.
 *
 * Ingestion, the tolerance engine and verdict, grade correction, visit
 * scheduling, sealing and the aggregates are five more sibling services and are
 * not wired here yet — a later step adds them beside these. `QcService` stays
 * the only export, because the barrel is the module's whole public surface and
 * a repository leaking out of it is how the seam is lost.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  providers: [QcService, QcRepository],
  exports: [QcService],
})
export class QcModule {}
