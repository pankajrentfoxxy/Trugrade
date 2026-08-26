/**
 * Declared specification vs detected hardware.
 *
 * The vendor picks a SKU from the master catalog at listing time. That SKU carries
 * a **declared** specification. When QC runs, the tool reports a **detected** one.
 * The delta between them is the entire trust proposition — and, under the
 * self-serve model, the vendor is the party reporting it.
 *
 * QC-025 is the named test: declare 16 GB, present an 8 GB machine, and the
 * verdict must be MISMATCH with a grade correction raised.
 *
 * **The trap.** A naive equality check fires a false mismatch on *every single
 * unit*, because the numbers a machine reports are not the numbers a machine was
 * sold with:
 *
 *   - Windows `Win32_ComputerSystem.TotalPhysicalMemory` reports memory *usable by
 *     the OS*. Firmware and integrated graphics take the difference, so a 16 GB
 *     Ryzen with Radeon graphics reports 15 GB (`07 §3.4`).
 *   - A "512 GB" drive is 512 × 10⁹ bytes, which is 477 GiB. The vendor declared
 *     512 and the buyer expects 512.
 *
 * So the comparison normalises first and **reports both numbers** — the corrected
 * value for the match, the raw value on the certificate. That is a reporting
 * correction with the evidence preserved, not a parser quietly fixing its source.
 */

import { installedRamFromUsable, nominalStorageFromBinary } from './normalise';

/** Mirrors `qc.qc_tolerance_rule.severity` in the adopted schema. */
export type MismatchSeverity = 'BLOCKING' | 'MAJOR' | 'MINOR';

export type SpecField =
  | 'RAM_GB'
  | 'STORAGE_GB'
  | 'STORAGE_TYPE'
  | 'CPU_MODEL'
  | 'SCREEN_SIZE_IN'
  | 'GPU_TYPE'
  | 'BIOS_LOCK'
  | 'MDM_LOCK'
  | 'COMPUTRACE'
  | 'SMART_STATUS';

export interface SpecMismatch {
  field: SpecField;
  severity: MismatchSeverity;
  declared: string;
  /** What the tool actually said, before any correction. Goes on the certificate. */
  detectedRaw: string;
  /** After the usable→installed and GiB→GB corrections. What was compared. */
  detectedNormalised: string;
  /** Shown to the vendor verbatim. Names the field and both numbers. */
  message: string;
}

/** What the vendor chose from the catalog. */
export interface DeclaredSpec {
  skuCode: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  cpuModel: string;
  screenSizeIn?: number;
  gpuType?: string;
}

/**
 * What the tool found. Every field optional: absent means **not reported**, which
 * is a distinct outcome from a mismatch and must never be treated as one.
 */
export interface DetectedSpec {
  /** Memory usable by the OS, as Windows reports it. */
  ramUsableGb?: number;
  /** Sum of `Win32_PhysicalMemory.Capacity` — installed, if the tool reports it. */
  ramInstalledGb?: number;
  ramModuleCount?: number;
  /** Capacity measured in GiB, as the OS reports it. */
  storageBinaryGb?: number;
  /** Nominal marketed capacity, if the tool reports it. */
  storageNominalGb?: number;
  storageType?: string;
  cpuModel?: string;
  screenSizeIn?: number;
  gpuType?: string;

  // --- security and lock state. Each is BLOCKING: the machine is unusable to a
  // buyer, and selling one is a not-as-described return we cannot refuse. ---
  biosLocked?: boolean;
  mdmLocked?: boolean;
  computraceActive?: boolean;
  /** SMART overall health. Anything but OK means the drive is failing. */
  smartStatus?: string;
}

export interface SpecMatchResult {
  matches: boolean;
  mismatches: SpecMismatch[];
  /** Fields the tool did not report. Not mismatches — unknowns. */
  notReported: SpecField[];
  /** True when any mismatch is BLOCKING: the unit cannot be listed at all. */
  blocking: boolean;
  /** Human-readable RAM and storage, both numbers, for the certificate face. */
  display: { ram?: string; storage?: string };
}

