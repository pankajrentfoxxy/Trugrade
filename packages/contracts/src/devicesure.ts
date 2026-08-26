import { mapToolGrade } from './qc-verdict';
import { DEVICESURE_GRADES } from './rules';
import type { Grade } from './rules';

/**
 * The DeviceSure ingestion contract (Phase 4 Task 2, `07_DEVICESURE_INTEGRATION.md` §5).
 *
 * DeviceSure is a separate product at v0.1.0, so this is written against the
 * documented shape and a mock. When `@devicesure/contracts` arrives, its Zod
 * schemas become the source of truth and this file adapts to them — but the
 * *guards* below do not move, because they are about what Gorefurbo will accept,
 * not about what DeviceSure happens to send.
 *
 * The governing instruction from §7 of that document: **do not paper over
 * upstream defects in the parser.** A parser that quietly corrects its source is
 * a parser nobody can reason about six months later. So nothing here rewrites a
 * reported value. Where a reported value is untrustworthy we reject it, hard-stop
 * the unit, or flag it — all three are visible, and none of them are silent.
 */

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

export type AreaStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNSUPPORTED';

export interface DeviceSureTestResult {
  /** Maps to `qc_area_result.area`. */
  readonly area: string;
  readonly status: AreaStatus;
  readonly detail?: string;
}

