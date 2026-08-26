import { INDIA_BBOX } from '@trugrade/contracts';

/**
 * How far the technician checked in from the vendor's registered facility.
 *
 * The number matters: `qc_visit.geo_variance_metres` above
 * `qc.geo_variance_alert_metres` raises an anti-fraud alert, because someone
 * checking in forty kilometres from the warehouse is not at the warehouse. The
 * server computes the authoritative value; this is computed on the device so the
 * technician sees the problem while they can still walk to the right gate,
 * rather than in an exception queue on Monday.
 *
 * Haversine on a spherical earth. At these distances — hundreds of metres, not
 * hundreds of kilometres — the difference from a proper ellipsoidal formula is
 * well under a metre, which is an order of magnitude below GPS accuracy on a
 * phone next to a steel shed. A geodesic library would be more precise than the
 * measurement it is correcting.
 */
const EARTH_RADIUS_M = 6_371_000;

export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * VR-040. A fix outside India is a data problem — a stale cached location, a
 * mock-location app, or the emulator's default in Mountain View — and recording
 * it as a check-in would put a nonsense variance on the visit.
 */
export function isPlausibleIndianFix(p: { lat: number; lng: number }): boolean {
  return (
    p.lat >= INDIA_BBOX.latMin &&
    p.lat <= INDIA_BBOX.latMax &&
    p.lng >= INDIA_BBOX.lngMin &&
    p.lng <= INDIA_BBOX.lngMax
  );
}
