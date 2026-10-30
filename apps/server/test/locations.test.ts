import { describe, expect, it } from 'vitest';
import { CITIES, REGIONS, cityRadiusKm, citiesOf, isBuiltUp, offsetPoint, randomPoint, regionsOf } from '../src/locations.ts';
import { distanceKm } from '@geo-battler/shared';

describe('regions', () => {
  it('keeps every box inside the world', () => {
    for (const r of REGIONS) {
      expect(r.minLat).toBeLessThan(r.maxLat);
      expect(r.minLng).toBeLessThan(r.maxLng);
      expect(Math.abs(r.minLat)).toBeLessThanOrEqual(90);
      expect(Math.abs(r.maxLng)).toBeLessThanOrEqual(180);
    }
  });
  it('selects the DACH boxes for DACH and everything for the world', () => {
    expect(regionsOf('dach').map((r) => r.name).sort()).toEqual(['Austria', 'Germany', 'Switzerland']);
    expect(regionsOf('world')).toHaveLength(REGIONS.length);
  });
  it('rolls points inside a box of the region', () => {
    const boxes = regionsOf('oceania');
    for (let i = 0; i < 50; i++) {
      const p = randomPoint('oceania');
      expect(boxes.some((b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng)).toBe(true);
    }
  });
  it('picks the heaviest box more often', () => {
    const counts = new Map<string, number>();
    const boxes = regionsOf('oceania');
    for (let i = 0; i < 2000; i++) {
      const p = randomPoint('oceania');
      const box = boxes.find((b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng)!;
      counts.set(box.name, (counts.get(box.name) ?? 0) + 1);
    }
    expect(counts.get('Australia')!).toBeGreaterThan(counts.get('New Zealand')!);
  });
});

describe('big cities', () => {
  it('keeps every city on the globe with a positive size', () => {
    for (const c of CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lng)).toBeLessThanOrEqual(180);
      expect(c.size).toBeGreaterThan(0);
    }
  });
  it('rolls points inside some city disc', () => {
    for (let i = 0; i < 200; i++) {
      const p = randomPoint('world', 'city');
      expect(CITIES.some((c) => distanceKm(p, c) <= cityRadiusKm(c) + 0.1)).toBe(true);
    }
  });
  it('draws every city with the same chance - the first roll indexes the list directly', () => {
    const first = CITIES[0]!;
    const last = CITIES[CITIES.length - 1]!;
    // Rolls: city index, distance in the disc (0 = the centre), bearing.
    const point = (rolls: number[]) => {
      let i = 0;
      return randomPoint('world', 'city', () => rolls[i++] ?? 0);
    };
    expect(point([0, 0, 0])).toEqual({ lat: first.lat, lng: first.lng });
    expect(point([0.999999, 0, 0])).toEqual({ lat: last.lat, lng: last.lng });
  });
});

describe('region x scenery', () => {
  it('filters the city list by the region, the same way the boxes are filtered', () => {
    expect(citiesOf('world')).toHaveLength(CITIES.length);
    expect(citiesOf('dach').map((c) => c.name)).toContain('Vienna');
    expect(citiesOf('dach').map((c) => c.name)).not.toContain('Paris');
    expect(citiesOf('oceania').every((c) => c.area === 'oc')).toBe(true);
  });
  it('leaves no region without cities - every combination is playable', () => {
    for (const region of ['world', 'europe', 'dach', 'americas', 'asia', 'africa', 'oceania'] as const) {
      expect(citiesOf(region).length).toBeGreaterThan(0);
    }
  });
  it('rolls a big city inside the chosen region', () => {
    for (let i = 0; i < 50; i++) {
      const p = randomPoint('dach', 'city');
      expect(citiesOf('dach').some((c) => distanceKm(p, c) <= cityRadiusKm(c) + 0.1)).toBe(true);
    }
  });
  it('rolls town and rural in the region boxes - the ring check does the rest', () => {
    const boxes = regionsOf('oceania');
    for (const scenery of ['town', 'rural'] as const) {
      const p = randomPoint('oceania', scenery);
      expect(boxes.some((b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng)).toBe(true);
    }
  });
});

describe('isBuiltUp', () => {
  const pano = (panoId: string, copyright = '(c) Google') => ({ panoId, copyright });
  it('accepts a street grid: other panoramas in three or four directions', () => {
    expect(isBuiltUp('me', [pano('a'), pano('b'), pano('c'), pano('d')])).toBe(true);
    expect(isBuiltUp('me', [pano('a'), pano('b'), pano('c'), null])).toBe(true);
  });
  it('rejects a country road: hits only ahead and behind', () => {
    expect(isBuiltUp('me', [pano('a'), null, pano('b'), null])).toBe(false);
    expect(isBuiltUp('me', [null, null, null, null])).toBe(false);
  });
  it('does not count the found panorama itself', () => {
    expect(isBuiltUp('me', [pano('me'), pano('a'), pano('b'), null])).toBe(false);
  });
  it('does not count user photospheres as streets', () => {
    expect(isBuiltUp('me', [pano('a', '(c) Jane Doe'), pano('b', '(c) Jane Doe'), pano('c'), pano('d')])).toBe(false);
  });
});

describe('offsetPoint', () => {
  it('moves roughly the requested distance', () => {
    const from = { lat: 48, lng: 11 };
    for (const bearing of [0, 90, 180, 270]) {
      expect(distanceKm(from, offsetPoint(from, bearing, 30))).toBeCloseTo(0.03, 3);
    }
  });
});
