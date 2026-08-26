import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { QcRepository } from './internal/qc.repository';

/**
 * The public interface of the `qc` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `qc` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: tool providers, technicians, availability, visits, visit units, tool runs,
 * reports, area results, hardware detected, photos, seals, mismatches,
 * re-verifications, sampling rules, wipe certificates, audit rechecks.
 *
 * Deliberately still small. The services that follow — ingestion, the
 * tolerance engine and verdict, grade correction, scheduling, sealing and the
 * aggregates — add to this interface when they land and another module actually
 * needs to call them. A method added here in advance of a caller is a network
 * contract nobody has agreed to; `countCurrentReports` is here because the
 * storefront's public counter asked for it and would otherwise have read
 * `qc.qc_report` from the catalog module.
 *
 * Other modules reach this through `src/modules/qc` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IQcService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * How many units carry a current inspection — the storefront's headline
   * number.
   *
   * `is_current` is the filter that matters and it is qc's own bookkeeping: a
   * re-inspection supersedes its predecessor rather than deleting it, so a
   * caller counting `qc_report` rows would publish the number of inspections
   * ever performed and call it the number of machines checked.
   */
  countCurrentReports(): Promise<number>;
}

@Injectable()
export class QcService implements IQcService {
  constructor(
    private readonly repo: QcRepository,
    private readonly clock: ClockPort,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Two things that fail silently rather than loudly, which is why they are
   * worth a health check.
   *
   * An empty `qc_tolerance_rule` makes every declared-versus-detected comparison
   * a no-op: nothing throws, no mismatch is ever raised, and every machine
   * passes its spec check. That is the QC-025 test quietly inverted, and it is
   * indistinguishable from a clean run until a buyer opens an 8 GB laptop they
   * paid for as a 16 GB one.
   *
   * An inactive DEVICESURE provider row means ingestion has nowhere to attribute
   * a certificate, and the webhook starts refusing deliveries for inspections a
   * vendor has already carried out.
   */
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    const [rules, provider] = await Promise.all([
      this.repo.findToleranceRules(this.clock.todayInIst()),
      this.repo.findToolProviderByCode('DEVICESURE'),
    ]);

    if (rules.length === 0) {
      return {
        ok: false,
        detail: 'No QC tolerance rules are in effect — every spec check would pass.',
      };
    }
    if (!provider?.isActive) {
      return { ok: false, detail: 'The DEVICESURE tool provider is missing or inactive.' };
    }
    return { ok: true };
  }

  async countCurrentReports(): Promise<number> {
    return this.prisma.db.qc_report.count({ where: { is_current: true } });
  }
}
