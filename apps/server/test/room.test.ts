import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, DEFAULT_SETTINGS, type ErrorCode } from '@geo-battler/shared';
import { Room, sanitizeFace, sanitizeName, sanitizeSettings, type LocationFinder, type RoomOptions } from '../src/room.ts';
import { GameError } from '../src/errors.ts';

const BERLIN = { lat: 52.52, lng: 13.405 };
const PARIS = { lat: 48.857, lng: 2.352 };
const TOKYO = { lat: 35.68, lng: 139.69 };

/** A finder that hands out fixed places, one per call. */
const fixedFinder = (spots = [BERLIN, PARIS, TOKYO]): LocationFinder => {
  let n = 0;
  return (count) => Promise.resolve(Array.from({ length: count }, () => {
    const spot = spots[n % spots.length]!;
    return { panoId: `pano-${n++}`, ...spot, place: null };
  }));
};

const socket = () => ({ close: vi.fn() });

/** A matcher for a GameError with this code, typed the way toThrowError wants it. */
const failsWith = (code: ErrorCode): Error => {
  const matcher: unknown = expect.objectContaining({ code });
  return matcher as Error;
};

function lobby(finder = fixedFinder(), options: RoomOptions = {}) {
  const room = new Room('ABCD', finder, { drawRevealMs: 0, ...options });
  const ada = room.addPlayer('Ada', socket());
  const bob = room.addPlayer('Bob', socket());
  return { room, ada, bob };
}

/** Everyone ready -> the game starts and the countdown runs out. */
async function startGame(room: Room) {
  for (const p of room.players.values()) await room.setReady(p.id, true);
  await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 10);
}

describe('sanitizeSettings', () => {
  it('clamps rounds, hp and time and rounds hp to hundreds', () => {
    const s = sanitizeSettings({ rounds: 99, hp: 1234, timeLimit: 5 });
    expect(s.rounds).toBe(20);
    expect(s.hp).toBe(1200);
    expect(s.timeLimit).toBe(10);
    expect(sanitizeSettings({ timeLimit: 0 }).timeLimit).toBe(0);
  });
  it('turns No Pan on only together with No Move', () => {
    const s = sanitizeSettings({ noPan: true, noMove: false });
    expect(s.noMove).toBe(true);
    expect(s.noPan).toBe(true);
  });
  it('keeps the base for anything unknown', () => {
    const base = { ...DEFAULT_SETTINGS, rounds: 7, pack: 'asia' as const };
    const s = sanitizeSettings({ mode: 'hexagon' as never, pack: 'mars' as never }, base);
    expect(s.mode).toBe('classic');
    expect(s.rounds).toBe(7);
    expect(s.pack).toBe('asia');
  });
});

describe('sanitizeName / sanitizeFace', () => {
  it('collapses whitespace, cuts at 16 and falls back to Player', () => {
    expect(sanitizeName('  Ada   Lovelace of Somewhere  ')).toBe('Ada Lovelace of ');
    expect(sanitizeName('')).toBe('Player');
    expect(sanitizeName(undefined)).toBe('Player');
  });
  it('accepts only 32-bit integers as faces', () => {
    expect(sanitizeFace(42)).toBe(42);
    expect(sanitizeFace('42')).toBe(42);
    expect(sanitizeFace(-1)).toBeNull();
    expect(sanitizeFace(2 ** 32)).toBeNull();
    expect(sanitizeFace(1.5)).toBeNull();
  });
});

describe('lobby', () => {
  it('makes the first player host, gives unique names and distinct colours', () => {
    const room = new Room('ABCD', fixedFinder());
    const a = room.addPlayer('Max', socket());
    const b = room.addPlayer('max', socket());
    expect(room.hostId).toBe(a.id);
    expect(b.name).toBe('max 2');
    expect(a.color).not.toBe(b.color);
    expect(room.snapshot().players.map((p) => p.isHost)).toEqual([true, false]);
  });

  it('lets only the host change settings and refuses taken colours', () => {
    const { room, ada, bob } = lobby();
    expect(() => room.updateSettings(bob.id, { rounds: 3 })).toThrow(GameError);
    room.updateSettings(ada.id, { rounds: 3 });
    expect(room.settings.rounds).toBe(3);
    expect(() => room.setColor(bob.id, ada.color)).toThrowError(failsWith('colorTaken'));
  });

  it('bans a kicked name for the room', () => {
    const { room, ada, bob } = lobby();
    room.kick(ada.id, bob.id);
    expect(room.players.size).toBe(1);
    expect(() => room.addPlayer('Bob', socket())).toThrowError(failsWith('banned'));
  });
});

