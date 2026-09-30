import { describe, expect, it } from 'vitest';
import { scoreGuess, TITLE_IDS } from '@geo-battler/shared';
import { buildFinalStats, titleCandidates, type DuelLog, type PlayerEntry } from '../src/titles.ts';
import { emptyRoundStat, closeRoundStat, recordPin } from '../src/stats.ts';

const spot = (lat: number, lng: number) => ({ lat, lng });

function entry(playerId: string, guesses: ({ lat: number; lng: number } | null)[], actuals: { lat: number; lng: number }[]): PlayerEntry {
  let score = 0;
  const rounds = guesses.map((guess, i) => {
    const stat = emptyRoundStat(i + 1);
    const actual = actuals[i]!;
    if (guess) {
      recordPin(stat, guess, 5000 + i * 1000, actual);
      stat.confirmMs = 10000 + i * 1000;
      stat.confirmRank = 1;
    }
    const { distanceKm: distance, points } = guess ? scoreGuess(guess, actual) : { distanceKm: null, points: 0 };
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
  return { roundWinners, actuals: new Map(actuals.map((a, i) => [i + 1, a])), actualSpreadKm: 9000, settings: { mode: 'classic' as const, rounds: actuals.length, hp: 6000, teams: false, timeLimit: 90, noMove: false, noPan: false, noZoom: false, pack: 'world' as const, locked: { noMove: false, noPan: false, noZoom: false, pack: false } }, timeLimitMs: 90000, duel: null };
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

  it('awards Cold Feet to whoever moves a close pin far away', () => {
    const target = [spot(52.5, 13.4)];
    const stat = emptyRoundStat(1);
    recordPin(stat, spot(52.6, 13.5), 4000, target[0]!); // Berlin, a few km off
    recordPin(stat, spot(40.4, -3.7), 8000, target[0]!); // ... and then Madrid
    const { distanceKm: distance, points } = scoreGuess(spot(40.4, -3.7), target[0]!);
    closeRoundStat(stat, { guess: spot(40.4, -3.7), actual: target[0]!, distance, points });
    const flip: PlayerEntry = { playerId: 'flip', name: 'flip', color: '#000', score: points, rounds: [stat] };
    const steady = entry('steady', [spot(48, 11)], target);

    const { titles, metrics } = buildFinalStats([flip, steady], ctxFor([flip, steady], target), () => 0);
    expect(titles.flip!.id).toBe('coldFeet');
    expect(titles.flip!.facts.map((f) => f.key)).toEqual(['closestPin', 'submittedOff', 'pointsLetGo']);
    const letGo = metrics.find((m) => m.key === 'pointsLetGo')!;
    expect(letGo.values.find((v) => v.playerId === 'flip')!.value).toBeGreaterThan(3000);
    expect(letGo.values.find((v) => v.playerId === 'steady')!.value).toBe(0);
  });

  it('falls back to a note title when nothing stands out for a lone player', () => {
    const solo = entry('solo', [spot(0, 0)], [spot(50, 50)]);
    const { titles } = buildFinalStats([solo], ctxFor([solo], [spot(50, 50)]), () => 0);
    expect(titles.solo!.group).toBe('note');
    expect(titles.solo!.facts.length).toBeGreaterThan(0);
  });
});

/** Rounds with fixed points instead of real guesses: every round a guess 1,000 km off. */
function scripted(playerId: string, rounds: { points: number; rank?: number }[]): PlayerEntry {
  const stats = rounds.map(({ points, rank }, i) => {
    const stat = emptyRoundStat(i + 1);
    Object.assign(stat, { points, guess: spot(0, 0), distanceKm: 1000, confirmMs: 20000, confirmRank: rank ?? null });
    return stat;
  });
  return { playerId, name: playerId, color: '#000', score: stats.reduce((n, r) => n + r.points, 0), rounds: stats };
}

describe('title candidates', () => {
  const three = [spot(52.5, 13.4), spot(48.9, 2.4), spot(41.9, 12.5)];

  it('turns the last round into Buzzer Beater for the one who overtakes and Choker for the one overtaken', () => {
    const leader = scripted('leader', [{ points: 3000 }, { points: 3000 }, { points: 500 }]);
    const chaser = scripted('chaser', [{ points: 2000 }, { points: 2000 }, { points: 3000 }]);
    const found = titleCandidates([leader, chaser], ctxFor([leader, chaser], three));
    expect(found.chaser).toContain('buzzerBeater');
    expect(found.chaser).not.toContain('choker');
    expect(found.leader).toContain('choker');
    expect(found.leader).not.toContain('buzzerBeater');
  });

  it('keeps Buzzer Beater and Choker out of a game decided before the last round', () => {
    const ahead = scripted('ahead', [{ points: 3000 }, { points: 3000 }, { points: 3000 }]);
    const behind = scripted('behind', [{ points: 2000 }, { points: 2000 }, { points: 2500 }]);
    const found = titleCandidates([ahead, behind], ctxFor([ahead, behind], three));
    expect([...found.ahead!, ...found.behind!]).not.toContain('buzzerBeater');
    expect([...found.ahead!, ...found.behind!]).not.toContain('choker');
  });

  it('calls the one who is always second, never first, the Eternal Runner-up', () => {
    const top = scripted('top', three.map(() => ({ points: 4000 })));
    const second = scripted('second', three.map(() => ({ points: 3000 })));
    const third = scripted('third', three.map(() => ({ points: 1000 })));
    const found = titleCandidates([top, second, third], ctxFor([top, second, third], three));
    expect(found.second).toContain('eternalSecond');
    expect(found.third).not.toContain('eternalSecond');
  });

  it('awards Kamikaze to whoever submits first and comes last, twice', () => {
    const rash = scripted('rash', [{ points: 1000, rank: 1 }, { points: 1000, rank: 1 }, { points: 4000, rank: 1 }]);
    const calm = scripted('calm', [{ points: 3000, rank: 2 }, { points: 3000, rank: 2 }, { points: 2000, rank: 2 }]);
    const found = titleCandidates([rash, calm], ctxFor([rash, calm], three));
    expect(found.rash).toContain('kamikaze');
    expect(found.calm).not.toContain('kamikaze');
  });

  it('finds the Specialist: strong on one continent, weak on all others', () => {
    const world = [spot(52.5, 13.4), spot(48.9, 2.4), spot(35.7, 139.7), spot(13.8, 100.5)];
    const euro = scripted('euro', [{ points: 4200 }, { points: 4000 }, { points: 500 }, { points: 700 }]);
    const even = scripted('even', world.map(() => ({ points: 2500 })));
    const found = titleCandidates([euro, even], ctxFor([euro, even], world));
    expect(found.euro).toContain('specialist');
    expect(found.even).not.toContain('specialist');
  });

  it('knows the duel titles: Survivor, Executioner and Glass Cannon', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => scripted(id, three.map(() => ({ points: 2000 }))));
    const duel: DuelLog = {
      startHp: 6000,
      teams: false,
      rounds: [
        { round: 1, damage: new Map([['a', 0], ['b', 3000], ['c', 3500]]), knockedOut: new Set() },
        { round: 2, damage: new Map([['a', 5500], ['b', 0], ['c', 2600]]), knockedOut: new Set(['c']) },
        { round: 3, damage: new Map([['a', 0], ['b', 3000]]), knockedOut: new Set(['b']) },
      ],
      hpLeft: new Map([['a', 500], ['b', 0], ['c', 0]]),
    };
    const base = ctxFor([a!, b!, c!], three);
    const found = titleCandidates([a!, b!, c!], { ...base, settings: { ...base.settings, mode: 'duel' }, duel });
    expect(found.a).toEqual(expect.arrayContaining(['survivor', 'executioner', 'glassCannon']));
    for (const id of ['b', 'c']) {
      expect(found[id]).not.toContain('survivor');
      expect(found[id]).not.toContain('executioner');
      expect(found[id]).not.toContain('glassCannon');
    }
    // In a team everyone takes the same damage - no Glass Cannon there.
    const teamFound = titleCandidates([a!, b!, c!], { ...base, settings: { ...base.settings, mode: 'duel' }, duel: { ...duel, teams: true } });
    expect(teamFound.a).not.toContain('glassCannon');
  });
});
