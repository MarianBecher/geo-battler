// Finds random places with real Street View coverage.
//
// Approach: draw a point from a weighted list of well-covered regions and ask
// the Street View Metadata API whether a panorama lies nearby. Metadata
// requests are free and have no quota, so we may roll as often as we like.

import { DEFAULT_PACK, type LatLng, type PackId } from '@geo-battler/shared';
import { describePlace, type Located } from './geocode.ts';
import { continentOfCountry } from './continents.ts';
import { GameError } from './errors.ts';

const METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';

/** Search radius around the rolled point: large enough for hits, small enough to stay in the region. */
const SEARCH_RADIUS_M = 20000;

/** Pause after a failed attempt - gives a short outage time to pass. */
const RETRY_PAUSE_MS = 400;

/** An area tag assigns a box to map packs; 'de', 'at', 'ch' are separate so there can be a DACH pack. */
type Area = 'eu' | 'de' | 'at' | 'ch' | 'na' | 'sa' | 'as' | 'af' | 'oc';

interface Region {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  weight: number;
  area: Area;
  name: string;
}

const region = (minLat: number, minLng: number, maxLat: number, maxLng: number, weight: number, area: Area, name: string): Region =>
  ({ minLat, minLng, maxLat, maxLng, weight, area, name });

// Imprecise boxes (sea, desert) are harmless - misses only cost another free request.
export const REGIONS: readonly Region[] = [
  // --- Europe ---
  region(47.3, 5.9, 54.9, 15.0, 8, 'de', 'Germany'),
  region(42.5, -4.5, 51.0, 7.8, 8, 'eu', 'France'),
  region(50.0, -6.0, 58.6, 1.7, 7, 'eu', 'UK'),
  region(51.5, -10.4, 55.3, -6.0, 3, 'eu', 'Ireland'),
  region(36.1, -9.2, 43.7, 3.3, 7, 'eu', 'Spain'),
  region(37.0, -9.4, 42.0, -6.2, 3, 'eu', 'Portugal'),
  region(37.0, 7.0, 46.5, 18.4, 7, 'eu', 'Italy'),
  region(51.0, 3.4, 53.4, 7.1, 4, 'eu', 'Netherlands'),
  region(49.5, 2.6, 51.5, 6.3, 3, 'eu', 'Belgium'),
  region(45.9, 6.0, 47.7, 10.4, 3, 'ch', 'Switzerland'),
  region(46.4, 9.6, 49.0, 17.1, 3, 'at', 'Austria'),
  region(49.1, 14.2, 54.8, 23.8, 6, 'eu', 'Poland'),
  region(48.6, 12.1, 51.0, 18.8, 3, 'eu', 'Czechia'),
  region(55.4, 11.2, 68.0, 23.5, 5, 'eu', 'Sweden'),
  region(58.0, 5.0, 70.5, 29.0, 5, 'eu', 'Norway'),
  region(60.0, 21.5, 68.5, 30.0, 4, 'eu', 'Finland'),
  region(54.6, 8.1, 57.7, 12.6, 3, 'eu', 'Denmark'),
  region(43.7, 20.3, 48.2, 29.6, 4, 'eu', 'Romania'),
  region(45.8, 16.2, 48.5, 22.8, 2, 'eu', 'Hungary'),
  region(35.0, 20.2, 41.7, 26.5, 4, 'eu', 'Greece'),
  region(53.9, 21.0, 59.6, 28.2, 3, 'eu', 'Baltics'),
  region(44.4, 22.2, 52.3, 40.0, 3, 'eu', 'Ukraine'),
  region(36.0, 26.0, 42.0, 44.5, 5, 'eu', 'Turkey'),
  region(41.0, 13.4, 49.0, 23.0, 4, 'eu', 'Balkans / Slovakia'),
  region(63.3, -24.6, 66.5, -13.5, 2, 'eu', 'Iceland'),

  // --- North & Central America ---
  region(25.0, -124.6, 49.0, -67.0, 18, 'na', 'USA'),
  region(55.0, -160.0, 65.0, -135.0, 1, 'na', 'Alaska'),
  region(19.0, -159.8, 22.2, -155.0, 1, 'na', 'Hawaii'),
  region(43.0, -127.0, 55.0, -55.0, 8, 'na', 'Canada (south)'),
  region(15.0, -117.0, 32.5, -88.0, 6, 'na', 'Mexico'),
  region(7.2, -92.3, 17.8, -77.2, 2, 'na', 'Central America'),

  // --- South America ---
  region(-33.5, -57.5, -2.0, -39.0, 9, 'sa', 'Brazil (east)'),
  region(-10.0, -70.0, 0.5, -48.0, 2, 'sa', 'Brazil (north)'),
  region(-52.0, -71.5, -23.0, -58.0, 6, 'sa', 'Argentina'),
  region(-42.0, -74.0, -18.0, -69.5, 4, 'sa', 'Chile'),
  region(-17.0, -79.0, -4.0, -69.0, 3, 'sa', 'Peru'),
  region(1.5, -77.5, 11.0, -72.5, 3, 'sa', 'Colombia'),
  region(-21.0, -80.0, 1.0, -58.0, 2, 'sa', 'Ecuador / Bolivia'),
  region(-34.9, -58.4, -30.1, -53.2, 2, 'sa', 'Uruguay'),

  // --- Asia ---
  region(31.0, 130.0, 45.4, 145.8, 9, 'as', 'Japan'),
  region(34.0, 126.1, 38.5, 129.5, 5, 'as', 'South Korea'),
  region(21.9, 120.0, 25.3, 122.0, 3, 'as', 'Taiwan'),
  region(5.7, 97.4, 20.4, 105.6, 5, 'as', 'Thailand'),
  region(1.2, 99.6, 6.7, 119.3, 3, 'as', 'Malaysia / Singapore'),
  region(-10.0, 95.2, 5.9, 141.0, 5, 'as', 'Indonesia'),
  region(5.0, 117.2, 18.6, 126.6, 4, 'as', 'Philippines'),
  region(8.1, 68.7, 35.0, 97.4, 8, 'as', 'India'),
  region(5.9, 79.7, 9.8, 81.9, 2, 'as', 'Sri Lanka'),
  region(8.6, 102.1, 23.3, 109.5, 3, 'as', 'Vietnam / Cambodia / Laos'),
  region(21.5, 88.2, 26.5, 92.5, 2, 'as', 'Bangladesh'),
  region(26.4, 80.1, 29.3, 91.6, 1, 'as', 'Nepal / Bhutan'),
  region(29.5, 34.2, 33.3, 39.3, 2, 'as', 'Israel / Jordan'),
  region(22.6, 51.0, 26.4, 56.4, 2, 'as', 'UAE / Qatar'),
  region(40.0, 51.0, 55.0, 80.0, 2, 'as', 'Kazakhstan / Kyrgyzstan'),
  region(43.0, 88.0, 50.0, 116.0, 1, 'as', 'Mongolia'),
  region(44.0, 30.0, 60.0, 60.0, 4, 'as', 'Russia (west)'),
  region(50.0, 60.0, 62.0, 135.0, 2, 'as', 'Russia (east)'),

  // --- Africa ---
  region(-34.8, 16.5, -22.1, 32.9, 6, 'af', 'South Africa'),
  region(-11.5, 29.4, 4.6, 41.8, 3, 'af', 'Kenya / Tanzania / Uganda'),
  region(4.3, -17.5, 13.9, 14.5, 3, 'af', 'West Africa'),
  region(-29.0, 11.7, -17.8, 29.4, 3, 'af', 'Namibia / Botswana'),
  region(28.0, -13.0, 35.9, -1.0, 2, 'af', 'Morocco'),
  region(30.3, 7.5, 37.3, 11.5, 1, 'af', 'Tunisia'),
  region(22.0, 25.0, 31.6, 34.0, 2, 'af', 'Egypt'),

  // --- Oceania ---
  region(-43.6, 113.3, -11.0, 153.6, 10, 'oc', 'Australia'),
  region(-46.9, 166.4, -34.4, 178.6, 5, 'oc', 'New Zealand'),
];

