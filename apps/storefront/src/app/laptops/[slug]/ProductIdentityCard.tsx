import type { OfferBoard, SkuDetail } from '../../../lib/api';
import { specRows } from './spec-rows';

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

type ScoreTone = 'fail' | 'warn' | 'b' | 'a' | 'aplus';

function storageShortLabel(storageType: string | undefined): string | null {
  if (!storageType) return null;
  return STORAGE_SHORT[storageType] ?? storageType.replace(/_/g, ' ');
}

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

function boardMetrics(board: OfferBoard): {
  avgQcScore: number | null;
  batteryMin: number | null;
  batteryMax: number | null;
  batteryMeasured: number;
  cities: string[];
} {
  const scores = board.offers.flatMap((o) =>
    o.quality.kind === 'SCORE' ? [o.quality.avgQcScore] : [],
  );
  const avgQcScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;

  const batteryValues = board.offers.flatMap((o) =>
    o.batteryHealthPct ? [o.batteryHealthPct.min, o.batteryHealthPct.max] : [],
  );
  const batteryMeasured = board.offers.reduce((n, o) => n + o.batteryMeasured, 0);

  return {
    avgQcScore,
    batteryMin: batteryValues.length > 0 ? Math.min(...batteryValues) : null,
    batteryMax: batteryValues.length > 0 ? Math.max(...batteryValues) : null,
    batteryMeasured,
    cities: [...new Set(board.offers.map((o) => o.city))],
  };
}

function cpuLine(sku: SkuDetail): string {
  return `${sku.cpuBrand} ${sku.cpuModel}`.trim();
}

function displayLine(sku: SkuDetail): string {
  return `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' · touch' : ''}`.trim();
}

function LaptopThumb(): React.JSX.Element {
  return (
    <svg width="72" height="44" viewBox="0 0 150 80" fill="none" aria-hidden="true">
      <rect x="27" y="10" width="96" height="56" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function BatteryIcon({ min, max }: { min: number; max: number }): React.JSX.Element {
  const fillPct = Math.min(100, Math.max(4, (min + max) / 2));
  const innerW = (24 * fillPct) / 100;
  return (
    <span className="pid-battery" aria-hidden="true">
      <svg width={24} height={12} viewBox="0 0 34 16" fill="none">
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
 * Product record identity — record-page layout with the same spec icons as search hits.
 */
export function ProductIdentityCard({
  sku,
  board,
  fromPrice,
}: {
  sku: SkuDetail;
  board: OfferBoard;
  fromPrice: string | null;
}): React.JSX.Element {
  const { avgQcScore, batteryMin, batteryMax, batteryMeasured, cities } = boardMetrics(board);
  const measured = batteryMeasured > 0 && batteryMin !== null && batteryMax !== null;
  const batteryLabel = measured
    ? batteryMin === batteryMax
      ? `${batteryMin}%`
      : `${batteryMin}–${batteryMax}%`
    : null;
  const storageShort = storageShortLabel(sku.storageType);
  const hasQuickSpecs = sku.ramGb > 0 && sku.storageGb > 0 && storageShort !== null;

  return (
    <header className="pid">
      <div className="pid-body">
        <div className="pid-main">
          <h1 className="pid-title">
            {sku.brandName} {sku.modelName}
          </h1>
          <div className="pid-metrics">
            <span className={`pid-grade mono tone-${gradePillTone(board.grade)}`}>
              Grade {GRADE_CODE[board.grade] ?? board.grade}
            </span>
            {avgQcScore !== null ? (
              <>
                <span className="pid-m-sep" aria-hidden="true">
                  ·
                </span>
                <span className="pid-m-score">
                  <span className="mono">
                    Score {avgQcScore}
                    <span className="pid-denom">/100</span>
                  </span>
                  <span className="pid-bar pid-bar-sm" aria-hidden="true">
                    <i
                      className={`tone-${scoreBarTone(avgQcScore, board.grade)}`}
                      style={{ width: `${avgQcScore}%` }}
                    />
                  </span>
                </span>
              </>
            ) : null}
            {batteryLabel !== null ? (
              <>
                <span className="pid-m-sep" aria-hidden="true">
                  ·
                </span>
                <span className="pid-m-bat">
                  <span className="mono">Battery {batteryLabel}</span>
                  <BatteryIcon min={batteryMin!} max={batteryMax!} />
                </span>
              </>
            ) : null}
          </div>
          <div className="pid-quick">
            {hasQuickSpecs ? (
              <>
                <span>
                  <SpecIcon kind="cpu" />
                  <span className="mono">{sku.ramGb}GB RAM</span>
                </span>
                <span>
                  <SpecIcon kind="display" />
                  <span className="mono">
                    {sku.storageGb}GB {storageShort}
                  </span>
                </span>
              </>
            ) : (
              <span className="mono">{cpuLine(sku)}</span>
            )}
          </div>
          <div className="pid-details">
            <div className="pid-detail">
              <SpecIcon kind="cpu" />
              <span>{cpuLine(sku)}</span>
            </div>
            <div className="pid-detail">
              <SpecIcon kind="display" />
              <span>{displayLine(sku)}</span>
            </div>
          </div>
        </div>
        <div className="pid-aside">
          <div className="pid-thumb">
            <LaptopThumb />
          </div>
          <div className="pid-price">
            <span className="mono">{fromPrice ? `₹${RUPEES.format(Number(fromPrice))}` : 'Not priced'}</span>
            <small>from · before tax &amp; delivery</small>
          </div>
        </div>
      </div>

      <div className="pid-foot">
        <SpecIcon kind="supply" />
        <span>
          <span className="mono">{sku.skuCode}</span> · HSN <span className="mono">{sku.hsnCode}</span> ·{' '}
          <b className="mono">{board.supplyPoints}</b> supply point{board.supplyPoints === 1 ? '' : 's'}
          {cities.length > 0 ? <> · {cities.join(', ')}</> : null} ·{' '}
          <span className="mono">{board.unitsAvailable} sealed</span>
        </span>
      </div>

      <details className="pid-spec">
        <summary>Specification</summary>
        <div className="pid-spec-body">
          <p className="pid-spec-note">
            As catalogued, and checked against what the tool detected at inspection
          </p>
          <dl className="pid-spec-table">
            {specRows(sku).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </header>
  );
}
