import { describe, expect, it } from 'vitest';
import { REGIONS, offsetPoint, randomPoint, regionsOf } from '../src/locations.ts';
import { distanceKm } from '@geo-battler/shared';

describe('regions and packs', () => {
  it('keeps every box inside the world', () => {
    for (const r of REGIONS) {
      expect(r.minLat).toBeLessThan(r.maxLat);
      expect(r.minLng).toBeLessThan(r.maxLng);
      expect(Math.abs(r.minLat)).toBeLessThanOrEqual(90);
      expect(Math.abs(r.maxLng)).toBeLessThanOrEqual(180);
    }
  });
  it('selects the DACH boxes for the DACH pack and everything for the world', () => {
    expect(regionsOf('dach').map((r) => r.name).sort()).toEqual(['Austria', 'Germany', 'Switzerland']);
    expect(regionsOf('world')).toHaveLength(REGIONS.length);
  });
  it('rolls points inside a box of the pack', () => {
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

describe('offsetPoint', () => {
  it('moves roughly the requested distance', () => {
    const from = { lat: 48, lng: 11 };
    for (const bearing of [0, 90, 180, 270]) {
      expect(distanceKm(from, offsetPoint(from, bearing, 30))).toBeCloseTo(0.03, 3);
    }
  });
});
