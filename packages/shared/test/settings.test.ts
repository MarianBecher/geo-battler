import { describe, expect, it } from 'vitest';
import { damageMultiplier, isPackId, PACK_IDS, TEAM_PALETTES, TEAMS } from '../src/settings.ts';

describe('damageMultiplier', () => {
  it('is x1 for the first five rounds and grows by 0.5 from round six', () => {
    expect([1, 5, 6, 7, 8].map(damageMultiplier)).toEqual([1, 1, 1.5, 2, 2.5]);
  });
});

describe('packs and teams', () => {
  it('recognises pack ids', () => {
    for (const id of PACK_IDS) expect(isPackId(id)).toBe(true);
    expect(isPackId('mars')).toBe(false);
  });
  it('starts every team palette with the team colour', () => {
    for (const team of TEAMS) expect(TEAM_PALETTES[team.id][0]).toBe(team.color);
  });
});
