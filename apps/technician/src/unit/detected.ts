import type { DetectedSpec, DeviceSureCertificate } from '@trugrade/contracts';

/**
 * Read a `DetectedSpec` out of a DeviceSure certificate, for the on-site preview.
 *
 * **This is not the parser.** The authoritative mapping is
 * `qc_tool_provider.field_map_json`, applied server-side, so that a change in
 * DeviceSure's payload is a configuration change rather than an app release.
 * Duplicating that here would mean a technician's preview and the stored record
 * could disagree after a field-map edit, and the technician's copy would be the
 * one nobody could update.
 *
 * What this does instead is read the handful of fields the technician needs to
 * see *while holding the machine* — RAM, storage, CPU, lock state — and treat
 * everything it does not recognise as absent.
 *
 * Two rules it follows exactly:
 *
 * **Absent is not zero.** A field the tool did not report comes back `undefined`,
 * which `compareSpec` records as `notReported` rather than as a mismatch. A `0`
 * here would be a measurement, and a false one (07 §3.5).
 *
 * **Nothing is corrected.** DeviceSure v0.1.0 reports 15 GB for a 16 GB machine
 * because Windows reports usable memory (07 §3.4). The number is passed through
 * as `ramUsableGb` untouched; `compareSpec` already knows the difference between
 * usable and installed and renders both. Adding a `+1` here would be a parser
 * quietly correcting its source, which is the one thing this phase says not to do.
 */
export function detectedFromCertificate(cert: DeviceSureCertificate): DetectedSpec {
  const hw = (cert.hardware ?? {}) as Record<string, unknown>;

  const num = (key: string): number | undefined => {
    const v = hw[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const str = (key: string): string | undefined => {
    const v = hw[key];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };
  const bool = (key: string): boolean | undefined => {
    const v = hw[key];
    return typeof v === 'boolean' ? v : undefined;
  };

  return {
    ramUsableGb: num('ramUsableGb') ?? num('ramGb'),
    ramInstalledGb: num('ramInstalledGb'),
    ramModuleCount: num('ramModules'),
    storageBinaryGb: num('storageBinaryGb') ?? num('storageGb'),
    storageNominalGb: num('storageNominalGb'),
    storageType: str('storageType'),
    cpuModel: str('cpuModel'),
    screenSizeIn: num('screenSizeIn'),
    gpuType: str('gpuType'),
    biosLocked: bool('biosLocked'),
    mdmLocked: bool('mdmLocked'),
    computraceActive: bool('computraceActive'),
    smartStatus: str('smartStatus'),
  };
}

/**
 * Accept a certificate handed over from the DeviceSure agent.
 *
 * On site the handover is local — a QR the agent renders, or a paste — because
 * the warehouse has no signal and the whole point is that the inspection does not
 * need one. When `@devicesure/contracts` lands, its Zod schema replaces this
 * shape check; until then the only thing asserted is that the fields the app
 * genuinely depends on are present, so a mistyped paste fails here rather than
 * three hours later in the upload queue.
 */
export function parseCertificate(raw: string): DeviceSureCertificate {
  const parsed = JSON.parse(raw) as Partial<DeviceSureCertificate>;
  if (!parsed?.certificate?.id) throw new Error('No certificate id in that payload.');
  if (!parsed?.session?.nonce) throw new Error('No session nonce in that payload.');
  if (!parsed?.device?.serial) throw new Error('No device serial in that payload.');
  return parsed as DeviceSureCertificate;
}
