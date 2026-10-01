/**
 * "Delivery by Sat, 3 Oct" — the date a product card promises.
 *
 * Built from two facts the API sends, never from a guess:
 *   - the machine's own dispatch time (`SearchResult.shipHours`), and
 *   - the longest outbound transit to anywhere we serve
 *     (`SearchResponse.transitDaysMax`, read from logistics).
 *
 * Their sum is a date that holds whatever pincode the buyer turns out to have,
 * which is the only date a card can promise before it knows one. The product
 * page narrows it once a pincode is given. With either fact missing there is
 * no date, and the card draws no line: a missing value never renders as one.
 *
 * Days are counted on the India calendar, from today in IST.
 */
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

const LABEL = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export function deliveryByLabel(
  shipHours: number | null | undefined,
  transitDaysMax: number | null | undefined,
  now: Date = new Date(),
): string | null {
  if (shipHours === null || shipHours === undefined || shipHours < 0) return null;
  if (transitDaysMax === null || transitDaysMax === undefined || transitDaysMax < 0) return null;
  const days = Math.ceil(shipHours / 24) + transitDaysMax;
  // Midnight today in IST, expressed as a UTC instant, then whole days on.
  const istToday = Math.floor((now.getTime() + IST_MS) / DAY_MS) * DAY_MS;
  // `en-IN` writes "Sat 3 Oct"; the comma after the weekday is the house style.
  return LABEL.format(new Date(istToday + days * DAY_MS)).replace(/^(\w+)\s/, '$1, ');
}
