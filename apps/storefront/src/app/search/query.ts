/** Params the API does not read, so they never reach it as a filter. */
export const CLIENT_ONLY = new Set(['view', 'pin']);

export function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) if (v !== '') qs.append(key, v);
  }
  return qs.toString();
}

export function toApiQueryString(params: Record<string, string | string[] | undefined>): string {
  const apiQuery = new URLSearchParams(toQueryString(params));
  for (const key of CLIENT_ONLY) apiQuery.delete(key);
  return apiQuery.toString();
}
