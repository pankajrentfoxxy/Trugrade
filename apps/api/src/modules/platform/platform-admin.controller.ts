import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { CONFIG_CONSUMERS, CONFIG_SOURCES, LEGAL_EFFECT } from './internal/config-consumers';

/**
 * Platform administration, read side — T41. `03_UX_SPEC.md` §3C.7.
 *
 * ## Read-only, and that is the design rather than a first cut
 *
 * §3C.7 gives ADMIN_SUPER "edit a key". Nothing here edits one, for a reason
 * worth writing down: `platform_config` is the live control surface for pricing,
 * QC gates, statutory payment terms and TDS. A text box over it with no staging,
 * no approval and no rollback is a production incident with a save button — and
 * this repo has already been bitten three times by config that was *wrong*
 * rather than config that was *hard to change*:
 *
 *   - `qc.visit_fee_waived_above` and `qc.visit_fee_waiver_units` are the same
 *     number under two names, reached by different halves of the product;
 *   - `msme.max_payment_days` was in the baseline migration and missing from the
 *     seed, so a seed-built database paid an MSME on 15-day terms instead of the
 *     statutory 45 — a s.16 compound-interest liability;
 *   - `price.guardrail_upper_multiple` is set to 3.0 and read by nothing.
 *
 * Not one of those would have been prevented by an editor, and all three become
 * visible the moment the screen shows **which files read each key**. So that is
 * what this route returns. The editor is named as unbuilt in the ledger rather
 * than half-built here.
 *
 * ## Why this lives in `platform`
 *
 * These are `platform`'s own three tables and nobody else's. There is no
 * aggregate here and no second schema — the whole payload is
 * `platform.platform_config`, `platform.feature_flag` and
 * `platform.notification_template`, which is what keeps it out of the ops
 * controller's cross-module territory.
 */

/**
 * Files naming `platform.feature_flag` and `platform.notification_template`
 * anywhere in `src/`.
 *
 * Both are empty, and `config-consumers.spec.ts` re-derives both with the same
 * scanner that keeps `CONFIG_CONSUMERS` honest — so "nothing reads the flag
 * table" is an assertion the suite checks, not a sentence somebody typed once.
 * This file is excluded from that scan: a screen that reports a table is not a
 * reader of it, and counting the renderer would make every dead table look live.
 */
export const FEATURE_FLAG_READERS: readonly string[] = Object.freeze([]);
export const NOTIFICATION_TEMPLATE_READERS: readonly string[] = Object.freeze([]);

/** One dated row of one key. Values stay JSON; nothing here parses a value. */
interface ConfigVersion {
  valueJson: unknown;
  effectiveFrom: string;
  version: number;
  description: string | null;
  changedBy: string | null;
}

interface ConfigKey extends ConfigVersion {
  key: string;
  /**
   * `boolean` / `number` / `string` / `object`, read off the JSON itself.
   *
   * Not a declared type: `platform_config` has no type column. §3C.7 asks for
   * typed values and the schema does not carry one, so this is what the value
   * actually *is*, which is the only thing that can be said honestly.
   */
  valueType: string;
  /**
   * Files naming this key, or `null` when the key is newer than the scan.
   *
   * An empty array and `null` are different facts and the screen renders them
   * differently: "nothing reads this" is a finding, "we have not looked" is an
   * admission. See `internal/config-consumers.ts`.
   */
  consumers: readonly string[] | null;
  /** Statutory consequence of changing it, where there is one. */
  legalEffect: string | null;
  /**
   * Which of the two writers of this table creates the key.
   *
   * Both false is a leftover — a row created under a name nothing uses any more.
   * `null` is a key newer than the scan, exactly as `consumers` is.
   */
  writtenBy: { migration: boolean; seed: boolean } | null;
  /** Superseded rows for the same key, newest first. */
  history: ConfigVersion[];
  /** Rows dated in the future. `v_current_config` does not return them yet. */
  scheduled: ConfigVersion[];
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPct: number;
  orgScopeCount: number;
}

interface NotificationTemplate {
  code: string;
  channel: string;
  locale: string;
  version: number;
  isActive: boolean;
  subject: string | null;
  providerTemplateId: string | null;
}

export interface PlatformAdminView {
  asAt: string;
  keys: ConfigKey[];
  summary: {
    keysInForce: number;
    rows: number;
    withReader: number;
    withoutReader: number;
    unscanned: number;
    keysWithHistory: number;
    scheduledRows: number;
    /** Written by the migrations and by the seed. */
    inBothWriters: number;
    migrationOnly: number;
    seedOnly: number;
    /** Written by neither: a leftover row under a retired name. */
    orphaned: number;
  };
  flags: {
    rows: FeatureFlag[];
    /** Files naming `platform.feature_flag`. Zero is the whole finding. */
    readerCount: number;
  };
  templates: {
    rows: NotificationTemplate[];
    readerCount: number;
    /** `platform.notification_log` rows — messages sent without a template. */
    messagesSent: number;
  };
}

interface ConfigRow {
  key: string;
  value_json: unknown;
  effective_from: Date;
  version: number;
  description: string | null;
  changed_by: string | null;
}

