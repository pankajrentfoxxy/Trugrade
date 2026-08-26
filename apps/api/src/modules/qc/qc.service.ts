import { Injectable } from '@nestjs/common';

/**
 * The public interface of the `qc` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `qc` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: tool providers, technicians, availability, visits, visit units, tool runs, reports, area results, hardware detected, photos, seals, mismatches, re-verifications, sampling rules, wipe certificates, audit rechecks
 *
 * Other modules reach this through `src/modules/qc` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IQcService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
}

@Injectable()
export class QcService implements IQcService {
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}
