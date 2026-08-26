/**
 * The client-side ClockPort.
 *
 * Backoff windows, the report-freshness rule and the check-in timestamp all read
 * time, and a test that has to sleep fifteen minutes to prove the queue retries
 * is a test nobody runs. So time arrives as an argument everywhere, and the one
 * place that actually calls the platform clock is here.
 */
export type Clock = () => number;

// eslint-disable-next-line no-restricted-syntax -- the single implementation of the port
export const systemClock: Clock = () => Date.now();

/** Mints the nonce carried on every outbox row. Injected for the same reason. */
export type IdSource = () => string;

/**
 * Today, in Asia/Kolkata, as `YYYY-MM-DD`.
 *
 * `qc_visit.scheduled_date` is a DATE, and every business window in this system
 * is Indian local time. A phone whose timezone is anything else — a technician's
 * device that came back from a trip, or an emulator on UTC — would otherwise ask
 * the server for yesterday's route at 06:00 and get an empty day.
 *
 * `en-CA` is the shortest formatter that yields ISO order. It is a formatting
 * trick rather than a locale choice, which is why it is here once and not
 * repeated at four call sites.
 */
export function todayInIndia(now: Clock): string {
  return new Date(now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
