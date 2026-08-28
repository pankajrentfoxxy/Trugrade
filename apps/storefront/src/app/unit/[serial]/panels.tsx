import { BatteryBar } from '@trugrade/ui';
import type { PassportHardware, UnitPassport } from '../../../lib/api';

/**
 * The two evidence panels whose empty states are the point.
 *
 * They live here rather than inside `page.tsx` because both of them can be
 * driven directly by a test with a null and with a row, and the difference
 * between those two renderings is the whole thing this screen exists to get
 * right. A panel that is only reachable through an async route component is a
 * panel whose empty state gets checked once, by eye, on the day it was written.
 */

export const NotMeasured = (): React.JSX.Element => (
  <span className="notmeasured">Not measured</span>
);

/**
 * The fourteen detected-hardware fields, thirteen of which can be null.
 *
 * Every one of them is listed whatever it holds. The seeded inspections report
 * four and leave ten empty, and ten visible "Not measured" rows is the shape of
 * that inspection — a table that dropped the empty rows would show a complete
 * hardware profile that nobody captured.
 *
 * `hardware: null` is a different fact again: 48 of the 239 reports have no
 * detected-hardware row at all, and that is a technician grading from the areas
 * without a tool run rather than a tool run that measured nothing.
 */
export function Hardware({
  hardware: h,
}: {
  hardware: PassportHardware | null;
}): React.JSX.Element {
  if (h === null) {
    return (
      <div className="empty">
        <h3>No hardware readings were captured on this inspection</h3>
        <p>
          The technician graded this machine from the areas above without a tool run attached, so we
          hold no detected memory, storage or battery figure for it. That is different from a
          machine that reported zeroes, and it is shown as absent rather than filled with them.
        </p>
      </div>
    );
  }

  const rows: Array<[string, React.ReactNode]> = [
    ['Model reported', h.model],
    ['Processor', h.cpu],
    [
      'Memory',
      // The only NOT NULL field in the payload, and it is reported exactly as
      // the tool read it: 15 GB on a 16 GB Windows machine is what the machine
      // says, and rounding it up here would be us correcting our own evidence.
      <span className="mono" key="ram">
        {h.ramDetectedGb} GB
        {h.ramType && <span className="denom"> {h.ramType}</span>}
        {h.ramModules !== null && (
          <span className="denom">
            {' '}
            in {h.ramModules} module{h.ramModules === 1 ? '' : 's'}
          </span>
        )}
      </span>,
    ],
    [
      'Storage',
      h.storageDetectedGb === null && h.storageType === null ? null : (
        <span className="mono" key="sto">
          {h.storageDetectedGb === null ? (
            <NotMeasured />
          ) : (
            <>
              {h.storageDetectedGb} GB
            </>
          )}
          {h.storageType && <span className="denom"> {h.storageType}</span>}
        </span>
      ),
    ],
    ['Drive health (SMART)', h.smartStatus],
    ['Graphics', h.gpu],
    ['Screen', h.screenSizeIn === null ? null : `${h.screenSizeIn}"`],
    [
      'Battery health',
      h.batteryHealthPct === null ? null : (
        // `cycleCount` is passed only when it exists — the component renders
        // nothing rather than "0c", and a tool that did not report cycles has
        // not told us the battery is new.
        <BatteryBar
          key="bat"
          healthPct={h.batteryHealthPct}
          {...(h.cycleCount === null ? {} : { cycleCount: h.cycleCount })}
        />
      ),
    ],
    ['Charge cycles', h.cycleCount],
    ['TPM', h.tpmVersion],
    ['Secure Boot', h.secureBoot === null ? null : h.secureBoot ? 'Enabled' : 'Disabled'],
  ];

  return (
    <div className="tbl">
      <dl className="specs hw">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value === null || value === undefined ? <NotMeasured /> : value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The data-wipe certificate, and the roughly one unit in twelve that has none.
 *
 * The absence has to read as a fact about our record rather than as a panel that
 * failed to render — and it must not be resolved in either direction. We do not
 * hold a certificate; that is not "the drive was left alone" and it is not "it
 * was erased and we mislaid the paperwork", and asserting either without the
 * certificate to show is the same class of claim as a tick over an unmeasured
 * area.
 */
export function WipeCertificate({
  certificate,
}: {
  certificate: UnitPassport['wipeCertificate'];
}): React.JSX.Element {
  if (certificate === null) {
    return (
      <div className="empty">
        <h3>No wipe certificate is recorded for this unit</h3>
        <p>
          We hold no certificate for this machine&rsquo;s drive. That is a gap in our record, not a
          statement that the drive was left alone and not a statement that it was erased &mdash; we
          will not claim either without the certificate to show you. Ask us before you buy and we
          will get it or re-wipe the machine.
        </p>
      </div>
    );
  }

  return (
    <div className="tbl">
      <dl className="specs">
        <div>
          <dt>Standard</dt>
          <dd className="mono">{certificate.standard.replace(/_/g, ' ')}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd className="mono">{certificate.method.replace(/_/g, ' ')}</dd>
        </div>
        <div>
          <dt>Passes</dt>
          <dd className="mono">{certificate.passes}</dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd className="mono">{certificate.verificationStatus.replace(/_/g, ' ')}</dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd className="mono">{certificate.issuedAt.slice(0, 10)}</dd>
        </div>
      </dl>
    </div>
  );
}
