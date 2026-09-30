// What we record about every player during a game - the raw material for
// the titles on the final screen (see titles.ts).
//
// Exactly one record per player and round. The server knows the pin data
// anyway (every click travels here immediately); the Street View numbers
// arrive from the client as telemetry.

import { distanceKm, signedLngDelta, type ContinentCode, type LatLng, type Telemetry, type TrailPoint } from '@geo-battler/shared';
import { continentOf } from './continents.ts';

export interface RoundStat {
  round: number;
  points: number;
  distanceKm: number | null;
  guess: LatLng | null;
  pins: number;
  /** Sum of all hops between consecutive pins. */
  pinPathKm: number;
  firstPin: LatLng | null;
  firstPinMs: number | null;
  lastPin: LatLng | null;
  lastPinMs: number | null;
  /** Distance from the second-to-last to the last pin. */
  lastAdjustKm: number | null;
  /** Distance from the first to the last pin. */
  moveKm: number;
  /** The closest any pin of the round came to the target. */
  closestPinKm: number | null;
  /** The pin's way for the reveal: nudges merged, thinned to TRAIL_MAX when the round closes. */
  trail: TrailPoint[];
  confirmMs: number | null;
  /** 1 = submitted first. */
  confirmRank: number | null;
  continentHit: boolean | null;
  guessContinent: ContinentCode | null;
  /** Guess minus truth. */
  bias: { dLat: number; dLng: number } | null;
  tele: Telemetry;
}

export function emptyTelemetry(): Telemetry {
  return { panoSteps: 0, panoReturns: 0, panDeg: 0, zoomMax: 0, zoomEvents: 0, mapZoomMax: 0, mapClicks: 0 };
}

export function emptyRoundStat(round: number): RoundStat {
  return {
    round, points: 0, distanceKm: null, guess: null, pins: 0, pinPathKm: 0,
    firstPin: null, firstPinMs: null, lastPin: null, lastPinMs: null, lastAdjustKm: null, moveKm: 0, closestPinKm: null, trail: [],
    confirmMs: null, confirmRank: null, continentHit: null, guessContinent: null, bias: null,
    tele: emptyTelemetry(),
  };
}

// Telemetry comes from the client, so every value gets a ceiling.
const TELEMETRY_LIMITS: Record<keyof Telemetry, number> = {
  panoSteps: 5000, panoReturns: 500, panDeg: 500000,
  zoomMax: 6, zoomEvents: 20000, mapZoomMax: 22, mapClicks: 5000,
};

export function sanitizeTelemetry(raw: unknown): Telemetry {
  const out = emptyTelemetry();
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  for (const key of Object.keys(TELEMETRY_LIMITS) as (keyof Telemetry)[]) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value > 0) out[key] = Math.min(TELEMETRY_LIMITS[key], value);
  }
  return out;
}

/** A pin moved by less than this counts as a nudge: it replaces the last stop of the trail. */
const TRAIL_MERGE_KM = 1;
/** Stops of a trail in the reveal - more would only turn the map into a scribble. */
export const TRAIL_MAX = 12;

/** Keeps `max` points spread evenly over the list, the first and the last always among them. */
export function thinOut<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  return Array.from({ length: max }, (_, i) => points[Math.round(i * (points.length - 1) / (max - 1))]!);
}

function extendTrail(trail: TrailPoint[], point: LatLng, ms: number): void {
  const prev = trail.at(-1);
  // A nudge keeps the time the pin arrived there, only the spot moves.
  if (prev && distanceKm(prev, point) < TRAIL_MERGE_KM) trail[trail.length - 1] = { ...point, ms: prev.ms };
  else trail.push({ ...point, ms });
  // A client clicking like mad must not grow the list without end.
  if (trail.length > 8 * TRAIL_MAX) trail.splice(0, trail.length, ...thinOut(trail, 2 * TRAIL_MAX));
}

/** Every pin placed - including corrections, those are the interesting ones. */
export function recordPin(stat: RoundStat, pin: LatLng, elapsedMs: number, actual: LatLng | null): void {
  const point = { lat: pin.lat, lng: pin.lng };
  if (actual) {
    const off = distanceKm(point, actual);
    stat.closestPinKm = stat.closestPinKm === null ? off : Math.min(stat.closestPinKm, off);
  }
  if (stat.lastPin) {
    const step = distanceKm(stat.lastPin, point);
    stat.pinPathKm += step;
    stat.lastAdjustKm = step;
  } else {
    stat.firstPin = point;
    stat.firstPinMs = elapsedMs;
  }
  extendTrail(stat.trail, point, elapsedMs);
  stat.pins++;
  stat.lastPin = point;
  stat.lastPinMs = elapsedMs;
  stat.moveKm = distanceKm(stat.firstPin ?? point, point);
}

/** Close the round: record the hit, the continent and the directional offset. */
export function closeRoundStat(stat: RoundStat, outcome: { guess: LatLng | null; actual: LatLng; distance: number | null; points: number }): RoundStat {
  stat.points = outcome.points;
  stat.distanceKm = outcome.distance;
  stat.guess = outcome.guess;
  stat.trail = thinOut(stat.trail, TRAIL_MAX);
  if (!outcome.guess) return stat;

  stat.guessContinent = continentOf(outcome.guess);
  stat.continentHit = stat.guessContinent === continentOf(outcome.actual);
  stat.bias = { dLat: outcome.guess.lat - outcome.actual.lat, dLng: signedLngDelta(outcome.guess.lng, outcome.actual.lng) };
  return stat;
}
