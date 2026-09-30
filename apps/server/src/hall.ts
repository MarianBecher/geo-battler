// Hall of Fame - the only thing that survives a server restart.
//
// Rooms live in memory and are gone after the evening. What should remain
// are the records: the best guess of all time, who won the most games in a
// row, how often someone landed a perfect hit. That is what turns single games into a
// running rivalry.
//
// Storage is a single JSON file. No schema, no database - for a handful of
// players and a few hundred games that is the right size.
//
// Players are recognised by name (lower-cased, whitespace collapsed). Two
// different "Max" would be the same person - for an after-work round that is
// the right trade-off against accounts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_POINTS, type GameMode, type HallRecords, type HallView, type LatLng, type PlayerProfile, type Settings, type TitleId } from '@geo-battler/shared';
import { continentOf } from './continents.ts';

const VERSION = 1;

/** The personal stats remember every round - but not forever (~80 bytes each). */
const HISTORY_LIMIT = 2000;
/** How much of that goes to the client: the map, the form chart, the countries. */
const MAP_ROUNDS = 400;
const FORM_GAMES = 30;
/** Rating a country after a single round would be luck. */
const COUNTRY_MIN_ROUNDS = 2;

/** What a finished game hands over (see Room.gameSummary). */
export interface GameSummary {
  at: number;
  mode: GameMode;
  rounds: number;
  settings: Settings;
  /** In a duel the winner is not the top scorer but whoever is left. */
  winners: string[];
  players: {
    name: string;
    face: number | null;
    score: number;
    title: TitleId | null;
    rounds: {
      points: number;
      distanceKm: number | null;
      continentHit: boolean | null;
      place: string | null;
      actual: LatLng | null;
      countryCode: string | null;
      guess: LatLng | null;
    }[];
  }[];
}

/** One round, as small as possible - thousands of these sit in the file. */
interface CompactRound {
  at: string;
  mode: GameMode;
  a: [number, number];
  g: [number, number] | null;
  km: number | null;
  pts: number;
  cc: string | null;
}

interface HallPlayerRecord {
  name: string;
  face?: number | null;
  games: number;
  wins: number;
  rounds: number;
  /** Sum of round points on the world pack - basis for the average. */
  points: number;
  /** Rounds on the world pack - the denominator. */
  worldRounds: number;
  /** Rounds with a guess (without one there is no distance). */
  guesses: number;
  perfects: number;
  continentHits: number;
  bestGameScore: number;
  bestDistanceKm: number | null;
  /** Wins in a row: the running count, when it started, and the longest ever. */
  streak: number;
  streakSince: string | null;
  bestStreak: number;
  /** title id -> how often it was awarded */
  titles: Partial<Record<TitleId, number>>;
  lastSeen: string | null;
  history: CompactRound[];
}

/** Whether a streak is still alive is derived at view time, not stored. */
type StoredRecords = Omit<HallRecords, 'bestStreak'> & { bestStreak?: Omit<NonNullable<HallRecords['bestStreak']>, 'live'> };

interface HallData {
  version: number;
  games: number;
  rounds: number;
  updatedAt: string | null;
  players: Record<string, HallPlayerRecord>;
  records: StoredRecords;
}

const emptyHall = (): HallData => ({ version: VERSION, games: 0, rounds: 0, updatedAt: null, players: {}, records: {} });

const keyOf = (name: string): string => name.replace(/\s+/g, ' ').trim().toLowerCase();

const emptyPlayer = (name: string): HallPlayerRecord => ({
  name, games: 0, wins: 0, rounds: 0, points: 0, worldRounds: 0, guesses: 0, perfects: 0, continentHits: 0,
  bestGameScore: 0, bestDistanceKm: null, streak: 0, streakSince: null, bestStreak: 0, titles: {}, lastSeen: null, history: [],
});

/** ~10 m - the map needs no more. */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function compactRound(round: GameSummary['players'][number]['rounds'][number] & { actual: LatLng }, at: string, mode: GameMode): CompactRound {
  return {
    at,
    mode,
    a: [r4(round.actual.lat), r4(round.actual.lng)],
    g: round.guess ? [r4(round.guess.lat), r4(round.guess.lng)] : null,
    km: round.distanceKm !== null && Number.isFinite(round.distanceKm) ? Math.round(round.distanceKm * 100) / 100 : null,
    pts: round.points,
    cc: round.countryCode,
  };
}