export interface DeviceSureCertificate {
  readonly certificate: {
    readonly id: string;
    readonly sha256: string;
    /** Ed25519 over the canonical form. §4 lists this as still to be added. */
    readonly signature?: string;
    readonly validUntil?: string;
  };
  readonly session: {
    readonly rulesVersion?: string;
    readonly externalRef?: string;
    readonly nonce: string;
  };
  readonly device: {
    readonly serial: string;
    readonly fingerprint?: string;
  };
  /** 0–100. §3.2 — a certificate must not show a raw "24 / 100" as a headline. */
  readonly score?: number;
  /** DeviceSure's scale is A+/A/B/C/D/FAIL. Ours is A+/A/B. */
  readonly grade?: string;
  readonly testResults?: readonly DeviceSureTestResult[];
  readonly hardware?: Readonly<Record<string, unknown>>;
  readonly battery?: { readonly healthPct?: number; readonly cycleCount?: number };
  readonly seal?: { readonly code?: string; readonly photoKey?: string };
  readonly photos?: readonly { readonly angle: string; readonly key: string }[];
  readonly wipe?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// What we do about a bad certificate — three different things, never conflated
// ---------------------------------------------------------------------------

/**
 * `REJECT`    — do not create a `qc_report` at all. The certificate contradicts
 *               itself, so nothing on it can be relied upon. The raw payload is
 *               still stored: it is the evidence that we were sent something
 *               incoherent.
 * `HARD_STOP` — ingest the run, but the unit stops dead. Used where the
 *               certificate is internally fine but describes a different machine.
 * `FLAG`      — ingest and continue, with the problem recorded for a human.
 */
export type Disposition = 'REJECT' | 'HARD_STOP' | 'FLAG';

export type DefectCode =
  | 'GRADE_CONTRADICTS_FAILED_COMPONENT'
  | 'GRADE_NOT_LISTABLE'
  | 'GRADE_ABSENT'
  | 'GRADE_UNKNOWN_SCALE'
  | 'SCORE_OUT_OF_RANGE'
  | 'UNSIGNED'
  | 'SERIAL_MISMATCH'
  | 'NO_AREAS_REPORTED'
  | 'UNSUPPORTED_AREAS_PRESENT';

export interface CertificateDefect {
  readonly code: DefectCode;
  readonly disposition: Disposition;
  readonly message: string;
}

export interface IngestionVerdict {
  /** False when any defect is REJECT: no qc_report is created. */
  readonly accept: boolean;
  /** True when any defect is HARD_STOP: ingested, but the unit cannot proceed. */
  readonly hardStop: boolean;
  readonly defects: readonly CertificateDefect[];
  /** The grade after mapping DeviceSure's scale onto ours. Null = not listable. */
  readonly gradeProposed: Grade | null;
}

export interface IngestionContext {
  /** The serial on the visit manifest, for the `serial_matches` comparison. */
  readonly expectedSerial?: string;
  /**
   * Production refuses an unsigned certificate. A manual-entry path stays open
   * (`parse_status = 'MANUAL_ENTRY'`) but it needs an explicit reason and a named
   * actor, which is a decision for the service, not for this function.
   */
  readonly requireSignature?: boolean;
}

/**
 * Decide what to do with a certificate, before any of it is believed.
 *
 * The headline rule, and the reason this function exists at all:
 *
 * > A certificate graded **A+ with a failed USB port** (`07 §3.1`). Weighted
 * > averaging swallows a single component failure. Gorefurbo must **reject any
 * > certificate whose grade is inconsistent with a `FAIL` component** rather than
 * > trust it — grade is a legal claim under CP e-Comm r.7(5).
 *
 * Note what that asks for and what it does not. It does not ask us to recompute
 * the grade, or to downgrade A+ to B and carry on. Recomputing would be us
 * substituting our arithmetic for the tool's and then publishing the result as
 * the tool's finding. The certificate is incoherent; the correct response is to
 * refuse it and get the upstream weighting fixed.
 */
export function assessCertificate(
  cert: DeviceSureCertificate,
  ctx: IngestionContext = {},
): IngestionVerdict {
  const defects: CertificateDefect[] = [];
  const areas = cert.testResults ?? [];
  const failed = areas.filter((a) => a.status === 'FAIL');
  const gradeProposed = mapToolGrade(cert.grade);

  if (ctx.requireSignature && !cert.certificate.signature) {
    defects.push({
      code: 'UNSIGNED',
      disposition: 'REJECT',
      message:
        'Certificate carries no signature. Unsigned reports are accepted only via the manual-entry path, with a reason and a named actor.',
    });
  }

  if (cert.grade === undefined || cert.grade === null || cert.grade === '') {
    defects.push({
      code: 'GRADE_ABSENT',
      disposition: 'REJECT',
      message: 'Certificate carries no grade. There is nothing to list against.',
    });
  } else if (!(DEVICESURE_GRADES as readonly string[]).includes(cert.grade.toUpperCase().replace('+', '_PLUS'))) {
    // A grade outside DeviceSure's own scale means the payload shape has moved
    // and the field map is stale. Guessing which of our grades they meant is how
    // a mapping bug becomes a mis-sold machine.
    defects.push({
      code: 'GRADE_UNKNOWN_SCALE',
      disposition: 'REJECT',
      message: `Grade "${cert.grade}" is not on DeviceSure's scale (${DEVICESURE_GRADES.join('/')}). The payload shape has changed: update field_map_json rather than inferring a grade.`,
    });
  } else if (gradeProposed === null) {
    // C, D and FAIL are legitimate DeviceSure outputs. They are simply not
    // things we sell, so this is not a defect in the certificate — it is a
    // machine that does not reach our floor. Ingest it; the unit is not listable.
    defects.push({
      code: 'GRADE_NOT_LISTABLE',
      disposition: 'HARD_STOP',
      message: `Grade ${cert.grade} is below the lowest grade we list (B). The unit is not listable.`,
    });
  } else if (failed.length > 0) {
    // The §3.1 defect. A machine with a component in FAIL is not an A+ machine
    // and not an A machine, and a scale that says otherwise is averaging away
    // exactly the thing a buyer cares about.
    defects.push({
      code: 'GRADE_CONTRADICTS_FAILED_COMPONENT',
      disposition: 'REJECT',
      message:
        `Certificate is graded ${cert.grade} while reporting ${failed.length} failed ` +
        `component(s): ${failed.map((f) => f.area).join(', ')}. A grade that survives a ` +
        `component failure is a weighting defect upstream, not a finding we can publish — ` +
        `grade is our claim under CP e-Comm r.7(5). Fix the weighting in DeviceSure; ` +
        `do not re-grade here.`,
    });
  }

  if (cert.score !== undefined && (cert.score < 0 || cert.score > 100)) {
    defects.push({
      code: 'SCORE_OUT_OF_RANGE',
      disposition: 'REJECT',
      message: `Score ${cert.score} is outside 0–100.`,
    });
  }

  if (areas.length === 0) {
    defects.push({
      code: 'NO_AREAS_REPORTED',
      disposition: 'REJECT',
      message: 'No per-area results. A grade with nothing behind it cannot be defended.',
    });
  }

  const unsupported = areas.filter((a) => a.status === 'UNSUPPORTED');
  if (unsupported.length > 0) {
    // §4 item 7 wants this count on the certificate face. It is not a defect —
    // an untested area is an honest outcome — but a buyer must be told, and it
    // must never be silently scored as a pass.
    defects.push({
      code: 'UNSUPPORTED_AREAS_PRESENT',
      disposition: 'FLAG',
      message: `${unsupported.length} area(s) could not be tested: ${unsupported
        .map((a) => a.area)
        .join(', ')}. Show the count on the certificate; never score them as passes.`,
    });
  }

  if (ctx.expectedSerial !== undefined) {
    const got = cert.device.serial?.trim().toUpperCase() ?? '';
    if (got !== ctx.expectedSerial.trim().toUpperCase()) {
      // Task 2 step 4: an immediate hard stop. We do not know which machine this
      // is, so every other number on the certificate is about something else.
      defects.push({
        code: 'SERIAL_MISMATCH',
        disposition: 'HARD_STOP',
        message:
          `Certificate serial ${got || '(absent)'} does not match the manifest serial ` +
          `${ctx.expectedSerial}. The label does not belong to the laptop: do not grade it, ` +
          `do not seal it, do not list it. Mark the visit unit UNTESTABLE and raise an exception.`,
      });
    }
  }

  return {
    accept: !defects.some((d) => d.disposition === 'REJECT'),
    hardStop: defects.some((d) => d.disposition === 'HARD_STOP'),
    defects,
    gradeProposed,
  };
}

// ---------------------------------------------------------------------------
// Canonical form for the signature
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON for signing and hashing: object keys sorted, no insignificant
 * whitespace, arrays left in order because their order is meaningful.
 *
 * This must match DeviceSure byte for byte or every signature fails, so when
 * `@devicesure/contracts` lands, **their** canonicaliser wins and this one is
 * deleted rather than kept alongside it. Two canonicalisers that agree today and
 * drift tomorrow is the same failure this codebase keeps producing.
 *
 * Numbers are emitted by `JSON.stringify`, which is ECMAScript's shortest
 * round-trippable form. That is well defined, but it is *not* the same rule as
 * RFC 8785 in every case, so do not describe this as JCS-compliant.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

/**
 * The bytes that are signed: everything except the signature itself.
 *
 * Split out so the service cannot accidentally verify a signature over a payload
 * that includes it — which always fails, and always looks like a key problem.
 */
export function signablePayload(cert: DeviceSureCertificate): string {
  const { signature: _signature, ...certificate } = cert.certificate;
  return canonicalise({ ...cert, certificate });
}

// ---------------------------------------------------------------------------
// The field map
// ---------------------------------------------------------------------------

/**
 * The default `qc_tool_provider.field_map_json` for DeviceSure, per §5.4.
 *
 * Direction matters and is easy to get backwards. The three providers already
 * seeded (PHONECHECK, BLANCCO, TT_AGENT) all write **our field first, their path
 * second** — `{"serial": "device.serial"}` — so this follows them. A second map
 * written the other way round would parse to garbage the first time anyone reused
 * the generic parser across providers.
 *
 * It lives in the database, not in code, precisely so DeviceSure changing its
 * payload is a configuration change: "Change `field_map_json` and the parser,
 * never the tool." This constant is only the seed value.
 */
export const DEVICESURE_FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  tool_run_id: 'certificate.id',
  raw_report_hash: 'certificate.sha256',
  signature: 'certificate.signature',
  nonce: 'session.nonce',
  valid_until: 'certificate.validUntil',
  rules_version: 'session.rulesVersion',
  serial: 'device.serial',
  device_fingerprint: 'device.fingerprint',
  qc_score: 'score',
  grade_proposed: 'grade',
  area_results: 'testResults',
  hardware: 'hardware',
  battery_health_pct: 'battery.healthPct',
  cycle_count: 'battery.cycleCount',
  seal_code: 'seal.code',
  photos: 'photos',
  wipe: 'wipe',
});
