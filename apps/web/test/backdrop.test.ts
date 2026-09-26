import { describe, expect, it } from 'vitest';
import { greatCircle } from '../src/ui/backdrop.ts';

describe('greatCircle', () => {
  it('starts and ends at the two points, in n steps', () => {
    const pts = greatCircle([13.4, 52.5], [139.7, 35.7], 80);
    expect(pts).toHaveLength(81);
    expect(pts[0]![0]).toBeCloseTo(13.4, 6);
    expect(pts[0]![1]).toBeCloseTo(52.5, 6);
    expect(pts[80]![0]).toBeCloseTo(139.7, 6);
    expect(pts[80]![1]).toBeCloseTo(35.7, 6);
  });

  it('follows the equator between two points on it', () => {
    const pts = greatCircle([0, 0], [90, 0], 2);
    expect(pts[1]![0]).toBeCloseTo(45, 6);
    expect(pts[1]![1]).toBeCloseTo(0, 6);
  });

  it('runs along the meridian to the pole', () => {
    const pts = greatCircle([0, 0], [0, 90], 2);
    expect(pts[1]![0]).toBeCloseTo(0, 6);
    expect(pts[1]![1]).toBeCloseTo(45, 6);
  });

  it('bulges towards the pole between two northern cities', () => {
    // Berlin -> Tokyo passes far north of both (over Siberia).
    const pts = greatCircle([13.4, 52.5], [139.7, 35.7], 80);
    const highest = Math.max(...pts.map((p) => p[1]));
    expect(highest).toBeGreaterThan(60);
  });

  it('survives the same point twice', () => {
    const pts = greatCircle([10, 20], [10, 20], 4);
    expect(pts).toHaveLength(5);
    for (const [lng, lat] of pts) {
      expect(lng).toBe(10);
      expect(lat).toBe(20);
    }
  });
});