const average = (list: number[]): number | null => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function groupBy<T, K>(list: T[], keyFn: (item: T) => K | null): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of list) {
    const k = keyFn(item);
    if (k === null || k === undefined) continue;
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

export class Hall {
  private data: HallData = emptyHall();
  private writing: Promise<void> | null = null;
  private pending = false;

  constructor(readonly file: string) {}

  /**
   * Reads the state from disk. The file is the source of truth, not memory:
   * whoever deletes it has cleared the hall right there, without touching
   * the server. It is a few kilobytes and read at most once per game.
   */
  async read(): Promise<HallData> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<HallData>;
      if (raw.version === VERSION) {
        const data = { ...emptyHall(), ...raw };
        // Fields added since the file was written start at their defaults.
        for (const [id, p] of Object.entries(data.players)) data.players[id] = { ...emptyPlayer(p.name), ...p };
        // "Best round" was dropped - it was always the best guess in points.
        delete (data.records as { bestRound?: unknown }).bestRound;
        return data;
      }
      // Leave an older format alone rather than misreading it.
      console.warn(`[hall] ${this.file} has version ${String(raw.version)} - ignored.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[hall] ${this.file} unreadable: ${(err as Error).message}`);
    }
    return emptyHall();
  }

  async load(): Promise<this> {
    this.data = await this.read();
    return this;
  }

  /**
   * Writes via a temporary file and `rename`, so a crash mid-write never
   * leaves half a hall behind. Several changes in quick succession collapse
   * into one write.
   */
  save(): Promise<void> {
    if (this.writing) {
      this.pending = true;
      return this.writing;
    }
    this.writing = (async () => {
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
        await fs.rename(tmp, this.file);
      } catch (err) {
        console.warn(`[hall] save failed: ${(err as Error).message}`);
      } finally {
        this.writing = null;
        if (this.pending) {
          this.pending = false;
          void this.save();
        }
      }
    })();
    return this.writing;
  }

  /** Records a finished game. */
  async record(summary: GameSummary): Promise<void> {
    if (!summary.rounds || !summary.players.length) return;
    this.data = await this.read();

    const at = new Date(summary.at).toISOString();
    // A win against yourself is none - and a loss against yourself neither,
    // so a solo game leaves the streak alone.
    const contested = summary.players.length > 1;
    const winners = contested ? new Set(summary.winners) : new Set<string>();
    // A duel lasts as long as it lasts - its point total cannot be compared
    // with a game over a fixed number of rounds.
    const comparable = summary.mode !== 'duel';
    // On a small map pack every guess is closer - records for rounds and
    // guesses therefore only count on the whole world.
    const worldwide = summary.settings.pack === 'world';

    this.data.games++;
    this.data.rounds += summary.rounds;

    for (const player of summary.players) {
      const id = keyOf(player.name);
      if (!id) continue;
      const entry = this.data.players[id] ?? emptyPlayer(player.name);

      entry.name = player.name; // the spelling used last wins
      if (player.face !== null) entry.face = player.face; // likewise the last photo
      entry.games++;
      entry.rounds += player.rounds.length;
      if (worldwide) {
        entry.worldRounds += player.rounds.length;
        entry.points += player.score;
      }
      entry.lastSeen = at;
      if (winners.has(player.name)) {
        entry.wins++;
        entry.streak++;
        if (entry.streak === 1) entry.streakSince = at;
        entry.bestStreak = Math.max(entry.bestStreak, entry.streak);
      } else if (contested) {
        entry.streak = 0;
        entry.streakSince = null;
      }
      if (comparable && worldwide) entry.bestGameScore = Math.max(entry.bestGameScore, player.score);
      if (player.title) entry.titles[player.title] = (entry.titles[player.title] ?? 0) + 1;

      for (const round of player.rounds) {
        if (round.actual) entry.history.push(compactRound({ ...round, actual: round.actual }, at, summary.mode));
        if (round.points >= MAX_POINTS) entry.perfects++;
        if (round.continentHit) entry.continentHits++;
        if (round.distanceKm !== null) {
          entry.guesses++;
          if (worldwide && (entry.bestDistanceKm === null || round.distanceKm < entry.bestDistanceKm)) entry.bestDistanceKm = round.distanceKm;
        }
      }

      if (entry.history.length > HISTORY_LIMIT) entry.history.splice(0, entry.history.length - HISTORY_LIMIT);

      this.data.players[id] = entry;
      this.updateRecords(player, entry, at, comparable && worldwide, worldwide);
    }

    this.data.updatedAt = at;
    await this.save();
  }

  /**
   * The three records that hold across all evenings. `gameComparable`: the
   * point total may compete for the best game; `roundComparable`: single
   * rounds may compete for the best guess. The win streak competes always -
   * a win is a win on every pack. Ties leave the record with whoever set it.
   *
   * There is deliberately no "best round" - points are a function of the
   * distance, so it would always be the same round as the best guess.
   */
  private updateRecords(player: GameSummary['players'][number], entry: HallPlayerRecord, at: string, gameComparable: boolean, roundComparable: boolean): void {
    const records = this.data.records;

    if (entry.streak > (records.bestStreak?.wins ?? 0) && entry.streakSince) {
      records.bestStreak = { name: player.name, wins: entry.streak, from: entry.streakSince, to: at };
    }

    if (gameComparable && (!records.bestGame || player.score > records.bestGame.score)) {
      records.bestGame = { name: player.name, score: player.score, rounds: player.rounds.length, at };
    }

    if (!roundComparable) return;
    for (const round of player.rounds) {
      if (round.distanceKm === null) continue;
      if (!records.bestGuess || round.distanceKm < records.bestGuess.distanceKm) {
        records.bestGuess = { name: player.name, distanceKm: round.distanceKm, place: round.place, at };
      }
    }
  }

  /** The client's view: records plus a sorted player table. The average is per round. */
  async view(): Promise<HallView> {
    this.data = await this.read();

    const players = Object.values(this.data.players)
      .map((p) => {
        const [favouriteTitle, favouriteTitleCount] = (Object.entries(p.titles) as [TitleId, number][]).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
        return {
          name: p.name,
          face: p.face ?? null,
          games: p.games,
          wins: p.wins,
          rounds: p.rounds,
          avgPoints: p.worldRounds ? p.points / p.worldRounds : 0,
          bestGameScore: p.bestGameScore,
          bestDistanceKm: p.bestDistanceKm,
          streak: p.streak,
          bestStreak: p.bestStreak,
          perfects: p.perfects,
          continentHits: p.continentHits,
          favouriteTitle,
          favouriteTitleCount,
          lastSeen: p.lastSeen,
          hasProfile: p.history.length > 0,
        };
      })
      .sort((a, b) => b.wins - a.wins || b.avgPoints - a.avgPoints || a.name.localeCompare(b.name));

    const { bestStreak, ...rest } = this.data.records;
    const holder = bestStreak && this.data.players[keyOf(bestStreak.name)];
    const records: HallRecords = bestStreak ? { ...rest, bestStreak: { ...bestStreak, live: holder?.streak === bestStreak.wins } } : rest;

    return { games: this.data.games, rounds: this.data.rounds, updatedAt: this.data.updatedAt, records, players };
  }

  /** A player's personal stats, or null if the name is unknown. */
  async playerView(name: string): Promise<PlayerProfile | null> {
    this.data = await this.read();
    const p = this.data.players[keyOf(name)];
    if (!p) return null;

    const history = p.history;
    const guessed = history.filter((r): r is CompactRound & { km: number } => r.km !== null);
    const targetContinent = (r: CompactRound) => continentOf({ lat: r.a[0], lng: r.a[1] });

    // By continent of the target - and how often the guess at least landed there.
    const continents = [...groupBy(history, targetContinent)]
      .map(([code, rows]) => ({
        code,
        rounds: rows.length,
        avgPoints: Math.round(average(rows.map((r) => r.pts)) ?? 0),
        medianKm: median(rows.flatMap((r) => (r.km === null ? [] : [r.km]))),
        hitRate: rows.filter((r) => r.g && continentOf({ lat: r.g[0], lng: r.g[1] }) === code).length / rows.length,
      }))
      .sort((a, b) => b.avgPoints - a.avgPoints);

    // Countries only after a few rounds - sorted from strongest to weakest.
    const countries = [...groupBy(history, (r) => r.cc)]
      .filter(([, rows]) => rows.length >= COUNTRY_MIN_ROUNDS)
      .map(([code, rows]) => ({ code, rounds: rows.length, avgPoints: Math.round(average(rows.map((r) => r.pts)) ?? 0) }))
      .sort((a, b) => b.avgPoints - a.avgPoints || b.rounds - a.rounds);

    // Form: average per game. A game is recognised by the shared timestamp of its rounds.
    const form = [...groupBy(history, (r) => r.at)]
      .map(([at, rows]) => ({ at, mode: rows[0]!.mode, rounds: rows.length, avgPoints: Math.round(average(rows.map((r) => r.pts)) ?? 0) }))
      .slice(-FORM_GAMES);

    return {
      name: p.name,
      face: p.face ?? null,
      games: p.games,
      wins: p.wins,
      since: history[0]?.at ?? null,
      rounds: history.length,
      avgPoints: history.length ? Math.round(average(history.map((r) => r.pts)) ?? 0) : null,
      medianKm: median(guessed.map((r) => r.km)),
      perfects: history.filter((r) => r.pts >= MAX_POINTS).length,
      continents,
      countries,
      form,
      map: history.slice(-MAP_ROUNDS).map(({ a, g, pts, km, cc }) => ({ a, g, pts, km, cc })),
    };
  }
}
