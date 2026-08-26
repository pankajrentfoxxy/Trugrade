/**
 * Every server path this app knows, in one file.
 *
 * **None of these endpoints exist yet.** The QC HTTP surface belongs to a
 * different lane of Phase 4, so these are written against the shapes
 * `PHASE_04_QC.md` Task 2 and `07 §5` describe and are the single place to
 * reconcile when that lane lands. A path spread across nine screens is nine
 * merge conflicts; a path in one file is one edit.
 *
 * The API mounts everything under `/api` with no version segment
 * (`main.ts: setGlobalPrefix('api')`), so that prefix is here rather than in the
 * base URL — a base URL is a host, and putting a path fragment in it is how a
 * staging environment ends up with `//api/api/`.
 */
export const routes = {
  /** Technician sign-in. Returns the tokens and the bound device state. */
  login: '/api/qc/technician/login',
  /** Binds this installation to the technician. Rejected if already bound elsewhere. */
  bindDevice: '/api/qc/technician/device',
  refresh: '/api/auth/refresh',

  /** Today's visits for the signed-in technician. */
  route: (date: string) => `/api/qc/technician/route?date=${encodeURIComponent(date)}`,
  /**
   * The whole visit snapshot in one call: manifest, serials, tolerance rules,
   * grade thresholds, auto-approval policy, seal roll, tool version.
   *
   * Deliberately one round trip. It is fetched at the moment the technician has
   * signal and may be the last one they get for four hours, so a design that
   * needs six calls has five chances to leave them without the rules.
   */
  manifest: (visitId: string) => `/api/qc/visits/${visitId}/manifest`,

  checkIn: (visitId: string) => `/api/qc/visits/${visitId}/check-in`,
  /** The DeviceSure ingestion endpoint. Idempotent on (provider, tool_run_id). */
  toolRuns: '/api/qc/tool-runs',
  /** Exchanges a content hash for a pre-signed PUT. EXIF is stripped server-side. */
  signPhoto: '/api/qc/photos/sign',
  photos: '/api/qc/photos',
  seals: '/api/qc/seals',
  unitResult: (visitUnitId: string) => `/api/qc/visit-units/${visitUnitId}/result`,
  absent: (visitUnitId: string) => `/api/qc/visit-units/${visitUnitId}/absent`,
  signoff: (visitId: string) => `/api/qc/visits/${visitId}/signoff`,
  expenses: (visitId: string) => `/api/qc/visits/${visitId}/expenses`,
} as const;
