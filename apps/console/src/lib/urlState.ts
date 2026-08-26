import { useSearchParams } from 'react-router';

/**
 * One board filter, held in the query string instead of in `useState`.
 *
 * CLAUDE.md: "Board state lives in the URL — filters, sort, page. A buyer must
 * be able to send a colleague a link." That is also what makes the vendor
 * dashboard's tiles work: every one of them is a link to a filtered board, and
 * a filter that cannot be linked to is a filter no tile can reach.
 *
 * `replace: true` because typing in a filter box should not fill the back
 * button with one entry per keystroke — Back leaves the board, as it reads.
 *
 * A value equal to the default is *removed* rather than written, so the URL of
 * an untouched board is clean and two people who cleared the same filter share
 * one link rather than two.
 */
export function useUrlState(
  key: string,
  fallback = '',
): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;

  const set = (next: string): void => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === fallback || next === '') out.delete(key);
        else out.set(key, next);
        return out;
      },
      { replace: true },
    );
  };

  return [value, set];
}
