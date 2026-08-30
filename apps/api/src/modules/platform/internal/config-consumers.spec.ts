import {
  CONFIG_CONSUMERS,
  CONFIG_SOURCES,
  filesContaining,
  scan,
  scanSources,
} from './config-consumers';
import {
  FEATURE_FLAG_READERS,
  NOTIFICATION_TEMPLATE_READERS,
} from '../platform-admin.controller';

/**
 * The reachability map is a claim about the source tree, so the source tree is
 * what checks it.
 *
 * A test that asserted `CONFIG_CONSUMERS` merely exists, or that it is
 * non-empty, would pass forever while the map drifted from the code — and the
 * screen would keep printing "nothing reads this" about a key somebody wired up
 * last week. The only check worth having re-runs the scan and demands the same
 * answer, which is why `scan()` is exported at all.
 */
describe('platform_config reachability', () => {
  const fresh = scan(Object.keys(CONFIG_CONSUMERS));

  it('matches the source tree as it is now', () => {
    // Printed as an object so a failure is fixed by pasting, not by re-deriving.
    expect(fresh).toEqual({ ...CONFIG_CONSUMERS });
  });

  /**
   * The control case. Without it the assertion above passes just as happily
   * against a scanner that returns an empty array for everything — which is the
   * bug that would make every key on the screen read as unreachable.
   */
  it('finds a reader that is known to exist, and none for a key that has none', () => {
    expect(fresh['tax.tds_rate_pct']).toContain(
      'modules/procurement/internal/payable.service.ts',
    );
    expect(fresh['tds.section_194o_rate']).toEqual([]);
  });

  /**
   * The defect this whole column was built to surface, pinned so it cannot be
   * "fixed" by deleting the evidence. `price.guardrail_upper_multiple` is set to
   * 3.0 in the baseline migration and is named by exactly one file — the console
   * controller that reports it is unread. If a pricing service ever starts
   * reading it, this fails and the screen copy needs revisiting.
   */
  it('still shows the upper price guardrail as reported but not consumed', () => {
    expect(fresh['price.guardrail_upper_multiple']).toEqual([
      'modules/listing/pricing-admin.controller.ts',
    ]);
  });
});

/**
 * The other two claims the platform screen makes about reachability.
 *
 * "No flag is off, because nothing reads a flag" is the single most load-bearing
 * sentence on that screen, and it is a claim about the source tree — so the
 * source tree checks it. If somebody wires the flag table up, this fails and the
 * copy has to change, which is the outcome we want.
 */
describe('the two tables §3C.7 asks for that no code touches', () => {
  /**
   * The screen that reports a table is not a reader of it — the same exclusion
   * `scan()` applies to its own registry file, for the same reason. Counting the
   * renderer would make every dead table report as live.
   */
  const SCREEN = 'modules/platform/platform-admin.controller.ts';
  const readersOf = (table: string): string[] =>
    filesContaining(table).filter((p) => p !== SCREEN);

  it('agrees with the source tree about platform.feature_flag', () => {
    expect(readersOf('platform.feature_flag')).toEqual([...FEATURE_FLAG_READERS]);
  });

  it('agrees with the source tree about platform.notification_template', () => {
    expect(readersOf('platform.notification_template')).toEqual([
      ...NOTIFICATION_TEMPLATE_READERS,
    ]);
  });

  /** The exclusion is only sound while the screen really does name them. */
  it('confirms the screen itself is the file being excluded', () => {
    expect(filesContaining('platform.feature_flag')).toContain(SCREEN);
    expect(filesContaining('platform.notification_template')).toContain(SCREEN);
  });

  /**
   * The control. Both assertions above are satisfied by a scanner that finds
   * nothing at all, and a scanner that finds nothing would report every table on
   * the platform as dead. `notification_log` genuinely has one writer.
   */
  it('does find the one file that writes platform.notification_log', () => {
    expect(filesContaining('platform.notification_log')).toContain(
      'modules/qc/internal/qc-expiry.service.ts',
    );
  });
});

/**
 * Where each key is written, checked the same way and for a bigger reason.
 *
 * A key present in the migrations and absent from the seed — or the reverse —
 * produces a database that boots, serves traffic and is silently missing a
 * setting. `msme.max_payment_days` was exactly that and would have paid an MSME
 * on 15-day terms instead of the statutory 45.
 */
describe('platform_config provenance', () => {
  const fresh = scanSources(Object.keys(CONFIG_SOURCES));

  it('matches the migrations and the seed as they are now', () => {
    expect(fresh).toEqual({ ...CONFIG_SOURCES });
  });

  it('finds all three states, so the scan is not answering one way', () => {
    const states = Object.values(fresh);
    // The control. A scanner returning `{migration:false, seed:false}` for
    // everything would satisfy any single-sided assertion and would report the
    // entire table as orphaned.
    expect(states.some((s) => s.migration && s.seed)).toBe(true);
    expect(states.some((s) => s.migration && !s.seed)).toBe(true);
    expect(states.some((s) => !s.migration && s.seed)).toBe(true);
  });

  /**
   * The leftover, pinned. `qc.visit_fee_waiver_units` is a live row in the dev
   * database under a name neither writer uses any more — the losing half of the
   * two-names-one-number defect. If a writer picks the name up again this fails
   * and the screen copy needs revisiting.
   */
  it('still reports the retired half of the visit-fee pair as written by nothing', () => {
    expect(fresh['qc.visit_fee_waiver_units']).toEqual({ migration: false, seed: false });
    expect(fresh['qc.visit_fee_waived_above']?.seed).toBe(true);
  });

  /**
   * Case matters, and it must not. The baseline migration writes
   * `warranty.default.A_PLUS` and a later migration lower-cases every key in
   * place, so a case-sensitive scan would report three live keys as orphaned.
   */
  it('matches a key the migrations wrote in a different case', () => {
    expect(fresh['warranty.default.a_plus']?.migration).toBe(true);
  });
});