describe('wishes', () => {
  it('turns every ballot into a whole wish: unset is off, the pack the world', () => {
    const { room, ada, bob } = lobby();
    room.vote(ada.id, 'noZoom', true);
    room.vote(bob.id, 'pack', 'asia');
    const tally = room.voteTally();
    expect(tally.noZoom).toEqual({ yes: [ada.id], no: [bob.id] });
    expect(tally.noMove).toEqual({ yes: [], no: [ada.id, bob.id] });
    expect(tally.pack).toEqual({ world: [ada.id], asia: [bob.id] });
  });

  it('counts nobody who set nothing, or took everything back', () => {
    const { room, ada } = lobby();
    room.vote(ada.id, 'noZoom', true);
    room.vote(ada.id, 'noZoom', null);
    expect(room.voteTally().pack).toEqual({});
  });

  it('pulls No Move along with a wish for No Pan', () => {
    const { room, ada } = lobby();
    room.vote(ada.id, 'noPan', true);
    expect(room.voteTally().noMove.yes).toEqual([ada.id]);
    room.vote(ada.id, 'noMove', false);
    expect(room.voteTally().noPan.yes).toEqual([]);
  });

  it('refuses wishes on what the host locked', () => {
    const { room, ada, bob } = lobby();
    room.updateSettings(ada.id, { pack: 'europe', locked: { ...DEFAULT_SETTINGS.locked, pack: true } });
    expect(() => room.vote(bob.id, 'pack', 'asia')).toThrowError(failsWith('hostLocked'));
  });

  it('drops the wish of whoever leaves the lobby', () => {
    const { room, bob } = lobby();
    room.vote(bob.id, 'noMove', true);
    room.markDisconnected(bob.id);
    expect(room.voteTally().noMove.yes).toEqual([]);
  });
});

describe('the draw', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('applies the drawn wish as it is, even against the majority', async () => {
    const { room, ada, bob } = lobby(fixedFinder(), { random: () => 0.99 });
    const cy = room.addPlayer('Cy', socket());
    room.vote(ada.id, 'pack', 'europe');
    room.vote(bob.id, 'pack', 'europe');
    room.vote(cy.id, 'pack', 'africa');
    room.vote(cy.id, 'noPan', true);
    await startGame(room);
    expect(room.settings).toMatchObject({ pack: 'africa', noMove: true, noPan: true, noZoom: false });
    expect(room.snapshot().draw).toMatchObject({ playerId: cy.id, name: 'Cy', alike: [], wishes: 3 });
  });

  it('lays the locks over the drawn wish and finds the alike ones after them', async () => {
    const { room, ada, bob } = lobby(fixedFinder(), { random: () => 0 });
    room.vote(ada.id, 'pack', 'asia');
    room.vote(bob.id, 'pack', 'africa');
    room.updateSettings(ada.id, { pack: 'dach', locked: { ...DEFAULT_SETTINGS.locked, pack: true } });
    await startGame(room);
    expect(room.settings.pack).toBe('dach');
    expect(room.snapshot().draw).toMatchObject({ playerId: ada.id, alike: [bob.id], locked: ['pack'] });
  });

  it('draws nothing without wishes and falls back to the defaults', async () => {
    const { room, ada } = lobby();
    room.updateSettings(ada.id, { noZoom: true });
    await startGame(room);
    expect(room.snapshot().draw).toBeNull();
    expect(room.settings).toMatchObject({ pack: 'world', noMove: false, noZoom: false });
  });

  it('holds the first round until everyone has seen the drawn wish', async () => {
    const { room, ada, bob } = lobby(fixedFinder(), { drawRevealMs: 1000 });
    room.vote(ada.id, 'noZoom', true);
    await room.setReady(ada.id, true);
    const started = room.setReady(bob.id, true);
    await vi.advanceTimersByTimeAsync(900);
    expect(room.phase).toBe('loading');
    await vi.advanceTimersByTimeAsync(200);
    await started;
    expect(room.phase).toBe('playing');
  });

  it('forgets the draw back in the lobby but keeps the wishes', async () => {
    const { room, ada } = lobby();
    room.vote(ada.id, 'noZoom', true);
    await startGame(room);
    room.backToLobby(ada.id);
    expect(room.snapshot().draw).toBeNull();
    expect(room.voteTally().noZoom.yes).toEqual([ada.id]);
  });
});

