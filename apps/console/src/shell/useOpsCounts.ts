import { useResource } from '../lib/useResource';

/**
 * The numbers on the rail and the tabs.
 *
 * **A count is the cheapest possible sentence.** "Fulfilment 12" says what a
 * paragraph under the heading was trying to say, in two characters, and it says
 * it from wherever the operator happens to be standing.
 *
 * One request for all of them rather than one per tab: eight requests to draw a
 * navigation rail is eight chances for the rail to render half-populated, and
 * the counts would each be from a different instant.
 *
 * A seat that cannot open a screen gets no count for it — the endpoint returns
 * only what the caller may see — so an absent number here means "not yours",
 * not "none", and the rail renders nothing rather than a zero.
 */
export function useOpsCounts(): Record<string, number> {
  const { data } = useResource<Record<string, number>>(
    '/api/ops/counts',
    'We could not load the queue counts.',
  );
  return data ?? {};
}