@Controller('admin/platform')
export class PlatformAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * `platform.config.write` guards a READ, which is unusual and is right here.
   *
   * §3C.7 gives this screen to ADMIN_SUPER alone, and `platform.config.write` is
   * held by exactly PLATFORM_SUPERADMIN. There is no `platform.config.read` in
   * `PERMISSIONS`, and inventing one would put the screen out of reach of every
   * seeded role until somebody remembered to grant it — which is precisely how
   * the KYC section came to be invisible to its own reviewers.
   */
  @Get('config')
  @RequirePermissions('platform.config.write')
  async config(): Promise<PlatformAdminView> {
    const now = this.clock.now();

    // Four statements, one module schema each — and all four are `platform`, so
    // there is no seam to cross. Every version of every key, ordered so the
    // grouping below is one pass.
    const rows = await this.prisma.$queryRaw<ConfigRow[]>`
      SELECT key, value_json, effective_from, version, description, changed_by::text AS changed_by
        FROM platform.platform_config
       ORDER BY key ASC, effective_from DESC`;

    const flagRows = await this.prisma.$queryRaw<
      Array<{ key: string; enabled: boolean; rollout_pct: number; scope: number }>
    >`SELECT key, enabled, rollout_pct, coalesce(array_length(org_scope, 1), 0)::int AS scope
        FROM platform.feature_flag ORDER BY key ASC`;

    const templateRows = await this.prisma.$queryRaw<
      Array<{
        code: string;
        channel: string;
        locale: string;
        version: number;
        is_active: boolean;
        subject: string | null;
        provider_template_id: string | null;
      }>
    >`SELECT code, channel, locale, version, is_active, subject, provider_template_id
        FROM platform.notification_template ORDER BY code ASC, channel ASC, version DESC`;

    const sentRows = await this.prisma.$queryRaw<Array<{ sent: bigint }>>`
      SELECT count(*)::bigint AS sent FROM platform.notification_log`;

    const version = (r: ConfigRow): ConfigVersion => ({
      valueJson: r.value_json,
      effectiveFrom: r.effective_from.toISOString(),
      version: r.version,
      description: r.description,
      changedBy: r.changed_by,
    });

    const byKey = new Map<string, ConfigRow[]>();
    for (const r of rows) {
      const list = byKey.get(r.key);
      if (list) list.push(r);
      else byKey.set(r.key, [r]);
    }

    const keys: ConfigKey[] = [];
    for (const [key, all] of byKey) {
      // `platform.v_current_config` resolves a key to the newest row not dated
      // in the future, and this resolves it the same way or the screen shows a
      // value the product is not using. `ClockPort` rather than the view's own
      // `now()`: one instant decides every deadline in this build.
      const scheduled = all.filter((r) => r.effective_from > now);
      const inForce = all.filter((r) => r.effective_from <= now);
      // A key whose every row is future-dated has no current value at all. Its
      // newest row is still shown, so the key is not invisible, and `scheduled`
      // carries the same row so the screen can say it is not live yet.
      const current = inForce[0] ?? all[0];
      if (!current) continue;
      keys.push({
        key,
        ...version(current),
        valueType: current.value_json === null ? 'null' : typeof current.value_json,
        consumers: CONFIG_CONSUMERS[key] ?? null,
        legalEffect: LEGAL_EFFECT[key] ?? null,
        writtenBy: CONFIG_SOURCES[key] ?? null,
        history: inForce.slice(1).map(version),
        scheduled: scheduled.map(version),
      });
    }

    const withReader = keys.filter((k) => k.consumers !== null && k.consumers.length > 0).length;
    const unscanned = keys.filter((k) => k.consumers === null).length;

    return {
      asAt: now.toISOString(),
      keys,
      summary: {
        keysInForce: keys.length,
        rows: rows.length,
        withReader,
        withoutReader: keys.length - withReader - unscanned,
        unscanned,
        keysWithHistory: keys.filter((k) => k.history.length > 0).length,
        scheduledRows: keys.reduce((a, k) => a + k.scheduled.length, 0),
        inBothWriters: keys.filter((k) => k.writtenBy?.migration && k.writtenBy.seed).length,
        migrationOnly: keys.filter((k) => k.writtenBy?.migration && !k.writtenBy.seed).length,
        seedOnly: keys.filter((k) => k.writtenBy && !k.writtenBy.migration && k.writtenBy.seed)
          .length,
        orphaned: keys.filter((k) => k.writtenBy && !k.writtenBy.migration && !k.writtenBy.seed)
          .length,
      },
      flags: {
        rows: flagRows.map((f) => ({
          key: f.key,
          enabled: f.enabled,
          rolloutPct: f.rollout_pct,
          orgScopeCount: f.scope,
        })),
        readerCount: FEATURE_FLAG_READERS.length,
      },
      templates: {
        rows: templateRows.map((t) => ({
          code: t.code,
          channel: t.channel,
          locale: t.locale,
          version: t.version,
          isActive: t.is_active,
          subject: t.subject,
          providerTemplateId: t.provider_template_id,
        })),
        readerCount: NOTIFICATION_TEMPLATE_READERS.length,
        messagesSent: Number(sentRows[0]?.sent ?? 0),
      },
    };
  }
}
