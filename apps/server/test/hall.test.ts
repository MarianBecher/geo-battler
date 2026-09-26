import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hall, median, type GameSummary } from '../src/hall.ts';
import { DEFAULT_SETTINGS } from '@geo-battler/shared';

const summary = (over: Partial<GameSummary> = {}): GameSummary => ({
  at: Date.parse('2026-09-26T18:00:00Z'),
  mode: 'classic',
  rounds: 2,
  settings: DEFAULT_SETTINGS,
  winners: ['Ada'],
  players: [
    { name: 'Ada', face: 7, score: 9000, title: 'sharpshooter', rounds: [
      { points: 5000, distanceKm: 0.01, continentHit: true, place: 'Berlin, Germany', actual: { lat: 52.5, lng: 13.4 }, countryCode: 'DE', guess: { lat: 52.5, lng: 13.4 } },
      { points: 4000, distanceKm: 300, continentHit: true, place: 'Paris, France', actual: { lat: 48.9, lng: 2.4 }, countryCode: 'FR', guess: { lat: 50, lng: 5 } },
    ] },
    { name: 'Bob', face: null, score: 1000, title: 'ghost', rounds: [
      { points: 1000, distanceKm: 2500, continentHit: true, place: 'Berlin, Germany', actual: { lat: 52.5, lng: 13.4 }, countryCode: 'DE', guess: { lat: 40, lng: 20 } },
      { points: 0, distanceKm: null, continentHit: null, place: 'Paris, France', actual: { lat: 48.9, lng: 2.4 }, countryCode: 'FR', guess: null },
    ] },
  ],
  ...over,
});

describe('Hall', () => {
  let dir: string;
  let hall: Hall;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hall-'));
    hall = await new Hall(path.join(dir, 'sub', 'hall.json')).load();
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('starts empty', async () => {
    expect(await hall.view()).toMatchObject({ games: 0, rounds: 0, players: [], records: {} });
  });

  it('records a game, keeps records and sorts players by wins then average', async () => {
    await hall.record(summary());
    const view = await hall.view();
    expect(view.games).toBe(1);
    expect(view.rounds).toBe(2);
    expect(view.players.map((p) => p.name)).toEqual(['Ada', 'Bob']);
    expect(view.players[0]).toMatchObject({ wins: 1, perfects: 1, avgPoints: 4500, favouriteTitle: 'sharpshooter', hasProfile: true, face: 7 });
    expect(view.records.bestGuess).toMatchObject({ name: 'Ada', distanceKm: 0.01, place: 'Berlin, Germany' });
    expect(view.records.bestGame).toMatchObject({ name: 'Ada', score: 9000, rounds: 2 });
    expect(view.records.bestRound).toMatchObject({ name: 'Ada', points: 5000 });
  });

  it('lets a duel set round records but not the best game', async () => {
    await hall.record(summary({ mode: 'duel' }));
    const { records } = await hall.view();
    expect(records.bestGame).toBeUndefined();
    expect(records.bestGuess).toMatchObject({ name: 'Ada' });
  });

  it('keeps small map packs out of every record and the average', async () => {
    await hall.record(summary({ settings: { ...DEFAULT_SETTINGS, pack: 'europe' } }));
    const view = await hall.view();
    expect(view.records).toEqual({});
    expect(view.players[0]!.avgPoints).toBe(0);
    expect(view.players[0]!.games).toBe(1);
  });

  it('recognises players by name regardless of case and spacing', async () => {
    await hall.record(summary());
    await hall.record(summary({ players: [{ ...summary().players[0]!, name: ' ADA ' }] , winners: [] }));
    const view = await hall.view();
    expect(view.players.filter((p) => p.name.trim().toLowerCase() === 'ada')).toHaveLength(1);
    expect(view.players[0]!.games).toBe(2);
  });

  it('builds the personal stats from the round history', async () => {
    await hall.record(summary());
    const profile = (await hall.playerView('ada'))!;
    expect(profile.rounds).toBe(2);
    expect(profile.avgPoints).toBe(4500);
    expect(profile.continents).toEqual([expect.objectContaining({ code: 'EU', rounds: 2, hitRate: 1 })]);
    expect(profile.map).toHaveLength(2);
    expect(profile.form).toEqual([expect.objectContaining({ rounds: 2, avgPoints: 4500 })]);
    expect(await hall.playerView('nobody')).toBeNull();
  });

  it('re-reads the file before every change, so deleting it clears the hall', async () => {
    await hall.record(summary());
    await fs.unlink(hall.file);
    expect((await hall.view()).games).toBe(0);
  });
});

describe('median', () => {
  it('handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
