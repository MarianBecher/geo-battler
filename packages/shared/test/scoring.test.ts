import { describe, expect, it } from 'vitest';
import { distanceKm, pointsFor, scoreGuess, signedLngDelta, MAX_POINTS } from '../src/scoring.ts';

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm({ lat: 52.5, lng: 13.4 }, { lat: 52.5, lng: 13.4 })).toBe(0);
  });
  it('measures Berlin to Tokyo at roughly 8,900 km', () => {
    const d = distanceKm({ lat: 52.52, lng: 13.405 }, { lat: 35.68, lng: 139.69 });
    expect(d).toBeGreaterThan(8850);
    expect(d).toBeLessThan(8950);
  });
  it('never exceeds half the circumference', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * 6371, 0);
  });
});

describe('pointsFor', () => {
  it('gives the maximum for a perfect hit', () => {
    expect(pointsFor(0)).toBe(MAX_POINTS);
    expect(pointsFor(0.02)).toBe(MAX_POINTS);
  });
  it('follows the GeoGuessr curve', () => {
    expect(pointsFor(1491.6862)).toBe(1839);
    expect(pointsFor(14916.862)).toBe(0);
  });
  it('never goes negative', () => {
    expect(pointsFor(50000)).toBe(0);
  });
});

describe('scoreGuess', () => {
  it('returns distance and points together', () => {
    const s = scoreGuess({ lat: 0, lng: 0 }, { lat: 0, lng: 0 });
    expect(s).toEqual({ distanceKm: 0, points: MAX_POINTS });
  });
});

describe('signedLngDelta', () => {
  it('takes the short way round', () => {
    expect(signedLngDelta(170, -170)).toBe(-20);
    expect(signedLngDelta(-170, 170)).toBe(20);
    expect(signedLngDelta(10, 0)).toBe(10);
  });
});
