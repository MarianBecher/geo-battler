import { describe, expect, it } from 'vitest';
import { TITLE_IDS } from '@geo-battler/shared';
import { buildFinalStats, type PlayerEntry } from '../src/titles.ts';
import { emptyRoundStat, closeRoundStat, recordPin } from '../src/stats.ts';

const spot = (lat: number, lng: number) => ({ lat, lng });

function entry(playerId: string, guesses: ({ lat: number; lng: number } | null)[], actuals: { lat: number; lng: number }[]): PlayerEntry {
  let score = 0;
  const rounds = guesses.map((guess, i) => {
    const stat = emptyRoundStat(i + 1);
    const actual = actuals[i]!;
    if (guess) {
      recordPin(stat, guess, 5000 + i * 1000);
      stat.confirmMs = 10000 + i * 1000;
      stat.confirmRank = 1;
    }
    const distance = guess ? Math.hypot(guess.lat - actual.lat, guess.lng - actual.lng) * 111 : null;
    const points = guess ? Math.max(0, Math.round(5000 * Math.exp((-10 * distance!) / 14916.862))) : 0;
    closeRoundStat(stat, { guess, actual, distance, points });
    score += points;
    return stat;
  });
  return { playerId, name: playerId, color: '#000', score, rounds };
}

const ctxFor = (entries: PlayerEntry[], actuals: { lat: number; lng: number }[]) => {
  const roundWinners = new Map<number, Set<string>>();
  actuals.forEach((_, i) => {
    const best = Math.max(...entries.map((e) => e.rounds[i]!.points));
    roundWinners.set(i + 1, new Set(entries.filter((e) => e.rounds[i]!.points === best).map((e) => e.playerId)));
  });
  return { roundWinners, actuals: new Map(actuals.map((a, i) => [i + 1, a])), actualSpreadKm: 9000, settings: { mode: 'classic' as const, rounds: actuals.length, hp: 6000, teams: false, timeLimit: 90, noMove: false, noPan: false, noZoom: false, pack: 'world' as const, locked: { noMove: false, noPan: false, noZoom: false, pack: false } }, timeLimitMs: 90000 };
};

describe('buildFinalStats', () => {
  const actuals = [spot(52.5, 13.4), spot(48.9, 2.4), spot(35.7, 139.7), spot(-33.9, 151.2)];
  const ada = entry('ada', [spot(52.5, 13.4), spot(48.9, 2.4), spot(35.7, 139.7), spot(-33.9, 151.2)], actuals);
  const bob = entry('bob', [spot(40, -100), null, spot(40, -100), spot(40, -100)], actuals);

  it('gives every player exactly one title from the catalogue, without duplicates', () => {
    const { titles } = buildFinalStats([ada, bob], ctxFor([ada, bob], actuals), () => 0.5);
    expect(Object.keys(titles).sort()).toEqual(['ada', 'bob']);
    for (const t of Object.values(titles)) expect(TITLE_IDS).toContain(t.id);
    expect(titles.ada!.id).not.toBe(titles.bob!.id);
  });

  it('is deterministic for the same random source', () => {
    const a = buildFinalStats([ada, bob], ctxFor([ada, bob], actuals), () => 0.3);
    const b = buildFinalStats([ada, bob], ctxFor([ada, bob], actuals), () => 0.3);
    expect(a).toEqual(b);
  });

  it('marks the best value per metric and leaves observations unmarked', () => {
    const { metrics } = buildFinalStats([ada, bob], ctxFor([ada, bob], actuals), () => 0);
    const score = metrics.find((m) => m.key === 'score')!;
    expect(score.values.find((v) => v.playerId === 'ada')!.best).toBe(true);
    expect(score.values.find((v) => v.playerId === 'bob')!.best).toBe(false);
    const pins = metrics.find((m) => m.key === 'avgPins')!;
    expect(pins.dir).toBeNull();
    expect(pins.values.every((v) => !v.best)).toBe(true);
    const missed = metrics.find((m) => m.key === 'missed')!;
    expect(missed.values.find((v) => v.playerId === 'bob')!.value).toBe(1);
  });

  it('falls back to a note title when nothing stands out for a lone player', () => {
    const solo = entry('solo', [spot(0, 0)], [spot(50, 50)]);
    const { titles } = buildFinalStats([solo], ctxFor([solo], [spot(50, 50)]), () => 0);
    expect(titles.solo!.group).toBe('note');
    expect(titles.solo!.facts.length).toBeGreaterThan(0);
  });
});