describe('a classic game', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs through rounds, scores pins and finishes with titles', async () => {
    const { room, ada, bob } = lobby();
    room.updateSettings(ada.id, { rounds: 2, timeLimit: 30 });
    const events = { onChange: vi.fn(), onRoundStart: vi.fn(), onPins: vi.fn(), onReveal: vi.fn(), onFinal: vi.fn() };
    room.events = events;

    await startGame(room);
    expect(room.phase).toBe('playing');
    expect(events.onRoundStart).toHaveBeenCalledTimes(1);
    expect(room.roundPayload()).toMatchObject({ t: 'round', round: 1, totalRounds: 2, panoId: 'pano-0' });

    // Ada nails it, Bob is in Paris (the target is Berlin).
    room.submitGuess(ada.id, BERLIN.lat, BERLIN.lng);
    expect(room.phase).toBe('playing'); // Bob has not submitted yet
    room.setPin(bob.id, PARIS.lat, PARIS.lng);
    room.submitGuess(bob.id, PARIS.lat, PARIS.lng);

    expect(room.phase).toBe('reveal');
    const reveal = room.lastRoundResults!;
    expect(reveal.results[0]).toMatchObject({ playerId: ada.id, points: 5000 });
    expect(reveal.results[1]!.points).toBeLessThan(5000);
    expect(reveal.results[1]!.distanceKm).toBeCloseTo(878, -1);
    expect(reveal.isLastRound).toBe(false);

    // Round two ends by timeout: Bob's unsubmitted pin still counts.
    await room.next(ada.id);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 10);
    room.setPin(bob.id, PARIS.lat, PARIS.lng);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(room.phase).toBe('reveal');
    expect(room.lastRoundResults!.results.find((r) => r.playerId === bob.id)!.points).toBe(5000);
    expect(room.lastRoundResults!.results.find((r) => r.playerId === ada.id)!.guess).toBeNull();

    await room.next(ada.id);
    expect(room.phase).toBe('finished');
    expect(events.onFinal).toHaveBeenCalledTimes(1);
    const { titles, metrics } = room.finalStats();
    expect(Object.keys(titles)).toHaveLength(2);
    expect(metrics.find((m) => m.key === 'score')!.values.find((v) => v.playerId === ada.id)!.value).toBe(5000);
    expect(room.leaderboard()[0]!.playerId).toBe(bob.id);
    expect(room.winners().map((p) => p.name)).toEqual(['Bob']);
    expect(room.gameSummary().players.map((p) => p.rounds.length)).toEqual([2, 2]);
  });

  it('sends the way of every pin with the reveal, nudges merged', async () => {
    const { room, ada, bob } = lobby();
    await startGame(room);

    room.setPin(ada.id, TOKYO.lat, TOKYO.lng);
    room.setPin(ada.id, PARIS.lat, PARIS.lng);
    room.setPin(ada.id, PARIS.lat + 0.001, PARIS.lng); // a nudge of ~100 m
    room.submitGuess(ada.id, BERLIN.lat, BERLIN.lng);
    room.submitGuess(bob.id, PARIS.lat, PARIS.lng);

    const results = room.lastRoundResults!.results;
    const trail = results.find((r) => r.playerId === ada.id)!.trail!;
    const expected = [TOKYO, { lat: PARIS.lat + 0.001, lng: PARIS.lng }, BERLIN];
    expect(trail).toHaveLength(expected.length);
    trail.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(expected[i]!.lat, 6);
      expect(p.lng).toBeCloseTo(expected[i]!.lng, 6);
    });
    // One pin is no way at all.
    expect(results.find((r) => r.playerId === bob.id)!.trail).toBeUndefined();
  });

  it('lets a player take the ready back - the round waits, the last pin counts', async () => {
    const { room, ada, bob } = lobby();
    await startGame(room);

    room.submitGuess(ada.id, TOKYO.lat, TOKYO.lng);
    await vi.advanceTimersByTimeAsync(1000);
    room.withdrawGuess(ada.id);
    room.submitGuess(bob.id, PARIS.lat, PARIS.lng);
    expect(room.phase).toBe('playing'); // Ada is no longer ready

    await vi.advanceTimersByTimeAsync(1000);
    room.setPin(ada.id, BERLIN.lat, BERLIN.lng);
    room.submitGuess(ada.id, BERLIN.lat, BERLIN.lng);
    expect(room.phase).toBe('reveal');
    expect(room.lastRoundResults!.results.find((r) => r.playerId === ada.id)!.points).toBe(5000);
    // The rank follows the final ready: Bob was first.
    expect(room.players.get(bob.id)!.stats[0]!.confirmRank).toBe(1);
    expect(room.players.get(ada.id)!.stats[0]!.confirmRank).toBe(2);
  });

  it('thins a long way out to a dozen stops, first and last kept', async () => {
    const { room, ada, bob } = lobby();
    await startGame(room);

    for (let i = 0; i < 40; i++) room.setPin(ada.id, 10 + i, 20);
    room.submitGuess(ada.id, 60, 20);
    room.submitGuess(bob.id, PARIS.lat, PARIS.lng);

    const trail = room.lastRoundResults!.results.find((r) => r.playerId === ada.id)!.trail!;
    expect(trail).toHaveLength(12);
    expect(trail[0]).toMatchObject({ lat: 10, lng: 20 });
    expect(trail.at(-1)).toMatchObject({ lat: 60, lng: 20 });
  });

  it('refuses pins during the countdown and while paused', async () => {
    const { room, ada } = lobby();
    room.updateSettings(ada.id, { rounds: 1 });
    for (const p of room.players.values()) await room.setReady(p.id, true);
    expect(() => room.setPin(ada.id, 0, 0)).toThrowError(failsWith('roundNotStarted'));
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 10);
    room.pause(ada.id);
    expect(() => room.setPin(ada.id, 0, 0)).toThrowError(failsWith('roundPaused'));
    room.resume(ada.id);
    room.setPin(ada.id, 0, 0);
  });

  it('puts a late joiner on the bench until the next round', async () => {
    const { room, ada, bob } = lobby();
    room.updateSettings(ada.id, { rounds: 2 });
    await startGame(room);
    const carl = room.addPlayer('Carl', socket());
    expect(room.isSpectator(carl)).toBe(true);
    expect(room.spectatorReason(carl)).toBe('nextRound');
    expect(() => room.submitGuess(carl.id, 0, 0)).toThrowError(failsWith('spectating'));
    room.submitGuess(ada.id, 0, 0);
    room.submitGuess(bob.id, 0, 0); // Carl holds nobody up
    expect(room.phase).toBe('reveal');
    await room.next(ada.id);
    expect(room.isSpectator(carl)).toBe(false);
  });
});

