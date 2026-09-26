import { describe, expect, it } from 'vitest';
import { TITLE_GROUPS, TITLE_IDS, titleGroupOf } from '../src/titles.ts';

describe('title catalogue', () => {
  it('has unique ids', () => {
    expect(new Set(TITLE_IDS).size).toBe(TITLE_IDS.length);
  });
  it('maps every id back to its group', () => {
    for (const [group, ids] of Object.entries(TITLE_GROUPS)) {
      for (const id of ids) expect(titleGroupOf(id)).toBe(group);
    }
  });
});