/** CPU model strings vary in spacing, case and vendor prefix. Compare the core. */
function canonCpu(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(intel|amd|core|ryzen|processor|cpu|with radeon graphics|®|™)\b/g, ' ')
    .replace(/\(r\)|\(tm\)/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

const STORAGE_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  NVME: 'NVME_SSD',
  NVME_SSD: 'NVME_SSD',
  'NVME SSD': 'NVME_SSD',
  SSD: 'SATA_SSD',
  SATA: 'SATA_SSD',
  SATA_SSD: 'SATA_SSD',
  HDD: 'HDD',
  'HARD DISK': 'HDD',
  EMMC: 'EMMC',
});

function canonStorageType(s: string): string {
  const key = s.trim().toUpperCase().replace(/[-]/g, '_');
  return STORAGE_TYPE_ALIASES[key] ?? key;
}

/**
 * Chips that are integrated graphics. Anything matching is INTEGRATED; a
 * recognised discrete vendor is DISCRETE; anything else is `null`, meaning
 * "unrecognised" — which routes to not-reported rather than to a mismatch.
 *
 * Erring toward `null` is deliberate. A vendor who honestly declared integrated
 * graphics on a chip we have not seen before should reach a human, not have
 * their listing blocked by a string we failed to recognise.
 */
const INTEGRATED_GPU =
  /\b(uhd|iris|xe\b|hd graphics|vega|radeon graphics|apple m[1-4]|adreno|integrated)\b/i;
// No trailing \b after a digit run: "Arc A370M" would fail it, because there is
// no word boundary between the "3" the pattern consumed and the "7" after it.
const DISCRETE_GPU = /\b(nvidia|geforce|quadro|rtx|gtx|mx\d{3}|radeon (pro|rx)|firepro|arc a\d+)/i;

export function classifyGpu(input: string | null | undefined): 'INTEGRATED' | 'DISCRETE' | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  // Already in the catalog's vocabulary.
  if (upper === 'INTEGRATED' || upper === 'DISCRETE') return upper;
  // Discrete is checked first: "NVIDIA T500" contains no integrated marker, but
  // "AMD Radeon RX 6500M" contains "radeon" which the integrated pattern also
  // matches via "radeon graphics" — the more specific vendor wins.
  if (DISCRETE_GPU.test(s)) return 'DISCRETE';
  if (INTEGRATED_GPU.test(s)) return 'INTEGRATED';
  return null;
}

export interface SpecMatchPolicy {
  /** Screen size tolerance in inches. Panels are reported to one decimal. */
  screenToleranceIn: number;
  /** Treat a CPU model difference as blocking. The legacy tolerance rules do. */
  cpuBlocking: boolean;
}

export const DEFAULT_SPEC_POLICY: SpecMatchPolicy = Object.freeze({
  screenToleranceIn: 0.2,
  cpuBlocking: true,
});

/**
 * Compare a declared SKU against detected hardware.
 *
 * Reads as a list of independent checks rather than a chain, because each one has
 * its own normalisation and its own severity, and a later change to one must not
 * be able to disturb another.
 */
