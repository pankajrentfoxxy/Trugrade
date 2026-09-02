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

interface ParsedSpec {
  cpu: string;
  ramLabel: string | null;
  storageLabel: string | null;
  screen: string;
}

/** `Core i5 · 16 GB · 512 GB NVME_SSD · 14"` — the catalog's one-line summary. */
export function parseSpecSummary(spec: string): ParsedSpec | null {
  const parts = spec.split(' · ').map((s) => s.trim());
  if (parts.length < 4) return null;
  const [cpu, ramPart, storagePart, screen] = parts as [string, string, string, string];
  const ramMatch = /^(\d+)\s*GB$/i.exec(ramPart);
  const storageMatch = /^(\d+)\s*GB(?:\s+(\S+))?$/i.exec(storagePart);
  const ramLabel = ramMatch ? `${ramMatch[1]}GB RAM` : null;
  let storageLabel: string | null = null;
  if (storageMatch) {
    const storageType = storageMatch[2];
    const short = storageType
      ? (STORAGE_SHORT[storageType] ?? storageType.replace(/_/g, ' '))
      : null;
    storageLabel = short ? `${storageMatch[1]}GB ${short}` : `${storageMatch[1]}GB`;
  }
  return { cpu, ramLabel, storageLabel, screen };
}

export function gradePillTone(grade: string): 'aplus' | 'a' | 'b' {
  if (grade === 'A_PLUS') return 'aplus';
  if (grade === 'A') return 'a';
  return 'b';
}

/** Server sends lowercase — show it the way the offers grid does. */
export function formatDispatch(raw: string): string {
  const match = /^ships in (\d+)\s*h$/i.exec(raw.trim());
  if (match) return `Ships in ${match[1]}h`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function SpecIcon({ kind }: { kind: 'cpu' | 'display' | 'supply' }): React.JSX.Element {
  if (kind === 'cpu') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3"
          stroke="currentColor"
          strokeWidth="1.6"
        />
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

export function ClockIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4.5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BoxIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 12v8M4 8.5 12 12l8-3.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * Left column of a cart or checkout line — title, grade, spec rows and optional
 * green meta rows beneath.
 */
export function ProductLineIdentity({
  title,
  grade,
  specSummary,
  pass,
}: {
  title: string;
  grade: string;
  specSummary: string;
  pass?: React.ReactNode;
}): React.JSX.Element {
  const parsed = parseSpecSummary(specSummary);
  const hasQuickSpecs = parsed?.ramLabel !== null && parsed?.storageLabel !== null;

  return (
    <>
      <b className="cartline-title">{title}</b>
      <div className="cartline-metrics">
        <span className={`cartline-grade mono tone-${gradePillTone(grade)}`}>
          Grade {GRADE_CODE[grade] ?? grade}
        </span>
      </div>
      {parsed ? (
        <>
          <div className="cartline-quick">
            {hasQuickSpecs ? (
              <>
                <span>
                  <SpecIcon kind="cpu" />
                  <span className="mono">{parsed.ramLabel}</span>
                </span>
                <span>
                  <SpecIcon kind="display" />
                  <span className="mono">{parsed.storageLabel}</span>
                </span>
              </>
            ) : (
              <span className="mono">{parsed.cpu}</span>
            )}
          </div>
          <div className="cartline-details">
            <div className="cartline-detail">
              <SpecIcon kind="cpu" />
              <span>{parsed.cpu}</span>
            </div>
            <div className="cartline-detail">
              <SpecIcon kind="display" />
              <span className="mono">{parsed.screen}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="cartline-fallback mono">{specSummary}</p>
      )}
      {pass ? <div className="cartline-pass">{pass}</div> : null}
    </>
  );
}

export function ProductLinePassRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="cartline-pass-row">
      {icon}
      <span>{children}</span>
    </div>
  );
}
