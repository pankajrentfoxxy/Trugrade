/**
 * The visitor's delivery location, kept in the browser.
 *
 * **Why it lives in the browser.** A guest has no address book, and a signed-in
 * buyer's sites live on the server already (`DefaultPincode.tsx` reads them).
 * This is the one thing a visitor tells us before either of those exists: the
 * pincode they want prices landed to. It is a convenience for this machine,
 * never a fact about the buyer — nothing is written to the API from it.
 *
 * **What is stored.** A pincode, the city we could name for it (or null), where
 * it came from, and when. The city is display only: the pincode is the value
 * every price is landed to, and it is the only field anything else reads.
 *
 * **Every read and write is wrapped.** `localStorage` throws in a private
 * window with site data blocked and inside some sandboxed frames; a header
 * that crashes because it could not remember a pincode is a worse header than
 * one that asks again.
 */

const KEY = 'tg-location';

/** Fired on `window` after a write or a clear, so the header pill can follow. */
export const LOCATION_CHANGED = 'trugrade:location-changed';

/** The pincode rule from `CLAUDE.md`: six digits, the first never 0. */
const PINCODE = /^[1-9][0-9]{5}$/;

export interface SavedLocation {
  pincode: string;
  /** The nearest name we could give the pincode, or null when nothing named it. */
  city: string | null;
  /** How it was set: from the browser's position, or typed. */
  source: 'geo' | 'manual';
  /** ISO 8601. */
  at: string;
}

/** `110 001` → `110001`; anything that is not a pincode → null. */
export function normalisePincode(raw: string): string | null {
  const digits = raw.replace(/\s+/g, '');
  return PINCODE.test(digits) ? digits : null;
}

export function readLocation(): SavedLocation | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLocation>;
    // A stored value that is not a pincode is treated as no value: it will
    // never be sent anywhere it could be mistaken for one.
    if (typeof parsed.pincode !== 'string' || !PINCODE.test(parsed.pincode)) return null;
    return {
      pincode: parsed.pincode,
      city: typeof parsed.city === 'string' && parsed.city ? parsed.city : null,
      source: parsed.source === 'geo' ? 'geo' : 'manual',
      at: typeof parsed.at === 'string' ? parsed.at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeLocation(next: Omit<SavedLocation, 'at'>): SavedLocation {
  const saved: SavedLocation = { ...next, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Nothing to do: the pill still shows it for this page, it just will not
    // be there next time.
  }
  window.dispatchEvent(new CustomEvent(LOCATION_CHANGED));
  return saved;
}

export function clearLocation(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // See `writeLocation`.
  }
  window.dispatchEvent(new CustomEvent(LOCATION_CHANGED));
}

/** What the reverse geocoder could say about a position. */
export interface GeocodedPlace {
  pincode: string;
  city: string | null;
}

/**
 * A position → the pincode under it, via OpenStreetMap's Nominatim.
 *
 * Called from the browser, not the API: the position is the visitor's and it
 * stays on their machine, and the one thing we need back is a pincode they
 * could have typed. Nominatim's usage policy asks for an identifying
 * User-Agent, which the browser sets, and for no more than one request a
 * second, which one click per visitor is comfortably under.
 *
 * Resolves to null when the service answers without an Indian pincode — a
 * position at sea, abroad, or on a road the map has no postcode for. That is
 * the caller's cue to ask for a typed one, not an error.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodedPlace | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', lat.toFixed(6));
  url.searchParams.set('lon', lng.toFixed(6));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
  if (!res.ok) throw new Error(`Reverse geocode failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    address?: Record<string, string | undefined>;
  };
  const a = body.address ?? {};
  const pincode = normalisePincode(a.postcode ?? '');
  if (!pincode) return null;
  const city =
    a.city ?? a.town ?? a.village ?? a.suburb ?? a.state_district ?? a.county ?? a.state ?? null;
  return { pincode, city };
}
