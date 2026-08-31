import * as React from 'react';

export interface Resource<T> {
  /** Null while loading *and* on failure — check `error` first. */
  data: T | null;
  error: string | null;
}

/**
 * One GET per screen, cancelled on unmount.
 *
 * Extracted because the catalog screens would otherwise be the third, fourth and
 * fifth copy of the same effect. The cancelled flag is the part worth having in
 * one place: a route left mid-flight otherwise sets state on a dead component,
 * and the warning that produces is one nobody reads until it hides a real bug.
 */
export function useResource<T>(url: string, failureLabel: string): Resource<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // T43. Both are cleared before the new request, and both used to survive it.
    //
    // `error` surviving was the worse of the two: every caller checks `error`
    // first, so one transient 500 pinned "did not load" on the screen for the
    // rest of the session — changing the filter refetched, succeeded, set
    // `data`, and the board still refused to render because the old failure was
    // still there. `data` surviving was quieter and no more honest: a board kept
    // showing the previous filter's rows while the new ones were in flight, with
    // nothing on screen saying they were stale. A skeleton is the true answer to
    // "what matches this filter?" until the server has said.
    setData(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`${failureLabel} (${res.status})`);
        const d = (await res.json()) as T;
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, failureLabel]);

  return { data, error };
}