// --- Map packs -------------------------------------------------------------
//
// A pack is a selection of the boxes above. The lobby votes on which one is
// played. Hall of Fame records only count on the world - on a small pack
// every guess is closer.
//
// The boxes are rectangles and reach across borders: the Austria box into
// Bohemia, the Turkey box into Syria. So every find outside the world pack is
// cross-checked by geocoding: its country must lie on one of the pack's
// continents or in its country list. That costs one request per candidate,
// which the reveal would make for the place name anyway.
interface Pack {
  areas: readonly Area[] | null;
  continents?: readonly string[];
  countries?: readonly string[];
}

const PACKS: Record<PackId, Pack> = {
  world: { areas: null },
  europe: { areas: ['eu', 'de', 'at', 'ch'], continents: ['EU'], countries: ['TR'] },
  dach: { areas: ['de', 'at', 'ch'], countries: ['DE', 'AT', 'CH'] },
  americas: { areas: ['na', 'sa'], continents: ['NA', 'SA'] },
  asia: { areas: ['as'], continents: ['AS'] },
  africa: { areas: ['af'], continents: ['AF'] },
  oceania: { areas: ['oc'], continents: ['OC'] },
};

export function regionsOf(packId: PackId): readonly Region[] {
  const pack = PACKS[packId];
  return pack.areas ? REGIONS.filter((r) => pack.areas!.includes(r.area)) : REGIONS;
}

/**
 * Is the find inside the pack? On the world, always. Otherwise the country
 * decides. If the country cannot be determined right now (geocoding off,
 * open sea) the find counts - better a place just across the border than no
 * game at all. The place name stays attached so the reveal does not ask again.
 */
async function withinPack(hit: Located, pack: Pack, apiKey: string): Promise<boolean> {
  if (!pack.continents && !pack.countries) return true;
  const place = await describePlace(hit, apiKey);
  if (!place?.countryCode) return true;
  hit.place = place;
  return !!pack.countries?.includes(place.countryCode)
    || !!pack.continents?.includes(continentOfCountry(place.countryCode) ?? '');
}

