import * as React from 'react';
import { refreshSession } from '../lib/auth';
import { API, type DashboardTiles } from '../routes/vendor/api';

export interface VendorCounts {
  liveListings?: number;
  openVisits?: number;
  openCorrections?: number;
  unacknowledgedPos?: number;
  awaitingDispatch?: number;
  netDue?: string;
  memberCount?: number;
}

const CACHE_MS = 60_000;

interface Cache {
  at: number;
  value: VendorCounts;
}

let cache: Cache | null = null;
let inflight: Promise<VendorCounts> | null = null;

async function loadCounts(): Promise<VendorCounts> {
  if (cache && performance.now() - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      let res = await fetch(API.dashboard, { credentials: 'include' });
      if (res.status === 401) {
        await refreshSession();
        res = await fetch(API.dashboard, { credentials: 'include' });
      }
      if (!res.ok) return {};
      const data = (await res.json()) as DashboardTiles;
      const value: VendorCounts = {};
      // Dashboard has units, not listings. A live-unit count is not a listing
      // count — omit rather than dress one as the other.
      const corrections = data.queues?.gradeCorrections?.count;
      if (typeof corrections === 'number') value.openCorrections = corrections;
      if (typeof data.payoutsDue === 'string') value.netDue = data.payoutsDue;
      cache = { at: performance.now(), value };
      return value;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

const VendorCountsContext = React.createContext<VendorCounts | undefined>(undefined);

export function VendorCountsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [counts, setCounts] = React.useState<VendorCounts | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void loadCounts().then((value) => {
      if (!cancelled) setCounts(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return React.createElement(VendorCountsContext.Provider, { value: counts }, children);
}

export function useVendorCounts(): VendorCounts | undefined {
  return React.useContext(VendorCountsContext);
}
