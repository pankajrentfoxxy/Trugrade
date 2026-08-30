'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { DataBoard, EmptyState, StatusPill, type Column, type SortDirection } from '@trugrade/ui';
import type { ApiFailure } from '../../register/api';
import {
  CLAIM_STATUS,
  getClaims,
  getWarrantyRegister,
  type ClaimView,
  type CoveredMachine,
  type WarrantyRegister,
} from './api';

/**
 * The warranty register. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash.
 *
 * Board state is not client state: it arrives as `query` from the server, which
 * read it off the URL, and every control pushes the router.
 */

/* ==========================================================================
 * The three states a machine's cover can be in
 * ======================================================================== */

type CoverState = 'covered' | 'expiring' | 'expired' | 'not-started';

/**
 * Which of the three (four, counting "expiring soon") a row is in.
 *
 * **Read off the server's verdict, never re-derived.** `inWarranty` and
 * `expiringSoon` are fields on the payload for exactly this reason; a
 * `new Date(cover.endDate) > new Date()` here would be a second, wrong clock.
 */
const coverState = (m: CoveredMachine): CoverState => {
  if (m.cover === null) return 'not-started';
  if (!m.cover.inWarranty) return 'expired';
  return m.cover.expiringSoon ? 'expiring' : 'covered';
};

const FILTERS: ReadonlyArray<{ key: string; label: string; match: (s: CoverState) => boolean }> = [
  { key: '', label: 'All machines', match: () => true },
  { key: 'covered', label: 'In warranty', match: (s) => s === 'covered' || s === 'expiring' },
  { key: 'expiring', label: 'Ends within 30 days', match: (s) => s === 'expiring' },
  { key: 'expired', label: 'Out of warranty', match: (s) => s === 'expired' },
  { key: 'pending', label: 'Not delivered yet', match: (s) => s === 'not-started' },
];

/**
 * What each sortable column reads off a row.
 *
 * A machine with no cover sorts to the END in both directions, for the reason
 * `UnitsBoard` gives about a battery that was never read: it is not the soonest
 * to expire and it is not the latest either, and putting it at either end
 * answers a question the data cannot answer.
 */
const SORT_VALUES = {
  serial: (m: CoveredMachine): string => m.serialNumber,
  ends: (m: CoveredMachine): number | null =>
    m.cover === null ? null : Number(m.cover.endDate.replace(/-/g, '')),
  remaining: (m: CoveredMachine): number | null => m.cover?.daysRemaining ?? null,
  ordered: (m: CoveredMachine): number => Number(m.orderedOn.replace(/-/g, '')),
} as const;

type SortKey = keyof typeof SORT_VALUES;
const isSortKey = (v: string): v is SortKey => v in SORT_VALUES;

const SORT_CAPTION: Record<SortKey, string> = {
  serial: 'serial number',
  ends: 'the date cover ends',
  remaining: 'days of cover left',
  ordered: 'order date',
};

