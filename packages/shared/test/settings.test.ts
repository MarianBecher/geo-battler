import { describe, expect, it } from 'vitest';
import { damageMultiplier, isRegionId, isSceneryId, REGION_IDS, SCENERY_IDS, TEAM_PALETTES, TEAMS } from '../src/settings.ts';

describe('damageMultiplier', () => {
  it('is x1 for the first five rounds and grows by 0.5 from round six', () => {
    expect([1, 5, 6, 7, 8].map(damageMultiplier)).toEqual([1, 1, 1.5, 2, 2.5]);
  });
});

describe('destination and teams', () => {
  it('recognises region ids', () => {
    for (const id of REGION_IDS) expect(isRegionId(id)).toBe(true);
    expect(isRegionId('mars')).toBe(false);
    // The axes are separate lists - a scenery is no region.
    expect(isRegionId('city')).toBe(false);
  });
  it('recognises scenery ids', () => {
    for (const id of SCENERY_IDS) expect(isSceneryId(id)).toBe(true);
    expect(isSceneryId('moon')).toBe(false);
    expect(isSceneryId('world')).toBe(false);
  });
  it('starts every team palette with the team colour', () => {
    for (const team of TEAMS) expect(TEAM_PALETTES[team.id][0]).toBe(team.color);
  });
});
