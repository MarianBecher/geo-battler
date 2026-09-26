// Place names for the coordinates of a round.
//
// Without them the reveal only shows pins - the "ah, Uruguay!" is missing.
// Reverse geocoding provides the name, asked once per *round*, not per
// player: a five-round game costs five requests. The Geocoding API counts as
// Essentials (10,000 requests per month for free), so the game comfortably
// stays inside the free tier.
//
// Failures are never serious here: without a label the reveal shows the
// coordinates and the game carries on unchanged.

import type { LatLng, Place } from '@geo-battler/shared';
import { env } from './env.ts';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// If the Geocoding API is not enabled for the key, stop asking for a while -
// otherwise every game runs into the same error again. But only for a while:
// whoever enables it in the Cloud Console should not have to restart the
// server for that.
const COOLDOWN_MS = 5 * 60 * 1000;
let mutedUntil = 0;

// From fine to coarse - the first hit wins.
const PLACE_TYPES = ['locality', 'postal_town', 'administrative_area_level_3', 'administrative_area_level_2'];

interface AddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

interface GeocodeResult {
  address_components?: AddressComponent[];
}

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: GeocodeResult[];
}

/**
 * Finds the first address component of this type - across all results. The
 * first result is often a house number; the coarser names come later.
 */
function componentOf(results: GeocodeResult[], type: string): AddressComponent | null {
  for (const result of results) {
    const hit = (result.address_components ?? []).find((c) => c.types?.includes(type));
    if (hit) return hit;
  }
  return null;
}

export function labelFrom(results: GeocodeResult[]): Place | null {
  const place = PLACE_TYPES.map((t) => componentOf(results, t)).find(Boolean) ?? null;
  const region = componentOf(results, 'administrative_area_level_1');
  const country = componentOf(results, 'country');
  if (!country && !place) return null;

  // "Montevideo, Montevideo, Uruguay" reads silly - drop duplicates.
  const parts: string[] = [];
  for (const part of [place, region, country]) {
    const name = part?.long_name?.trim();
    if (name && !parts.includes(name)) parts.push(name);
  }
  if (!parts.length) return null;

  return { label: parts.join(', '), countryCode: country?.short_name ?? null };
}

/**
 * Place name for a point - or `null` when Google knows nothing (sea, desert)
 * or is not cooperating right now.
 */
export async function describePlace({ lat, lng }: LatLng, apiKey: string): Promise<Place | null> {
  if (Date.now() < mutedUntil || !apiKey) return null;

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('language', env.geocodeLanguage);
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as GeocodeResponse;

    if (data.status === 'OK') return labelFrom(data.results ?? []);
    if (data.status === 'ZERO_RESULTS') return null; // middle of the ocean

    // REQUEST_DENIED means: API not enabled, or the key's API restriction
    // does not allow Geocoding. Both need a human, so we stop asking for a while.
    if (data.status === 'REQUEST_DENIED') {
      mutedUntil = Date.now() + COOLDOWN_MS;
      console.warn(`[geocode] place names paused: ${data.error_message ?? 'REQUEST_DENIED'}`);
      console.warn('[geocode] Enable the Geocoding API AND add it to the API restriction of the server key. No restart needed, it will be retried shortly.');
    }
    return null;
  } catch (err) {
    console.warn(`[geocode] ${lat.toFixed(3)},${lng.toFixed(3)}: ${(err as Error).message}`);
    return null;
  }
}

/** A location the search found, with its place name once known. */
export interface Located extends LatLng {
  panoId: string;
  place?: Place | null;
}

/**
 * Attaches a name to every location (`loc.place`). Runs in parallel and
 * never throws - a game must not fail over a place name.
 */
export async function attachPlaces(locations: Located[], apiKey: string): Promise<Located[]> {
  await Promise.all(locations.map(async (loc) => {
    // The location search sometimes asked already (country check for a pack).
    if (loc.place === undefined) loc.place = await describePlace(loc, apiKey);
  }));
  return locations;
}