/** A random point from the pack's regions, weighted. `random` is injectable for tests. */
export function randomPoint(packId: PackId, random: () => number = Math.random): LatLng {
  const regions = regionsOf(packId);
  const totalWeight = regions.reduce((sum, r) => sum + r.weight, 0);
  let roll = random() * totalWeight;
  let picked = regions[regions.length - 1]!;
  for (const r of regions) {
    roll -= r.weight;
    if (roll <= 0) {
      picked = r;
      break;
    }
  }
  return {
    lat: picked.minLat + random() * (picked.maxLat - picked.minLat),
    lng: picked.minLng + random() * (picked.maxLng - picked.minLng),
  };
}

// --- Movement check --------------------------------------------------------
//
// The Metadata API only says whether *some* panorama lies at a spot - not
// whether you can move away from it. Isolated photo spheres (uploaded by
// users, with no link to neighbouring panoramas) look exactly like real road
// coverage to the API. So when movement is allowed we additionally check:
//   1. copyright "(c) Google" -> official coverage rather than a user photo sphere
//   2. at least one *other* panorama within walking distance -> the chain you
//      can move along really exists.
const NEIGHBOR_BEARINGS = [0, 90, 180, 270];
const NEIGHBOR_OFFSET_M = 30; // how far from the find we measure
const NEIGHBOR_RADIUS_M = 25; // search radius there (smaller than the offset, so the same panorama does not come back)

export function offsetPoint({ lat, lng }: LatLng, bearingDeg: number, meters: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111320;
  const dLng = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180) || 1e-9);
  return { lat: lat + dLat, lng: lng + dLng };
}

const isOfficialCoverage = (copyright: string): boolean => /google/i.test(copyright);

interface Hit extends Located {
  copyright: string;
}

interface MetadataResponse {
  status: string;
  error_message?: string;
  pano_id?: string;
  location?: LatLng;
  copyright?: string;
}

async function probe(point: LatLng, apiKey: string, radius = SEARCH_RADIUS_M): Promise<Hit | null> {
  const url = new URL(METADATA_URL);
  url.searchParams.set('location', `${point.lat},${point.lng}`);
  url.searchParams.set('radius', String(radius));
  url.searchParams.set('source', 'outdoor');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Metadata API HTTP ${res.status}`);
  const data = (await res.json()) as MetadataResponse;

  if (data.status === 'OK' && data.pano_id && data.location) {
    return { panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng, copyright: data.copyright ?? '' };
  }
  if (data.status === 'ZERO_RESULTS') return null;

  // REQUEST_DENIED / OVER_QUERY_LIMIT / INVALID_REQUEST -> a real error
  throw new Error(`Metadata API: ${data.status}${data.error_message ? ` - ${data.error_message}` : ''}`);
}

/** Is there another panorama within walking distance? (4 free metadata requests) */
async function hasNeighborPano(hit: Hit, apiKey: string): Promise<boolean> {
  const neighbors = await Promise.all(
    NEIGHBOR_BEARINGS.map((b) => probe(offsetPoint(hit, b, NEIGHBOR_OFFSET_M), apiKey, NEIGHBOR_RADIUS_M)),
  );
  return neighbors.some((n) => n && n.panoId !== hit.panoId);
}

export interface SearchOptions {
  maxTries?: number;
  requireMove?: boolean;
  pack?: PackId;
}

/**
 * Finds a single place with Street View coverage inside the map pack.
 * With `requireMove`, only places you can also move away from.
 */
export async function pickLocation(apiKey: string, { maxTries = 60, requireMove = false, pack = DEFAULT_PACK }: SearchOptions = {}): Promise<Located> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxTries; i++) {
    try {
      const hit = await probe(randomPoint(pack), apiKey);
      if (!hit) continue;
      if (requireMove) {
        if (!isOfficialCoverage(hit.copyright)) continue;
        if (!(await hasNeighborPano(hit, apiKey))) continue;
      }
      if (!(await withinPack(hit, PACKS[pack], apiKey))) continue;
      return { panoId: hit.panoId, lat: hit.lat, lng: hit.lng, ...(hit.place !== undefined ? { place: hit.place } : {}) };
    } catch (err) {
      lastError = err as Error;
      // Configuration errors repeat anyway - give up immediately.
      if (/REQUEST_DENIED|error_message|API_KEY/i.test(lastError.message)) throw lastError;
      // Everything else (UNKNOWN_ERROR, timeout) is usually transient. Take a
      // breath, otherwise one outage burns through all attempts in seconds.
      await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    }
  }
  throw lastError ?? new GameError('noStreetView');
}

/** Finds `count` distinct places in parallel. */
export async function pickLocations(count: number, apiKey: string, options: SearchOptions = {}): Promise<Located[]> {
  const found = new Map<string, Located>();
  let guard = 0;

  while (found.size < count && guard < 6) {
    guard++;
    const missing = count - found.size;
    const batch = await Promise.all(Array.from({ length: missing }, () => pickLocation(apiKey, options)));
    for (const loc of batch) {
      if (!found.has(loc.panoId)) found.set(loc.panoId, loc);
    }
  }

  return Array.from(found.values()).slice(0, count);
}
