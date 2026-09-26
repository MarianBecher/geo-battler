import { describe, expect, it } from 'vitest';
import { formatDistance } from '../src/maps/google.ts';
import { naturalEarth } from '../src/maps/projection.ts';
import { inkLabel, inkOf, INKS, project } from '../src/maps/worldmap.ts';

describe('formatDistance', () => {
  it('has a dash for no distance', () => {
    expect(formatDistance(null)).toBe('-');
    expect(formatDistance(undefined)).toBe('-');
  });

  it('uses metres below one kilometre', () => {
    expect(formatDistance(0.85)).toBe('850 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('keeps one decimal below 100 km', () => {
    expect(formatDistance(12.345)).toBe('12.3 km');
    expect(formatDistance(5)).toBe('5.0 km');
  });

  it('rounds and groups from 100 km on', () => {
    expect(formatDistance(100)).toBe('100 km');
    expect(formatDistance(1234.4)).toBe('1,234 km');
  });
});

describe('Natural Earth projection', () => {
  it('keeps the origin in the middle', () => {
    expect(naturalEarth(0, 0)).toEqual([0, 0]);
  });

  it('reaches about ±2.73 at the date line and ±1.42 at the poles', () => {
    const [east] = naturalEarth(180, 0);
    const [west] = naturalEarth(-180, 0);
    const [, north] = naturalEarth(0, 90);
    expect(east).toBeCloseTo(Math.PI * 0.8707, 6);
    expect(west).toBeCloseTo(-east, 9);
    expect(north).toBeCloseTo(1.4224, 3);
    expect(naturalEarth(0, -90)[1]).toBeCloseTo(-north, 9);
  });

  it('bends the meridians towards the poles', () => {
    const [atEquator] = naturalEarth(90, 0);
    const [at60] = naturalEarth(90, 60);
    expect(at60).toBeLessThan(atEquator);
  });

  it('places known points on the printed map', () => {
    // Centre of the map, shifted 12 px down because Antarctica is left out.
    expect(project(0, 0)).toEqual([470, 217]);
    const [x, y] = project(13.4, 52.5); // Berlin: right of centre, well above it
    expect(x).toBeGreaterThan(470);
    expect(x).toBeLessThan(560);
    expect(y).toBeLessThan(217 - 100);
    const [xw] = project(-180, 0);
    expect(Math.abs(xw)).toBeLessThan(2); // the date line sits on the left edge
  });
});

describe('inks', () => {
  it('sorts points into the three stamp colours', () => {
    expect(inkOf(5000)).toBe('good');
    expect(inkOf(2500)).toBe('good');
    expect(inkOf(2499)).toBe('mid');
    expect(inkOf(1000)).toBe('mid');
    expect(inkOf(0)).toBe('bad');
  });

  it('labels every ink', () => {
    for (const ink of INKS) expect(inkLabel(ink)).toBe(inkLabel(ink.cls));
    expect(inkLabel('good')).toBe('2,500 and up');
  });
});