describe('a duel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('deals the gap to the best guess as damage and knocks out at zero', async () => {
    const { room, ada, bob } = lobby();
    room.updateSettings(ada.id, { mode: 'duel', hp: 1000 });
    await startGame(room);
    expect(ada.hp).toBe(1000);

    room.submitGuess(ada.id, BERLIN.lat, BERLIN.lng);
    room.submitGuess(bob.id, TOKYO.lat, TOKYO.lng);
    const r = room.lastRoundResults!;
    const bobRow = r.results.find((x) => x.playerId === bob.id)!;
    expect(bobRow.damage).toBe(5000 - bobRow.points);
    expect(bobRow.knockedOut).toBe(true);
    expect(bob.hp).toBe(0);
    expect(r.isLastRound).toBe(true);
    expect(room.duelDecided()).toBe(true);

    await room.next(ada.id);
    expect(room.phase).toBe('finished');
    expect(room.winners().map((p) => p.name)).toEqual(['Ada']);
    expect(room.leaderboard().map((p) => p.name)).toEqual(['Ada', 'Bob']);
  });

  it('needs two players and one per team', async () => {
    const room = new Room('ABCD', fixedFinder());
    const ada = room.addPlayer('Ada', socket());
    room.updateSettings(ada.id, { mode: 'duel' });
    await expect(room.start(ada.id)).rejects.toMatchObject({ code: 'duelNeedsTwo' });
    const bob = room.addPlayer('Bob', socket());
    room.updateSettings(ada.id, { teams: true });
    room.setTeam(bob.id, ada.team);
    await expect(room.start(ada.id)).rejects.toMatchObject({ code: 'teamEmpty' });
  });

  it('shares one HP bar per team and scores the team average', async () => {
    const room = new Room('ABCD', fixedFinder());
    const ada = room.addPlayer('Ada', socket());
    const bob = room.addPlayer('Bob', socket());
    const carl = room.addPlayer('Carl', socket());
    room.updateSettings(ada.id, { mode: 'duel', teams: true, hp: 6000 });
    // Ada and Carl in red, Bob alone in blue.
    room.setTeam(carl.id, ada.team);
    room.setTeam(bob.id, ada.team === 'red' ? 'blue' : 'red');
    await startGame(room);

    room.submitGuess(ada.id, BERLIN.lat, BERLIN.lng);   // 5000
    room.submitGuess(carl.id, TOKYO.lat, TOKYO.lng);    // ~ 0-ish
    room.submitGuess(bob.id, PARIS.lat, PARIS.lng);     // ~ 2775
    const teams = room.lastRoundResults!.teams!;
    const red = teams.find((t) => t.id === ada.team)!;
    const blue = teams.find((t) => t.id === bob.team)!;
    const carlPoints = room.lastRoundResults!.results.find((x) => x.playerId === carl.id)!.points;
    expect(red.avg).toBe(Math.round((5000 + carlPoints) / 2));
    const bobPoints = room.lastRoundResults!.results.find((x) => x.playerId === bob.id)!.points;
    const better = Math.max(red.avg!, bobPoints);
    expect(blue.damage).toBe(Math.round(better - bobPoints));
    expect(red.damage).toBe(Math.round(better - (5000 + carlPoints) / 2));
    expect(ada.hp).toBe(carl.hp);
    expect(room.teamStandings()!.map((t) => t.members.length)).toEqual(expect.arrayContaining([2, 1]));
  });
});
