/**
 * The sort options, in a plain module.
 *
 * Deliberately not exported from `ResultBar.tsx`: that file is `'use client'`,
 * and a server component importing a constant from it receives a client
 * reference proxy rather than the array — which fails at request time, not at
 * build time. Shared data crosses the boundary through a shared module.
 */
export const SORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'price', label: 'Price — Low to High' },
  { value: 'price_desc', label: 'Price — High to Low' },
  { value: 'score', label: 'Inspection score' },
  { value: 'battery', label: 'Battery health' },
  { value: 'ships', label: 'Fastest dispatch' },
  { value: 'stock', label: 'Most stock' },
];