export function compareSpec(
  declared: DeclaredSpec,
  detected: DetectedSpec,
  policy: SpecMatchPolicy = DEFAULT_SPEC_POLICY,
): SpecMatchResult {
  const mismatches: SpecMismatch[] = [];
  const notReported: SpecField[] = [];
  const display: SpecMatchResult['display'] = {};

  // --- RAM -----------------------------------------------------------------
  if (detected.ramInstalledGb === undefined && detected.ramUsableGb === undefined) {
    notReported.push('RAM_GB');
  } else {
    // Prefer what the tool reports as installed; fall back to correcting usable.
    const installed =
      detected.ramInstalledGb ?? installedRamFromUsable(detected.ramUsableGb as number);
    const raw = detected.ramInstalledGb ?? (detected.ramUsableGb as number);

    display.ram =
      detected.ramUsableGb !== undefined && detected.ramUsableGb !== installed
        ? `${installed} GB installed (${detected.ramUsableGb} GB usable)` +
          (detected.ramModuleCount ? ` · ${detected.ramModuleCount} modules` : '')
        : `${installed} GB`;

    if (installed !== declared.ramGb) {
      mismatches.push({
        field: 'RAM_GB',
        severity: 'BLOCKING',
        declared: `${declared.ramGb} GB`,
        detectedRaw: `${raw} GB`,
        detectedNormalised: `${installed} GB`,
        message: `You listed this as ${declared.ramGb} GB. The inspection found ${installed} GB installed. Correct the listing to the right configuration, or check that the machine tested is the one you listed.`,
      });
    }
  }

  // --- Storage -------------------------------------------------------------
  if (detected.storageNominalGb === undefined && detected.storageBinaryGb === undefined) {
    notReported.push('STORAGE_GB');
  } else {
    const nominal =
      detected.storageNominalGb ?? nominalStorageFromBinary(detected.storageBinaryGb as number);
    const raw = detected.storageNominalGb ?? (detected.storageBinaryGb as number);

    display.storage =
      detected.storageBinaryGb !== undefined && detected.storageBinaryGb !== nominal
        ? `${nominal} GB (${detected.storageBinaryGb} GiB usable)`
        : `${nominal} GB`;

    if (nominal !== declared.storageGb) {
      mismatches.push({
        field: 'STORAGE_GB',
        severity: 'BLOCKING',
        declared: `${declared.storageGb} GB`,
        detectedRaw: `${raw} GB`,
        detectedNormalised: `${nominal} GB`,
        message: `You listed this as a ${declared.storageGb} GB drive. The inspection found ${nominal} GB. Correct the listing, or check that the machine tested is the one you listed.`,
      });
    }
  }

  // --- Storage type --------------------------------------------------------
  if (detected.storageType === undefined) {
    notReported.push('STORAGE_TYPE');
  } else if (canonStorageType(detected.storageType) !== canonStorageType(declared.storageType)) {
    mismatches.push({
      field: 'STORAGE_TYPE',
      severity: 'BLOCKING',
      declared: declared.storageType,
      detectedRaw: detected.storageType,
      detectedNormalised: canonStorageType(detected.storageType),
      message: `You listed a ${declared.storageType} drive. The inspection found ${canonStorageType(detected.storageType)}. A buyer paying for NVMe and receiving SATA is a return we cannot refuse.`,
    });
  }

  // --- CPU -----------------------------------------------------------------
  if (detected.cpuModel === undefined) {
    notReported.push('CPU_MODEL');
  } else if (canonCpu(detected.cpuModel) !== canonCpu(declared.cpuModel)) {
    mismatches.push({
      field: 'CPU_MODEL',
      severity: policy.cpuBlocking ? 'BLOCKING' : 'MAJOR',
      declared: declared.cpuModel,
      detectedRaw: detected.cpuModel,
      detectedNormalised: detected.cpuModel,
      message: `You listed an ${declared.cpuModel}. The inspection found an ${detected.cpuModel}. Pick the SKU that matches this machine.`,
    });
  }

  // --- Screen --------------------------------------------------------------
  if (declared.screenSizeIn !== undefined) {
    // Coerced, not trusted. `catalog.sku.screen_size_inch` is NUMERIC(4,1), so
    // Prisma returns a Decimal object, not a number. `Decimal - number` is NaN
    // and `NaN > tolerance` is false — an uncoerced value makes this check pass
    // for every machine ever inspected. The declared type says `number`, so
    // nothing catches it at compile time and nothing fails loudly at runtime.
    const declaredIn = Number(declared.screenSizeIn);
    const detectedIn = Number(detected.screenSizeIn);
    if (detected.screenSizeIn === undefined || !Number.isFinite(detectedIn)) {
      notReported.push('SCREEN_SIZE_IN');
    } else if (!Number.isFinite(declaredIn)) {
      // A declared value we cannot read is not a pass. Say so.
      notReported.push('SCREEN_SIZE_IN');
    } else if (Math.abs(detectedIn - declaredIn) > policy.screenToleranceIn) {
      mismatches.push({
        field: 'SCREEN_SIZE_IN',
        severity: 'MAJOR',
        declared: `${declaredIn}"`,
        detectedRaw: `${detected.screenSizeIn}"`,
        detectedNormalised: `${detectedIn}"`,
        message: `You listed a ${declaredIn}" screen. The inspection found ${detectedIn}".`,
      });
    }
  }

  // --- GPU -----------------------------------------------------------------
  if (declared.gpuType !== undefined) {
    // `declared.gpuType` comes from `catalog.sku.gpu_type`, whose CHECK permits
    // only INTEGRATED or DISCRETE. A QC tool reports the chip — "Intel Iris Xe",
    // "NVIDIA T500". Comparing the two strings directly made every single unit a
    // MAJOR mismatch, and with `requireSpecMatch` in the auto-approval gate that
    // blocked every listing on the platform.
    //
    // So classify the detected chip into the same two-value vocabulary first.
    // The RAM and storage paths were written this way deliberately
    // (installedRamFromUsable, nominalStorageFromBinary); GPU never was.
    const declaredClass = classifyGpu(declared.gpuType);
    const detectedClass = detected.gpuType === undefined ? null : classifyGpu(detected.gpuType);

    if (detected.gpuType === undefined) {
      notReported.push('GPU_TYPE');
    } else if (detectedClass === null || declaredClass === null) {
      // An unrecognised chip is not evidence of a discrete card. Saying "not
      // reported" sends it to a human instead of failing an honest vendor.
      notReported.push('GPU_TYPE');
    } else if (detectedClass !== declaredClass) {
      mismatches.push({
        field: 'GPU_TYPE',
        severity: 'MAJOR',
        declared: declaredClass,
        detectedRaw: detected.gpuType,
        detectedNormalised: detectedClass,
        message: `You listed ${declaredClass.toLowerCase()} graphics. The inspection found ${detected.gpuType}, which is ${detectedClass.toLowerCase()}.`,
      });
    }
  }

  // --- Locks and drive health ---------------------------------------------
  // These are not "mismatches" against a declaration — they are states that make
  // the machine unusable to a buyer whatever the listing says.
  const lock = (field: SpecField, value: boolean | undefined, message: string): void => {
    if (value === undefined) notReported.push(field);
    else if (value) {
      mismatches.push({
        field,
        severity: 'BLOCKING',
        declared: 'not locked',
        detectedRaw: 'locked',
        detectedNormalised: 'locked',
        message,
      });
    }
  };

  lock(
    'BIOS_LOCK',
    detected.biosLocked,
    'This machine has a BIOS or supervisor password set. Clear it before listing — a buyer cannot use a locked machine, and we cannot sell one.',
  );
  lock(
    'MDM_LOCK',
    detected.mdmLocked,
    'This machine is still enrolled in a mobile device management profile. The previous owner must release it from their MDM tenant before it can be sold.',
  );
  lock(
    'COMPUTRACE',
    detected.computraceActive,
    'Computrace/Absolute persistence is active on this machine. It must be deactivated by the previous owner before the machine can be listed.',
  );

  if (detected.smartStatus === undefined) {
    notReported.push('SMART_STATUS');
  } else if (detected.smartStatus.toUpperCase() !== 'OK') {
    mismatches.push({
      field: 'SMART_STATUS',
      severity: 'BLOCKING',
      declared: 'OK',
      detectedRaw: detected.smartStatus,
      detectedNormalised: detected.smartStatus.toUpperCase(),
      message: `The drive reports SMART status "${detected.smartStatus}". A failing drive cannot be listed — replace it and re-run the inspection.`,
    });
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
    notReported,
    blocking: mismatches.some((m) => m.severity === 'BLOCKING'),
    display,
  };
}
