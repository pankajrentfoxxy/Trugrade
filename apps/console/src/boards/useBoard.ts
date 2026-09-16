import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { BoardEnvelope } from '@trugrade/contracts';
import { useResource } from '../lib/useResource';

/**
 * Board state, in the URL.
 *
 * CLAUDE.md: "Board state lives in the URL — filters, sort, page. A buyer must
 * be able to send a colleague a link." `useUrlState` already does this for one
 * key; a board needs six or more at once, and every board needs the same rule
 * that three of the five hand-written boards had and the other two did not:
 *
 * **Any change other than the page itself resets the page to 1.** Filtering a
 * 32-page board while standing on page 8 otherwise lands you on an empty page 8
 * of a 2-page result, which reads as "no results" for a filter that matched
 * plenty. Centralised here so the next board cannot forget it.
 */

const PAGE_KEY = 'page';

export interface BoardState {
  view: string;
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  facets: Record<string, string>;
  density: 'default' | 'compact';
}

export interface BoardHandle<Row> {
  state: BoardState;
  data: BoardEnvelope<Row> | null;
  error: string | null;
  /** The query string the board is currently asking for, for export links. */
  query: string;
  set: (patch: Partial<Omit<BoardState, 'facets'>> & { facets?: Record<string, string> }) => void;
  clearFilters: () => void;
  /** True when anything other than the view is narrowing the board. */
  filtered: boolean;
  reload: () => void;
}

export function useBoard<Row>(
  endpoint: string,
  facetKeys: readonly string[],
  defaultDensity: 'default' | 'compact' = 'compact',
): BoardHandle<Row> {
  const [params, setParams] = useSearchParams();
  const [reloadToken, setReloadToken] = useState(0);

  const facets = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of facetKeys) {
      const value = params.get(`facet.${key}`);
      if (value) out[key] = value;
    }
    return out;
  }, [params, facetKeys]);

  const state: BoardState = useMemo(() => {
    const dir = params.get('dir');
    const density = params.get('density');
    return {
      view: params.get('view') ?? '',
      q: params.get('q') ?? '',
      sort: params.get('sort') ?? '',
      dir: dir === 'asc' ? 'asc' : 'desc',
      page: Math.max(1, Number(params.get(PAGE_KEY)) || 1),
      facets,
      density: density === 'default' ? 'default' : defaultDensity,
    };
  }, [params, facets, defaultDensity]);

  const set = useCallback<BoardHandle<Row>['set']>(
    (patch) => {
      const next = new URLSearchParams(params);
      const touchesFilter = Object.keys(patch).some((k) => k !== PAGE_KEY);

      for (const [key, value] of Object.entries(patch)) {
        if (key === 'facets') continue;
        if (value === undefined || value === '' || value === null) next.delete(key);
        else next.set(key, String(value));
      }
      if (patch.facets) {
        for (const [key, value] of Object.entries(patch.facets)) {
          if (value) next.set(`facet.${key}`, value);
          else next.delete(`facet.${key}`);
        }
      }
      if (touchesFilter && patch.page === undefined) next.delete(PAGE_KEY);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete(PAGE_KEY);
    for (const key of facetKeys) next.delete(`facet.${key}`);
    setParams(next, { replace: true });
  }, [params, setParams, facetKeys]);

  // Only the parameters the server reads, in a stable order, so an unrelated
  // query parameter (a drawer's `record=`, say) does not refetch the board.
  const query = useMemo(() => {
    const out = new URLSearchParams();
    if (state.view) out.set('view', state.view);
    if (state.q) out.set('q', state.q);
    if (state.sort) {
      out.set('sort', state.sort);
      out.set('dir', state.dir);
    }
    if (state.page > 1) out.set('page', String(state.page));
    for (const key of [...facetKeys].sort()) {
      if (state.facets[key]) out.set(`facet.${key}`, state.facets[key] as string);
    }
    return out.toString();
  }, [state, facetKeys]);

  const { data, error } = useResource<BoardEnvelope<Row>>(
    query ? `${endpoint}?${query}` : endpoint,
    'We could not load this board.',
    reloadToken,
  );

  // A stale bookmark can name a page the filtered result no longer has. The
  // server clamps it; this puts the URL back in step so a refresh is honest.
  useEffect(() => {
    if (data && state.page > data.pages) set({ page: data.pages });
  }, [data, state.page, set]);

  return {
    state,
    data,
    error,
    query,
    set,
    clearFilters,
    filtered: Boolean(state.q) || Object.values(state.facets).some(Boolean),
    reload: useCallback(() => setReloadToken((n) => n + 1), []),
  };
}
