import type { SearchResult } from '../../lib/api';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const GRADE_CODE: Record<string, string> = {
  A_PLUS: 'A+',
  A: 'A',
  B: 'B',
};

const STORAGE_SHORT: Record<string, string> = {
  NVME_SSD: 'SSD',
  SATA_SSD: 'SSD',
  EMMC: 'eMMC',
  HDD: 'HDD',
};

function storageShortLabel(storageType: string | undefined): string | null {
  if (!storageType) return null;
  return STORAGE_SHORT[storageType] ?? storageType.replace(/_/g, ' ');
}

/** Score bar fill: red / yellow, then green depth follows inspected grade. */
type ScoreTone = 'fail' | 'warn' | 'b' | 'a' | 'aplus';

function scoreBarTone(score: number, grade: string): ScoreTone {
  if (score < 60) return 'fail';
  if (score < 75) return 'warn';
  if (grade === 'A_PLUS') return 'aplus';
  if (grade === 'A') return 'a';
  if (score < 85) return 'warn';
  return 'b';
}

function gradePillTone(grade: string): 'aplus' | 'a' | 'b' {
  if (grade === 'A_PLUS') return 'aplus';
  if (grade === 'A') return 'a';
  return 'b';
}

function LaptopThumb(): React.JSX.Element {
  return (
    <svg width="72" height="44" viewBox="0 0 150 80" fill="none" aria-hidden="true">
      <rect x="27" y="10" width="96" height="56" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function BatteryIcon({ min, max, compact = false }: { min: number; max: number; compact?: boolean }): React.JSX.Element {
  const fillPct = Math.min(100, Math.max(4, (min + max) / 2));
  const innerW = (24 * fillPct) / 100;
  const w = compact ? 24 : 34;
  const h = compact ? 12 : 16;
  return (
    <span className={compact ? 'pcc-battery pcc-battery-sm' : 'pcc-battery'} aria-hidden="true">
      <svg width={w} height={h} viewBox="0 0 34 16" fill="none">
        <rect x="1" y="2" width="28" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
        <rect x="30" y="5.5" width="3" height="5" rx="1" fill="currentColor" />
        <rect x="2.8" y="3.8" width={innerW} height="8.4" rx="1.5" fill="var(--pass)" />
      </svg>
    </span>
  );
}

function SpecIcon({ kind }: { kind: 'cpu' | 'display' | 'supply' }): React.JSX.Element {
  if (kind === 'cpu') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (kind === 'display') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * One search hit — details fill the left; thumb and price stack top-right.
 */
export function SearchResultCard({ r }: { r: SearchResult }): React.JSX.Element {
  const measured = r.batteryMeasured > 0 && r.batteryMin !== null && r.batteryMax !== null;
  const batteryLabel = measured
    ? r.batteryMin === r.batteryMax
      ? `${r.batteryMin}%`
      : `${r.batteryMin}–${r.batteryMax}%`
    : null;
  const storageShort = storageShortLabel(r.storageType);
  const hasQuickSpecs = r.ramGb > 0 && r.storageGb > 0 && storageShort !== null;

  return (
    <a className="pcc" href={`/laptops/${r.skuId}?grade=${r.grade}`}>
      <div className="pcc-mid">
        <div className="pcc-body">
          <div className="pcc-head">
            <b className="pcc-title">
              {r.brand} {r.model}
            </b>
            <div className="pcc-metrics">
              <span className={`pcc-m-grade mono tone-${gradePillTone(r.grade)}`}>
                Grade {GRADE_CODE[r.grade] ?? r.grade}
              </span>
              <span className="pcc-m-sep" aria-hidden="true">
                ·
              </span>
              {r.avgQcScore === null ? (
                <span className="pcc-m-score pcc-notmeasured">Score not measured</span>
              ) : (
                <span className="pcc-m-score">
                  <span className="mono">
                    Score {r.avgQcScore}
                    <span className="pcc-denom">/100</span>
                  </span>
                  <span className="pcc-bar pcc-bar-sm" aria-hidden="true">
                    <i
                      className={`tone-${scoreBarTone(r.avgQcScore, r.grade)}`}
                      style={{ width: `${r.avgQcScore}%` }}
                    />
                  </span>
                </span>
              )}
              <span className="pcc-m-sep" aria-hidden="true">
                ·
              </span>
              {batteryLabel === null ? (
                <span className="pcc-m-bat pcc-notmeasured">Battery not measured</span>
              ) : (
                <span className="pcc-m-bat">
                  <span className="mono">Battery {batteryLabel}</span>
                  <BatteryIcon min={r.batteryMin!} max={r.batteryMax!} compact />
                </span>
              )}
            </div>
          </div>
          <div className="pcc-quick">
            {hasQuickSpecs ? (
              <>
                <span>
                  <SpecIcon kind="cpu" />
                  <span className="mono">{r.ramGb}GB RAM</span>
                </span>
                <span>
                  <SpecIcon kind="display" />
                  <span className="mono">
                    {r.storageGb}GB {storageShort}
                  </span>
                </span>
              </>
            ) : (
              <span className="mono">{r.spec}</span>
            )}
          </div>
          <div className="pcc-details">
            <div className="pcc-detail">
              <SpecIcon kind="cpu" />
              <span>{r.cpuLine}</span>
            </div>
            <div className="pcc-detail">
              <SpecIcon kind="display" />
              <span>{r.displayLine || <span className="pcc-notmeasured">Display not published</span>}</span>
            </div>
          </div>
        </div>
        <div className="pcc-aside">
          <div className="pcc-thumb">
            <LaptopThumb />
          </div>
          <div className="pcc-price">
            <span className="mono">₹{RUPEES.format(r.fromPrice)}</span>
            <small>from · incl. GST</small>
          </div>
        </div>
      </div>

      <div className="pcc-specs">
        <div className="pcc-spec">
          <SpecIcon kind="supply" />
          <span>
            <b className="mono">{r.supplyPoints}</b> supply point{r.supplyPoints === 1 ? '' : 's'} ·{' '}
            {r.cities.join(', ')} · <span className="mono">{r.unitsAvailable} sealed</span>
          </span>
        </div>
      </div>
    </a>
  );
}
