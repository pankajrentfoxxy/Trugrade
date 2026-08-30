import * as React from 'react';

/**
 * The shapes the two platform-administration routes read, and the one number
 * component they share.
 *
 * Kept together because `Config.tsx` and `Flags.tsx` are two views of one
 * response: `GET /api/admin/platform/config` returns the config keys, the
 * feature flags and the notification templates in a single payload, because all
 * three answer the same question — what is declared, and what is wired up.
 */

export interface ConfigVersion {
  valueJson: unknown;
  effectiveFrom: string;
  version: number;
  description: string | null;
  changedBy: string | null;
}

export interface ConfigKey extends ConfigVersion {
  key: string;
  valueType: string;
  /** Files naming the key. `null` means the key is newer than the scan. */
  consumers: readonly string[] | null;
  legalEffect: string | null;
  /** Which of the two writers of platform_config creates this key. */
  writtenBy: { migration: boolean; seed: boolean } | null;
  history: ConfigVersion[];
  scheduled: ConfigVersion[];
}

export interface PlatformAdmin {
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
    inBothWriters: number;
    migrationOnly: number;
    seedOnly: number;
    orphaned: number;
  };
  flags: {
    rows: Array<{ key: string; enabled: boolean; rolloutPct: number; orgScopeCount: number }>;
    readerCount: number;
  };
  templates: {
    rows: Array<{
      code: string;
      channel: string;
      locale: string;
      version: number;
      isActive: boolean;
      subject: string | null;
      providerTemplateId: string | null;
    }>;
    readerCount: number;
    messagesSent: number;
  };
}

/**
 * A number, so mono and tabular.
 *
 * 09_FRONTEND_LOCKED.md §3: everything numeric or identifying is monospace,
 * always. On these screens that is every value, every count, every date and
 * every key — a column of ten config values is unreadable in a proportional
 * face, which is half of why this reads as an instrument.
 */
export function Num({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono tnum">{children}</span>;
}