function compare(a: CoveredMachine, b: CoveredMachine, key: SortKey, dir: SortDirection): number {
  const av = SORT_VALUES[key](a);
  const bv = SORT_VALUES[key](b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const base = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
  return dir === 'desc' ? -base : base;
}

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: WarrantyRegister; claims: ClaimView[] };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not read your warranty register just now. That is our problem, not yours — nothing about your cover has changed.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function WarrantyBoard({ query }: { query: string }): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      // Two calls rather than one endpoint returning both: the register is the
      // asset-shaped view and the claim list is the work-shaped one, and a
      // claims outage must not take the register down with it.
      const [register, claims] = await Promise.all([getWarrantyRegister(), getClaims()]);
      if (!live) return;
      if (register.ok) {
        setPhase({ k: 'ready', data: register.data, claims: claims.ok ? claims.data.claims : [] });
      } else if (register.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(register) });
    })();
    return () => {
      live = false;
    };
  }, []);

  const commit = React.useCallback(
    (next: URLSearchParams): void => {
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it.
      router.push((qs ? `/account/warranty?${qs}` : '/account/warranty') as Route, {
        scroll: false,
      });
    },
    [router],
  );

  const setValue = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    commit(next);
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const data = phase.k === 'ready' ? phase.data : null;
  const claims = phase.k === 'ready' ? phase.claims : [];
  const all = data?.machines ?? [];

  const show = params.get('show') ?? '';
  const active = FILTERS.find((f) => f.key === show) ?? FILTERS[0]!;
  const sortParam = params.get('sort') ?? 'ends';
  const sortKey: SortKey = isSortKey(sortParam) ? sortParam : 'ends';
  const direction: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const rows = all
    .filter((m) => active.match(coverState(m)))
    .sort((a, b) => compare(a, b, sortKey, direction));

  const onSort = (key: string): void => {
    if (!isSortKey(key)) return;
    const next = new URLSearchParams(params);
    next.set('sort', key);
    next.set('dir', sortKey === key && direction === 'asc' ? 'desc' : 'asc');
    commit(next);
  };

  return (
    <>
      <div className="wshead wthead">
        <h1>Warranty</h1>
        <p>
          Every machine your organisation owns, and how long we cover it for. Cover starts the day a
          machine reaches you, not the day you ordered it — so a laptop still in transit shows no
          term yet rather than a term already running down.
        </p>
      </div>

      <Summary machines={all} claims={claims} loading={data === null} />

      <div className="rbar wtbar">
        <span className="cnt">
          {data === null ? (
            <span className="ink4">Reading your cover…</span>
          ) : (
            <>
              <b className="mono">{rows.length}</b> of <b className="mono">{all.length}</b>{' '}
              {all.length === 1 ? 'machine' : 'machines'}
            </>
          )}
        </span>

        <div className="wtfilters" role="group" aria-label="Filter by cover">
          {FILTERS.map((f) => {
            const count = all.filter((m) => f.match(coverState(m))).length;
            const on = f.key === show;
            return (
              <button
                key={f.key || 'all'}
                type="button"
                className={on ? 'chipf on' : 'chipf'}
                aria-pressed={on}
                onClick={() => setValue('show', f.key)}
                // Disabled only when it is NOT the current filter: a chip that
                // is both active and disabled reads as broken.
                disabled={data !== null && count === 0 && !on}
              >
                {f.label} <span className="mono">{data === null ? '—' : count}</span>
              </button>
            );
          })}
        </div>

        <a className="pill acc wtclaim" href="/account/warranty/claims/new">
          Start a claim
        </a>
      </div>

      <div className="tbl wttable">
        <DataBoard
          caption={
            data === null
              ? 'Reading your warranty register.'
              : `${rows.length} of ${all.length} machines, sorted by ${SORT_CAPTION[sortKey]}, ${
                  direction === 'asc' ? 'soonest first' : 'latest first'
                }.`
          }
          columns={COLUMNS}
          rows={rows}
          rowKey={(m) => m.serialNumber}
          sort={{ key: sortKey, direction }}
          onSort={onSort}
          loading={data === null}
          skeletonRows={6}
          empty={
            show === '' ? (
              <EmptyState
                title="You have not bought any machines yet"
                body="Warranty cover appears here the moment your first order is delivered — one line per serial, with the exact date it ends."
                action={
                  <a className="pill acc" href="/search">
                    Browse laptops
                  </a>
                }
              />
            ) : (
              <EmptyState
                title={`Nothing matches "${active.label}"`}
                body={
                  <>
                    You own <span className="mono">{all.length}</span>{' '}
                    {all.length === 1 ? 'machine' : 'machines'}, and none of them is in that state
                    today.
                  </>
                }
                action={
                  <button type="button" className="pill wire" onClick={() => setValue('show', '')}>
                    Show all machines
                  </button>
                }
              />
            )
          }
        />
      </div>

      {data && <Terms terms={data.terms} asOf={data.asOf} />}
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

const COLUMNS: readonly Column<CoveredMachine>[] = [
  {
    key: 'serial',
    header: 'Serial',
    sortable: true,
    cell: (m) => (
      <div className="ubid">
        <a className="mono ubserial" href={m.passportPath}>
          {m.serialNumber}
        </a>
        <span className="ubtitle">
          {m.title ?? <span className="notmeasured">Model no longer catalogued</span>}
        </span>
        {m.specSummary && <span className="ubspec">{m.specSummary}</span>}
      </div>
    ),
  },
  {
    key: 'order',
    header: 'Order',
    cell: (m) => (
      <div className="wtorder">
        <a className="mono" href={`/account/orders/${encodeURIComponent(m.orderNumber)}`}>
          {m.orderNumber}
        </a>
        <span className="ubspec">
          ordered <span className="mono">{m.orderedOn}</span>
        </span>
      </div>
    ),
  },
  {
    key: 'cover',
    header: 'Cover',
    cell: (m) =>
      // A term that has not begun is NOT an expiry and NOT a zero. Saying so in
      // words, in `--ink-4`, is the whole point of this column.
      m.cover === null ? (
        <span className="notmeasured">Cover starts on delivery</span>
      ) : (
        <div className="wtcover">
          <span className="wtterm">
            <b className="mono">{m.cover.totalMonths}</b> months
          </span>
          <span className="ubspec">
            <span className="mono">{m.cover.startDate}</span> to{' '}
            <span className="mono">{m.cover.endDate}</span>
          </span>
        </div>
      ),
  },
  {
    key: 'ends',
    header: 'Ends',
    numeric: true,
    sortable: true,
    cell: (m) =>
      m.cover === null ? (
        <span className="notmeasured">Not started</span>
      ) : (
        <span className="mono">{m.cover.endDate}</span>
      ),
  },
  {
    key: 'remaining',
    header: 'Cover left',
    numeric: true,
    sortable: true,
    cell: (m) => {
      if (m.cover === null) return <span className="notmeasured">—</span>;
      // A term ending is not a FAIL. Neutral ink and the date, never red.
      if (!m.cover.inWarranty) return <span className="wtover">Ended</span>;
      // Amber as a MEASURED VALUE, which is one of its three permitted meanings.
      // The denominator is the term, because "19 days" alone is a number without
      // a claim attached to it.
      return (
        <span className={m.cover.expiringSoon ? 'wtleft soon' : 'wtleft'}>
          <b className="mono">{m.cover.daysRemaining}</b>
          <span className="denom"> days left of {m.cover.totalMonths} months</span>
        </span>
      );
    },
  },
  {
    key: 'claim',
    header: 'Claim',
    cell: (m) => {
      if (m.openClaim) {
        const status = CLAIM_STATUS[m.openClaim.status] ?? {
          label: m.openClaim.status,
          tone: 'neutral' as const,
        };
        return (
          <a
            className="wtclaimlink"
            href={`/account/warranty/claims/${encodeURIComponent(m.openClaim.claimNumber)}`}
          >
            <span className="mono">{m.openClaim.claimNumber}</span>
            <StatusPill tone={status.tone} label={status.label} />
          </a>
        );
      }
      if (m.cover === null) {
        return <span className="notmeasured">Not yet</span>;
      }
      if (!m.cover.inWarranty) {
        // Not a dead end. §4.6 requires the expiry to come with a way forward.
        return (
          <a className="wtpaid" href="/account/support">
            Ask for a paid repair
          </a>
        );
      }
      return (
        <a
          className="wtstart"
          href={`/account/warranty/claims/new?serial=${encodeURIComponent(m.serialNumber)}`}
        >
          Start a claim
          <span className="sr-only"> for {m.serialNumber}</span>
        </a>
      );
    },
  },
];

/* ==========================================================================
 * The figures — every one with its denominator
 * ======================================================================== */

function Summary({
  machines,
  claims,
  loading,
}: {
  machines: readonly CoveredMachine[];
  claims: readonly ClaimView[];
  loading: boolean;
}): React.JSX.Element {
  const total = machines.length;
  const covered = machines.filter((m) => m.cover?.inWarranty === true).length;
  const expiring = machines.filter((m) => m.cover?.expiringSoon === true).length;
  const pending = machines.filter((m) => m.cover === null).length;
  const openClaims = claims.filter((c) => c.status !== 'CLOSED' && c.status !== 'REJECTED').length;

  return (
    <dl className="ubkpi wtkpi">
      <Figure label="Machines" value={loading ? null : String(total)} denominator="you own" />
      <Figure
        label="In warranty"
        value={loading ? null : String(covered)}
        denominator={loading ? '' : `of ${total}`}
      />
      <Figure
        label="Ends within 30 days"
        value={loading ? null : String(expiring)}
        denominator={loading ? '' : `of ${covered} covered`}
      />
      <Figure
        label="Awaiting delivery"
        value={loading ? null : String(pending)}
        denominator={loading ? '' : `of ${total}`}
      />
      <Figure
        label="Open claims"
        value={loading ? null : String(openClaims)}
        denominator={loading ? '' : `of ${claims.length} raised`}
      />
    </dl>
  );
}

function Figure({
  label,
  value,
  denominator,
}: {
  label: string;
  value: string | null;
  denominator: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span className="notmeasured">—</span>
        ) : (
          <span className="mono ubfig">{value}</span>
        )}
        {denominator && value !== null && <span className="denom"> {denominator}</span>}
      </dd>
    </div>
  );
}

/* ==========================================================================
 * What is covered, and what is not — said before anyone has to claim
 * ======================================================================== */

function Terms({
  terms,
  asOf,
}: {
  terms: WarrantyRegister['terms'];
  asOf: string;
}): React.JSX.Element {
  return (
    <section className="wtterms" aria-labelledby="wtterms-h">
      <h2 id="wtterms-h">What the cover is</h2>
      <div className="wttermsgrid">
        <div>
          <h3>Covered</h3>
          <ul>
            {terms.covers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Not covered</h3>
          <ul className="off">
            {terms.excludes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="fnote off">
        Terms version <span className="mono">{terms.version}</span>. Every term above was reckoned
        against <span className="mono">{asOf}</span> on our clock, not your browser&rsquo;s. You
        deal only with us for the whole term — there is no supplier for you to chase, because we are
        the seller.
      </p>
    </section>
  );
}

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your warranty cover"
        body="Cover belongs to the organisation that bought the machines, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a className="pill acc" href={`/sign-in?next=${encodeURIComponent('/account/warranty')}`}>
            Sign in
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not read your warranty register</h3>
        <p>{message}</p>
        <p>
          Your cover is unaffected — this is a screen that could not load, not a term that changed.
        </p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
