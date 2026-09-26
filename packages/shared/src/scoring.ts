// GeoGuessr-compatible distance and scoring. Pure math, used by the server
// to score guesses and by the client to explain the curve.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Diagonal of the world map in km - the value GeoGuessr normalises its scoring curve with for "World". */
const WORLD_MAP_SIZE_KM = 14916.862;

export const MAX_POINTS = 5000;

/** Closer than this counts as a perfect hit. */
const PERFECT_THRESHOLD_KM = 0.025;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points for a distance: 5,000 at the spot, decaying exponentially, 0 far away. */
export function pointsFor(distance: number): number {
  if (distance <= PERFECT_THRESHOLD_KM) return MAX_POINTS;
  const score = MAX_POINTS * Math.exp((-10 * distance) / WORLD_MAP_SIZE_KM);
  return Math.max(0, Math.round(score));
}

export function scoreGuess(guess: LatLng, actual: LatLng): { distanceKm: number; points: number } {
  const distance = distanceKm(guess, actual);
  return { distanceKm: distance, points: pointsFor(distance) };
}

/** Longitude difference across the short way round the world, in degrees. */
export function signedLngDelta(from: number, to: number): number {
  return ((((from - to) % 360) + 540) % 360) - 180;
}
