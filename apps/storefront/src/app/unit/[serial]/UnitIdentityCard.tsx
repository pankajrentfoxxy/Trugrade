import { GradeBadge, ScoreRing, StatusPill } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import type { UnitPassport } from '../../../lib/api';
import { NotMeasured } from './panels';

const VERDICT_LABEL: Record<NonNullable<UnitPassport['verdict']>, string> = {
  PASS: 'PASS',
  PASS_WITH_NOTE: 'PASS with a note',
  MISMATCH: 'Spec mismatch',
  FAIL: 'FAIL',
};

/**
 * Unit passport identity — the serial, verdict and inspection facts on one card,
 * matching the product record header shape without the wide identifier strip.
 */
export function UnitIdentityCard({
  passport,
  measured,
}: {
  passport: UnitPassport;
  measured: number;
}): React.JSX.Element {
  const facts: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: 'Inspection score',
      value:
        passport.qcScore === null ? (
          <NotMeasured />
        ) : (
          <>
            {passport.qcScore}
            <span className="denom"> / 100</span>
          </>
        ),
    },
    { label: 'Inspected', value: passport.inspectedOn ?? <NotMeasured /> },
    { label: 'Certificate valid to', value: passport.validUntil ?? <NotMeasured /> },
    {
      label: 'Seal',
      value: passport.seal ? (
        passport.seal.code
      ) : (
        <span className="notmeasured">No seal recorded</span>
      ),
    },
    {
      label: 'Areas measured',
      value: (
        <>
          {measured}
          <span className="denom"> of {passport.areas.length}</span>
        </>
      ),
    },
  ];

  return (
    <header className="uid" data-testid="record-header">
      <div className="uid-body">
        <div className="uid-main">
          <div className="uid-head">
            <h1 className="uid-serial">{passport.serialNumber}</h1>
            <div className="uid-badges">
              {passport.verdict ? (
                <StatusPill
                  tone={
                    passport.verdict === 'PASS' || passport.verdict === 'PASS_WITH_NOTE'
                      ? 'pass'
                      : 'fail'
                  }
                  label={VERDICT_LABEL[passport.verdict]}
                />
              ) : null}
              {passport.grade ? <GradeBadge grade={passport.grade as Grade} /> : null}
            </div>
          </div>
          <p className="uid-sub">
            Opened at the supply point by our technician, measured, graded against the published
            bands and sealed. This is that inspection — the machine&rsquo;s own, not a sample of
            its model.
          </p>
          <dl className="uid-grid">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className="mono">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="uid-aside">
          <ScoreRing value={passport.qcScore} size={74} />
          <div className="uid-score">
            <b className="mono">
              {passport.qcScore === null ? 'Not measured' : `${passport.qcScore} / 100`}
            </b>
            <span>
              {passport.qcScore === null
                ? 'No overall score was recorded.'
                : `${measured} of ${passport.areas.length} areas measured.`}
            </span>
          </div>
          <a
            className="sel"
            href={`/api/unit/${encodeURIComponent(passport.serialNumber)}/report.pdf`}
          >
            Printed report (PDF)
          </a>
        </div>
      </div>
    </header>
  );
}
