// Titles and the statistics table for the final screen.
//
// Every title is a test on a player's summary (see summarize below) and
// describes a superlative anyway - if it matches, it fits. If several match,
// chance decides, weighted by `weight`: a hard-to-earn title beats the
// everyday observation without always displacing it. Duplicate titles in one
// game are avoided as long as someone still has an alternative.
//
// Nothing here is prose: a title is an id, its facts are typed records, and
// the metrics table carries raw numbers. The client translates and formats.

import {
  distanceKm, pointsFor, titleGroupOf, METRIC_KEYS,
  type AwardedTitle, type ContinentCode, type Fact, type LatLng, type MetricDirection, type MetricKey, type MetricRow, type MetricUnit, type Settings, type TitleId,
} from '@geo-battler/shared';
import { continentOf } from './continents.ts';
import type { RoundStat } from './stats.ts';

// --- Input ---------------------------------------------------------------

export interface PlayerEntry {
  playerId: string;
  name: string;
  color: string;
  score: number;
  rounds: RoundStat[];
}

/** Duel: the damage of every round, as the reveal reported it. */
export interface DuelRound {
  round: number;
  /** playerId -> damage taken; only players still in the race. */
  damage: Map<string, number>;
  knockedOut: Set<string>;
}

export interface DuelLog {
  startHp: number;
  teams: boolean;
  rounds: DuelRound[];
  /** playerId -> hit points at the end */
  hpLeft: Map<string, number>;
}

export interface TitleContext {
  /** round -> ids of the players who won it */
  roundWinners: Map<number, Set<string>>;
  /** round -> the actual location */
  actuals: Map<number, LatLng>;
  /** How far apart the targets of the game were. */
  actualSpreadKm: number;
  settings: Settings;
  timeLimitMs: number;
  /** Only in a duel. */
  duel: DuelLog | null;
}

interface Context extends TitleContext {
  /** round -> how many submitted at all */
  confirmCounts: Map<number, number>;
  /** round -> the points of everyone who guessed in it */
  roundPoints: Map<number, number[]>;
  /** Classic: playerId -> total before the last round (for "Buzzer Beater" and "Choker"). */
  scoreBeforeLast: Map<string, number>;
  lastRound: number;
}

// --- Small helpers ---------------------------------------------------------

const sum = (list: number[]): number => list.reduce((a, b) => a + b, 0);
const avg = (list: number[]): number => (list.length ? sum(list) / list.length : 0);

function stdDev(list: number[]): number {
  if (list.length < 2) return 0;
  const m = avg(list);
  return Math.sqrt(avg(list.map((v) => (v - m) ** 2)));
}

type Pick = (s: Summary) => number;

/** Is this player the leader in a metric? */
function isTop(s: Summary, all: Summary[], pick: Pick, min: number): boolean {
  if (all.length < 2) return false;
  const value = pick(s);
  if (!Number.isFinite(value) || value < min) return false;
  return all.every((other) => pick(other) <= value);
}

/** ... or the tail light? */
function isBottom(s: Summary, all: Summary[], pick: Pick, max: number): boolean {
  if (all.length < 2) return false;
  const value = pick(s);
  if (!Number.isFinite(value) || value > max) return false;
  return all.every((other) => pick(other) >= value);
}

/** Classic with a last round worth looking at: the lead before it is only known after two rounds. */
const isLastRoundSwing = (ctx: Context, all: Summary[]): boolean => ctx.settings.mode === 'classic' && ctx.lastRound >= 2 && all.length >= 2;

/** Gap to the leader - for "Photo Finish". */
const scoreGap = (s: Summary, all: Summary[]): number => Math.max(...all.map((x) => x.score)) - s.score;

// --- Per-player summary ----------------------------------------------------

interface RegionSummary {
  code: ContinentCode;
  rounds: number;
  avgPoints: number;
}

/** A round in which a pin already lay close to the target - and was moved away again. */
interface LetGo {
  closestKm: number;
  finalKm: number;
  /** Points the closest pin would have earned, minus what was earned. */
  points: number;
}

/** The continent a player is good at - and the rest of the world, where they are not. */
interface Specialty extends RegionSummary {
  elsewhereAvg: number;
  elsewhereRounds: number;
}

interface DuelSummary {
  hpLeft: number;
  damageTaken: number;
  /** Damage the others took in the rounds this player set the mark. */
  damageDealt: number;
  /** Set the mark in the round that decided the game. */
  finalBlow: { round: number; knockouts: number } | null;
}

interface Rival {
  name: string;
  rounds: number;
  avgKm: number;
}

export interface Summary {
  playerId: string;
  name: string;
  color: string;
  score: number;
  roundCount: number;
  played: number;
  missed: number;
  points: number[];
  avgPoints: number;
  pointsSpread: number;
  bestRoundPoints: number;
  perfectRounds: number;
  zeroRounds: number;
  bestRoundShare: number;
  firstHalfAvg: number;
  secondHalfAvg: number;
  rising: boolean;
  comebackJump: number;
  bestDistanceKm: number | null;
  worstDistanceKm: number | null;
  avgDistanceKm: number | null;
  totalDistanceKm: number;
  roundWins: number;
  winStreak: number;
  secondPlaces: number;
  scoreBeforeLast: number | null;
  lastRoundPoints: number;
  avgPins: number;
  maxPins: number;
  avgPinPathKm: number;
  avgMoveKm: number;
  fineTuneRounds: number;
  anchorRounds: number;
  gutFeelingRounds: number;
  /** The round with the most points given away by moving a close pin away. */
  biggestLetGo: LetGo | null;
  pointsLetGo: number;
  confirmed: number;
  avgConfirmMs: number | null;
  fastestConfirmMs: number | null;
  confirmSpread: number;
  avgFirstPinMs: number | null;
  pointsPerSecond: number | null;
  firstConfirms: number;
  lastConfirms: number;
  lastSecondRounds: number;
  /** Submitted first and scored the fewest points of the round. */
  kamikazeRounds: number;
  continentHits: number;
  continentMisses: number;
  favouriteContinent: ContinentCode | null;
  favouriteCount: number;
  oceanGuesses: number;
  southmostLat: number | null;
  maxAbsLat: number | null;
  guessSpreadKm: number;
  closestOwnPairKm: number | null;
  guessByRound: Map<number, LatLng>;
  regions: RegionSummary[];
  europe: RegionSummary | null;
  weakestRegion: RegionSummary | null;
  specialty: Specialty | null;
  biasLat: number;
  biasLng: number;
  panoStepsTotal: number;
  panoStepsAvg: number;
  panoReturnsTotal: number;
  panDegAvg: number;
  zoomMaxAvg: number;
  zoomEventsAvg: number;
  mapZoomMaxAvg: number;
  duel: DuelSummary | null;
  nearestRival: Rival | null;
  avgRivalKm: number | null;
  rivalLead: number;
}

export function summarize(entry: PlayerEntry, ctx: Context): Summary {
  const rounds = entry.rounds;
  const withGuess = rounds.filter((r): r is RoundStat & { guess: LatLng; distanceKm: number } => r.guess !== null && r.distanceKm !== null);
  const points = rounds.map((r) => r.points);
  const distances = withGuess.map((r) => r.distanceKm);
  const confirms = rounds.flatMap((r) => (r.confirmMs === null ? [] : [r.confirmMs]));
  const firstPins = rounds.flatMap((r) => (r.firstPinMs === null ? [] : [r.firstPinMs]));
  const lats = withGuess.map((r) => r.guess.lat);
  const half = Math.floor(rounds.length / 2);
  const avgPoints = avg(points);

  const continents = new Map<ContinentCode, number>();
  for (const r of withGuess) {
    if (r.guessContinent) continents.set(r.guessContinent, (continents.get(r.guessContinent) ?? 0) + 1);
  }
  const [favouriteContinent, favouriteCount] = [...continents].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

  // Largest gap between two of the player's own guesses - shows whether
  // someone always looks for the world in the same corner. The smallest
  // reveals a favourite spot.
  let guessSpreadKm = 0;
  let closestOwnPairKm: number | null = null;
  for (let i = 0; i < withGuess.length; i++) {
    for (let j = i + 1; j < withGuess.length; j++) {
      const gap = distanceKm(withGuess[i]!.guess, withGuess[j]!.guess);
      guessSpreadKm = Math.max(guessSpreadKm, gap);
      closestOwnPairKm = closestOwnPairKm === null ? gap : Math.min(closestOwnPairKm, gap);
    }
  }

  // Longest run of rounds won.
  let winStreak = 0;
  let run = 0;
  for (const r of rounds) {
    run = ctx.roundWinners.get(r.round)?.has(entry.playerId) ? run + 1 : 0;
    winStreak = Math.max(winStreak, run);
  }

  // The best round right after the worst? That is the comeback.
  const worstIndex = points.indexOf(Math.min(...points));
  const comebackJump = points.length > 1 && worstIndex + 1 < points.length && points[worstIndex + 1] === Math.max(...points)
    ? points[worstIndex + 1]! - points[worstIndex]!
    : 0;

  // Points broken down by the target's continent - shows strengths and blind spots.
  const byRegion = new Map<ContinentCode, number[]>();
  for (const r of withGuess) {
    const spot = ctx.actuals.get(r.round);
    if (!spot) continue;
    const code = continentOf(spot);
    byRegion.set(code, [...(byRegion.get(code) ?? []), r.points]);
  }
  const regions: RegionSummary[] = [...byRegion].map(([code, list]) => ({ code, rounds: list.length, avgPoints: avg(list) }));
  const strongest = regions.filter((r) => r.rounds >= 2).sort((a, b) => b.avgPoints - a.avgPoints)[0];
  const elsewhere = strongest ? withGuess.filter((r) => { const a = ctx.actuals.get(r.round); return a && continentOf(a) !== strongest.code; }) : [];
  const specialty: Specialty | null = strongest
    ? { ...strongest, elsewhereAvg: avg(elsewhere.map((r) => r.points)), elsewhereRounds: elsewhere.length }
    : null;

  // Places per round: 1 + everyone who scored more.
  const placeIn = (r: RoundStat): number => 1 + (ctx.roundPoints.get(r.round) ?? []).filter((p) => p > r.points).length;
  const lastRound = rounds.find((r) => r.round === ctx.lastRound);

  // Points the closest pin would have earned but the submitted one did not.
  const letGos: LetGo[] = withGuess
    .filter((r) => r.closestPinKm !== null)
    .map((r) => ({ closestKm: r.closestPinKm!, finalKm: r.distanceKm, points: Math.max(0, pointsFor(r.closestPinKm!) - r.points) }));
  const biggestLetGo = letGos.filter((l) => l.closestKm < 300 && l.points >= 1500)
    .sort((a, b) => b.points - a.points)[0] ?? null;

  const tele = rounds.map((r) => r.tele);
  const duel = ctx.duel ? summarizeDuel(entry.playerId, ctx.duel) : null;

  return {
    playerId: entry.playerId,
    name: entry.name,
    color: entry.color,
    score: entry.score,
    roundCount: rounds.length,
    played: withGuess.length,
    missed: rounds.length - withGuess.length,

    points,
    avgPoints,
    pointsSpread: stdDev(points),
    bestRoundPoints: points.length ? Math.max(...points) : 0,
    perfectRounds: points.filter((p) => p >= 4800).length,
    zeroRounds: withGuess.filter((r) => r.points < 100).length,
    bestRoundShare: entry.score > 0 ? Math.max(0, ...points) / entry.score : 0,
    firstHalfAvg: avg(points.slice(0, half)),
    secondHalfAvg: avg(points.slice(rounds.length - half)),
    // Every round better than the one before?
    rising: rounds.length >= 4 && points.every((p, i) => i === 0 || p > points[i - 1]!),
    comebackJump,

    bestDistanceKm: distances.length ? Math.min(...distances) : null,
    worstDistanceKm: distances.length ? Math.max(...distances) : null,
    avgDistanceKm: distances.length ? avg(distances) : null,
    totalDistanceKm: sum(distances),

    roundWins: rounds.filter((r) => ctx.roundWinners.get(r.round)?.has(entry.playerId)).length,
    winStreak,
    secondPlaces: withGuess.filter((r) => r.points > 0 && placeIn(r) === 2).length,
    scoreBeforeLast: ctx.scoreBeforeLast.get(entry.playerId) ?? null,
    lastRoundPoints: lastRound?.points ?? 0,

    avgPins: avg(rounds.map((r) => r.pins)),
    maxPins: Math.max(0, ...rounds.map((r) => r.pins)),
    avgPinPathKm: avg(rounds.map((r) => r.pinPathKm)),
    avgMoveKm: withGuess.length ? avg(withGuess.map((r) => r.moveKm)) : 0,
    fineTuneRounds: rounds.filter((r) => r.pins >= 3 && r.lastAdjustKm !== null && r.lastAdjustKm < 5).length,
    // Placed several times, but stuck with the first instinct in the end.
    anchorRounds: rounds.filter((r) => r.pins >= 2 && r.moveKm < 50).length,
    // One click, submitted fast - and still above the player's own average.
    gutFeelingRounds: withGuess.filter((r) => r.pins === 1 && r.confirmMs !== null && r.confirmMs < 15000 && r.points > avgPoints).length,
    biggestLetGo,
    pointsLetGo: sum(letGos.map((l) => l.points)),

    confirmed: confirms.length,
    avgConfirmMs: confirms.length ? avg(confirms) : null,
    fastestConfirmMs: confirms.length ? Math.min(...confirms) : null,
    confirmSpread: stdDev(confirms),
    avgFirstPinMs: firstPins.length ? avg(firstPins) : null,
    pointsPerSecond: confirms.length && avg(confirms) > 0 ? avgPoints / (avg(confirms) / 1000) : null,
    firstConfirms: rounds.filter((r) => r.confirmRank === 1).length,
    lastConfirms: rounds.filter((r) => r.confirmRank !== null
      && (ctx.confirmCounts.get(r.round) ?? 0) >= 2
      && r.confirmRank === ctx.confirmCounts.get(r.round)).length,
    lastSecondRounds: ctx.timeLimitMs
      ? rounds.filter((r) => r.confirmMs !== null && ctx.timeLimitMs - r.confirmMs < 5000).length
      : 0,
    kamikazeRounds: withGuess.filter((r) => {
      const all = ctx.roundPoints.get(r.round) ?? [];
      return r.confirmRank === 1 && all.length >= 2 && r.points === Math.min(...all) && r.points < Math.max(...all);
    }).length,

    continentHits: withGuess.filter((r) => r.continentHit).length,
    continentMisses: withGuess.filter((r) => r.continentHit === false).length,
    favouriteContinent,
    favouriteCount,
    oceanGuesses: withGuess.filter((r) => r.guessContinent === 'SEA').length,
    southmostLat: lats.length ? Math.min(...lats) : null,
    maxAbsLat: lats.length ? Math.max(...lats.map(Math.abs)) : null,
    guessSpreadKm,
    closestOwnPairKm,
    guessByRound: new Map(withGuess.map((r) => [r.round, r.guess])),
    regions,
    europe: regions.find((r) => r.code === 'EU') ?? null,
    weakestRegion: regions.filter((r) => r.rounds >= 2).sort((a, b) => a.avgPoints - b.avgPoints)[0] ?? null,
    specialty,
    biasLat: withGuess.length ? avg(withGuess.map((r) => r.bias?.dLat ?? 0)) : 0,
    biasLng: withGuess.length ? avg(withGuess.map((r) => r.bias?.dLng ?? 0)) : 0,

    panoStepsTotal: sum(tele.map((t) => t.panoSteps)),
    panoStepsAvg: avg(tele.map((t) => t.panoSteps)),
    panoReturnsTotal: sum(tele.map((t) => t.panoReturns)),
    panDegAvg: avg(tele.map((t) => t.panDeg)),
    zoomMaxAvg: avg(tele.map((t) => t.zoomMax)),
    zoomEventsAvg: avg(tele.map((t) => t.zoomEvents)),
    mapZoomMaxAvg: avg(tele.map((t) => t.mapZoomMax)),
    duel,

    // Filled by addRivalStats once every summary exists.
    nearestRival: null,
    avgRivalKm: null,
    rivalLead: 1,
  };
}

function summarizeDuel(playerId: string, log: DuelLog): DuelSummary {
  let damageTaken = 0;
  let damageDealt = 0;
  for (const r of log.rounds) {
    const own = r.damage.get(playerId);
    if (own === undefined) continue;
    damageTaken += own;
    // Whoever takes no damage set the mark - the damage of the others is theirs.
    if (own === 0) damageDealt += sum([...r.damage].filter(([id]) => id !== playerId).map(([, d]) => d));
  }
  // The game ends with the round that knocked out the last opponent.
  const last = log.rounds.at(-1);
  const finalBlow = last?.knockedOut.size && last.damage.get(playerId) === 0 && !last.knockedOut.has(playerId)
    ? { round: last.round, knockouts: last.knockedOut.size }
    : null;
  return { hpLeft: log.hpLeft.get(playerId) ?? 0, damageTaken, damageDealt, finalBlow };
}

/**
 * How close were the player's guesses to everyone else's? That only works
 * once every summary exists - hence a second pass.
 */
function addRivalStats(all: Summary[]): void {
  for (const s of all) {
    const rivals: Rival[] = all
      .filter((o) => o.playerId !== s.playerId)
      .map((o) => {
        const gaps: number[] = [];
        for (const [round, guess] of s.guessByRound) {
          const other = o.guessByRound.get(round);
          if (other) gaps.push(distanceKm(guess, other));
        }
        return { name: o.name, rounds: gaps.length, avgKm: avg(gaps) };
      })
      .filter((r) => r.rounds >= 2);

    if (!rivals.length) continue;
    s.nearestRival = rivals.reduce((a, b) => (b.avgKm < a.avgKm ? b : a));
    s.avgRivalKm = avg(rivals.map((r) => r.avgKm));
    // How clearly does the nearest neighbour sit ahead of the rest? (for "Shadow")
    s.rivalLead = rivals.length >= 2 ? s.avgRivalKm / Math.max(1, s.nearestRival.avgKm) : 1;
  }
}

// --- Catalogue -------------------------------------------------------------
//
// test   -> does the title apply?
// weight -> how hard to earn? 1 = almost every game has one, 5 = exceptional.
//           Steers the draw when several apply. Fallbacks have none.
// facts  -> the numbers behind it, shown under the title

interface Title {
  id: TitleId;
  weight?: number;
  test?: (s: Summary, all: Summary[], ctx: Context) => boolean;
  facts: (s: Summary, all: Summary[], ctx: Context) => (Fact | null)[];
}

const km = (v: number | null): number => v ?? 0;

const CATALOG: Title[] = [
  // --- Accuracy ---
  { id: 'sharpshooter', weight: 4,
    test: (s) => s.bestDistanceKm !== null && s.bestDistanceKm < 50,
    facts: (s) => [{ key: 'bestGuessOff', km: km(s.bestDistanceKm) }] },
  { id: 'bullseye', weight: 5,
    test: (s) => s.perfectRounds > 0,
    facts: (s) => [{ key: 'over4800', n: s.perfectRounds }, { key: 'bestRound', points: s.bestRoundPoints }] },
  { id: 'precision', weight: 3,
    test: (s, all) => s.avgDistanceKm !== null && isBottom(s, all, (x) => x.avgDistanceKm ?? Infinity, 800),
    facts: (s) => [{ key: 'avgDistance', km: km(s.avgDistanceKm) }] },
  { id: 'globetrotter', weight: 3,
    test: (s) => s.played >= 3 && s.continentMisses === 0,
    facts: (s) => [{ key: 'continentHits', hits: s.continentHits, n: s.played }] },
  { id: 'roundKing', weight: 2,
    test: (s, all) => isTop(s, all, (x) => x.roundWins, 2),
    facts: (s) => [{ key: 'roundWins', n: s.roundWins }] },
  { id: 'streak', weight: 4,
    test: (s) => s.winStreak >= 3,
    facts: (s) => [{ key: 'winStreak', n: s.winStreak }, { key: 'roundWinsTotal', n: s.roundWins }] },
  { id: 'rock', weight: 3,
    test: (s, all) => s.roundCount >= 3 && s.avgPoints > 800 && isBottom(s, all, (x) => x.pointsSpread, 900),
    facts: (s) => [{ key: 'pointsSpread', points: s.pointsSpread }, { key: 'avgPointsPerRound', points: s.avgPoints }] },
  { id: 'rollerCoaster', weight: 1,
    test: (s, all) => s.roundCount >= 3 && isTop(s, all, (x) => x.pointsSpread, 1400),
    facts: (s) => [{ key: 'bestRound', points: s.bestRoundPoints }, { key: 'pointsSpread', points: s.pointsSpread }] },
  { id: 'oneHitWonder', weight: 2,
    test: (s) => s.roundCount >= 4 && s.bestRoundShare > 0.45,
    facts: (s) => [{ key: 'bestRound', points: s.bestRoundPoints }, { key: 'bestRoundShare', percent: Math.round(s.bestRoundShare * 100) }] },
  { id: 'comeback', weight: 3,
    test: (s) => s.comebackJump >= 3000,
    facts: (s) => [{ key: 'comebackJump', points: s.comebackJump }] },
  { id: 'onTheRise', weight: 5,
    test: (s) => s.rising,
    facts: (s) => [{ key: 'noSetback', n: s.roundCount }, { key: 'fromTo', from: s.points[0] ?? 0, to: s.points[s.points.length - 1] ?? 0 }] },
  { id: 'lateBloomer', weight: 1,
    test: (s) => s.roundCount >= 4 && s.firstHalfAvg > 0 && s.secondHalfAvg > s.firstHalfAvg * 1.6,
    facts: (s) => [{ key: 'firstHalf', points: s.firstHalfAvg }, { key: 'secondHalf', points: s.secondHalfAvg }] },
  { id: 'fastStarter', weight: 1,
    test: (s) => s.roundCount >= 4 && s.secondHalfAvg > 0 && s.firstHalfAvg > s.secondHalfAvg * 1.6,
    facts: (s) => [{ key: 'firstHalf', points: s.firstHalfAvg }, { key: 'secondHalf', points: s.secondHalfAvg }] },
  { id: 'photoFinish', weight: 4,
    test: (s, all) => all.length >= 2 && scoreGap(s, all) > 0 && scoreGap(s, all) < 300,
    facts: (s, all) => [{ key: 'behindFirst', points: scoreGap(s, all) }] },
  // Behind before the last round, in front after it.
  { id: 'buzzerBeater', weight: 4,
    test: (s, all, ctx) => isLastRoundSwing(ctx, all) && s.scoreBeforeLast !== null
      && scoreGap(s, all) === 0 && s.score > 0 && s.scoreBeforeLast < Math.max(...all.map((x) => x.scoreBeforeLast ?? 0)),
    facts: (s, all) => [
      { key: 'behindBeforeLast', points: Math.max(...all.map((x) => x.scoreBeforeLast ?? 0)) - (s.scoreBeforeLast ?? 0) },
      { key: 'lastRoundPoints', points: s.lastRoundPoints },
    ] },
  // Alone in front before the last round - and not in the end.
  { id: 'choker', weight: 3,
    test: (s, all, ctx) => isLastRoundSwing(ctx, all) && s.scoreBeforeLast !== null && scoreGap(s, all) > 0
      && all.every((x) => x.playerId === s.playerId || (x.scoreBeforeLast ?? 0) < s.scoreBeforeLast!),
    facts: (s, all) => [
      { key: 'leadBeforeLast', points: s.scoreBeforeLast! - Math.max(...all.filter((x) => x.playerId !== s.playerId).map((x) => x.scoreBeforeLast ?? 0)) },
      { key: 'lastRoundPoints', points: s.lastRoundPoints },
      { key: 'behindFirst', points: scoreGap(s, all) },
    ] },
  { id: 'eternalSecond', weight: 2,
    test: (s, all) => s.roundCount >= 3 && s.roundWins === 0 && isTop(s, all, (x) => x.secondPlaces, 2),
    facts: (s) => [{ key: 'secondPlaces', n: s.secondPlaces }, { key: 'noRoundWin' }] },
  { id: 'unlucky', weight: 2,
    test: (s, all) => all.length >= 2 && s.roundWins === 0 && s.avgDistanceKm !== null
      && s.avgDistanceKm < avg(all.map((x) => x.avgDistanceKm ?? 20000)),
    facts: (s) => [{ key: 'avgDistance', km: km(s.avgDistanceKm) }, { key: 'noRoundWin' }] },
  { id: 'blank', weight: 1,
    test: (s) => s.played >= 2 && s.zeroRounds >= 1,
    facts: (s) => [{ key: 'under100', n: s.zeroRounds }, { key: 'worstGuessOff', km: km(s.worstDistanceKm) }] },
  { id: 'antipode', weight: 2,
    test: (s) => s.worstDistanceKm !== null && s.worstDistanceKm > 14000,
    facts: (s) => [{ key: 'worstGuessOff', km: km(s.worstDistanceKm) }] },
  { id: 'aroundTheWorld', weight: 2,
    test: (s) => s.totalDistanceKm > 40075,
    facts: (s) => [{ key: 'totalOff', km: s.totalDistanceKm }, { key: 'circumnavigations', n: s.totalDistanceKm / 40075 }] },
  { id: 'continentalDrift', weight: 1,
    test: (s) => s.continentMisses >= 2 && s.continentMisses > s.continentHits,
    facts: (s) => [{ key: 'wrongContinent', n: s.continentMisses }] },
  { id: 'seafarer', weight: 3,
    test: (s) => s.oceanGuesses >= 2,
    facts: (s) => [{ key: 'oceanGuesses', n: s.oceanGuesses }, { key: 'avgDistance', km: km(s.avgDistanceKm) }] },
  { id: 'homebody', weight: 4,
    test: (s, _all, ctx) => s.played >= 3 && s.guessSpreadKm < 3500 && ctx.actualSpreadKm > 6000,
    facts: (s) => [{ key: 'allWithin', km: s.guessSpreadKm }, s.favouriteContinent ? { key: 'favouriteContinent', continent: s.favouriteContinent } : null] },
  { id: 'regular', weight: 3,
    test: (s) => s.played >= 3 && s.favouriteCount >= Math.max(3, s.played - 1) && s.continentMisses >= 1,
    facts: (s) => [{ key: 'guessedOnContinent', n: s.favouriteCount, continent: s.favouriteContinent ?? 'SEA' }] },
  { id: 'dejaVu', weight: 4,
    test: (s) => s.played >= 3 && s.closestOwnPairKm !== null && s.closestOwnPairKm < 100,
    facts: (s) => [{ key: 'twoGuessesApart', km: km(s.closestOwnPairKm) }] },
  { id: 'polarExplorer', weight: 5,
    test: (s) => s.played >= 3 && s.southmostLat !== null && s.southmostLat >= 50,
    facts: (s) => [{ key: 'allNorthOf', lat: Math.floor(s.southmostLat ?? 0) }] },
  { id: 'tropical', weight: 5,
    test: (s) => s.played >= 3 && s.maxAbsLat !== null && s.maxAbsLat <= 23.5,
    facts: (s) => [{ key: 'maxFromEquator', deg: s.maxAbsLat ?? 0 }] },
  { id: 'homeAdvantage', weight: 3,
    test: (s) => s.europe !== null && s.europe.rounds >= 2 && s.avgPoints > 0 && s.europe.avgPoints > s.avgPoints * 1.4,
    facts: (s) => [{ key: 'continentAvg', continent: 'EU', points: s.europe?.avgPoints ?? 0, n: s.europe?.rounds ?? 0 }, { key: 'overallAvg', points: s.avgPoints }] },
  { id: 'blindSpot', weight: 3,
    test: (s) => s.weakestRegion !== null && s.avgPoints > 800 && s.weakestRegion.avgPoints < s.avgPoints * 0.4,
    facts: (s) => [{ key: 'continentAvg', continent: s.weakestRegion?.code ?? 'SEA', points: s.weakestRegion?.avgPoints ?? 0, n: s.weakestRegion?.rounds ?? 0 }, { key: 'overallAvg', points: s.avgPoints }] },
  // Unlike Home Advantage any continent, and the rest of the world has to be really bad.
  { id: 'specialist', weight: 3,
    test: (s) => s.specialty !== null && s.specialty.avgPoints >= 3500
      && s.specialty.elsewhereRounds >= 2 && s.specialty.elsewhereAvg < s.specialty.avgPoints * 0.4,
    facts: (s) => [
      { key: 'continentAvg', continent: s.specialty?.code ?? 'SEA', points: s.specialty?.avgPoints ?? 0, n: s.specialty?.rounds ?? 0 },
      { key: 'elsewhereAvg', points: s.specialty?.elsewhereAvg ?? 0, n: s.specialty?.elsewhereRounds ?? 0 },
    ] },
  { id: 'shadow', weight: 4,
    test: (s) => s.nearestRival !== null && s.nearestRival.avgKm < 600 && s.rivalLead >= 2,
    facts: (s) => [{ key: 'toRivalGuesses', km: s.nearestRival?.avgKm ?? 0, name: s.nearestRival?.name ?? '' }, { key: 'toOtherGuesses', km: km(s.avgRivalKm) }] },
  { id: 'loneWolf', weight: 2,
    test: (s, all) => s.played >= 3 && isTop(s, all, (x) => x.avgRivalKm ?? 0, 3000),
    facts: (s) => [{ key: 'toOtherGuesses', km: km(s.avgRivalKm) }] },
  { id: 'northernLight', weight: 1, test: (s) => s.played >= 3 && s.biasLat > 12, facts: (s) => [{ key: 'tooFarNorth', deg: s.biasLat }] },
  { id: 'southerner', weight: 1, test: (s) => s.played >= 3 && s.biasLat < -12, facts: (s) => [{ key: 'tooFarSouth', deg: Math.abs(s.biasLat) }] },
  { id: 'eastward', weight: 1, test: (s) => s.played >= 3 && s.biasLng > 25, facts: (s) => [{ key: 'tooFarEast', deg: s.biasLng }] },
  { id: 'westward', weight: 1, test: (s) => s.played >= 3 && s.biasLng < -25, facts: (s) => [{ key: 'tooFarWest', deg: Math.abs(s.biasLng) }] },

  // --- Handling the guess map ---
  { id: 'luckyGuess', weight: 3,
    test: (s) => s.avgPinPathKm > 4000 && s.avgPoints > 2200,
    facts: (s) => [{ key: 'pinPathPerRound', km: s.avgPinPathKm }, { key: 'avgPoints', points: s.avgPoints }] },
  { id: 'homingIn', weight: 4,
    test: (s) => s.fineTuneRounds >= 2,
    facts: (s) => [{ key: 'fineTuneRounds', n: s.fineTuneRounds }, { key: 'pinsPerRound', n: s.avgPins }] },
  { id: 'oneClickWonder', weight: 2,
    test: (s) => s.played >= 2 && s.avgPins > 0 && s.avgPins <= 1.2,
    facts: (s) => [{ key: 'pinsPerRound', n: s.avgPins }] },
  { id: 'anchor', weight: 3,
    test: (s) => s.anchorRounds >= 3,
    facts: (s) => [{ key: 'anchorRounds', n: s.anchorRounds }, { key: 'firstToLastPin', km: s.avgMoveKm }] },
  { id: 'undecided', weight: 1,
    test: (s, all) => isTop(s, all, (x) => x.avgPins, 4),
    facts: (s) => [{ key: 'pinsPerRound', n: s.avgPins }, { key: 'maxPins', n: s.maxPins }] },
  { id: 'changeOfHeart', weight: 1,
    test: (s) => s.played >= 2 && s.avgMoveKm > 2500,
    facts: (s) => [{ key: 'firstToLastPin', km: s.avgMoveKm }] },
  // Had it under 300 km and still moved on - at least 1,500 points given away.
  { id: 'coldFeet', weight: 4,
    test: (s) => s.biggestLetGo !== null,
    facts: (s) => [
      { key: 'closestPin', km: s.biggestLetGo?.closestKm ?? 0 },
      { key: 'submittedOff', km: s.biggestLetGo?.finalKm ?? 0 },
      { key: 'pointsLetGo', points: s.biggestLetGo?.points ?? 0 },
    ] },
  { id: 'gutFeeling', weight: 4,
    test: (s) => s.gutFeelingRounds >= 2,
    facts: (s) => [{ key: 'gutFeelingRounds', n: s.gutFeelingRounds }, { key: 'avgPointsPerRound', points: s.avgPoints }] },

  // --- Timing ---
  { id: 'snapDecision', weight: 2,
    test: (s, all) => s.avgConfirmMs !== null && isBottom(s, all, (x) => x.avgConfirmMs ?? Infinity, 25000),
    facts: (s) => [{ key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }, { key: 'fastestSubmit', ms: s.fastestConfirmMs ?? 0 }] },
  { id: 'efficiency', weight: 3,
    test: (s, all) => isTop(s, all, (x) => x.pointsPerSecond ?? 0, 60),
    facts: (s) => [{ key: 'pointsPerSecond', points: s.pointsPerSecond ?? 0 }, { key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }] },
  { id: 'metronome', weight: 4,
    test: (s, all) => s.confirmed >= 3 && isBottom(s, all, (x) => (x.confirmed >= 3 ? x.confirmSpread : Infinity), 6000),
    facts: (s) => [{ key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }, { key: 'submitSpread', ms: s.confirmSpread }] },
  { id: 'lastSecond', weight: 1,
    test: (s) => s.lastSecondRounds >= 2,
    facts: (s) => [{ key: 'lastSecondRounds', n: s.lastSecondRounds }] },
  { id: 'ponderer', weight: 2,
    test: (s, all, ctx) => s.avgConfirmMs !== null && ctx.timeLimitMs > 0
      && s.avgConfirmMs > ctx.timeLimitMs * 0.7 && isTop(s, all, (x) => x.avgConfirmMs ?? 0, 0),
    facts: (s) => [{ key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }] },
  { id: 'warmUp', weight: 2,
    test: (s, all) => isTop(s, all, (x) => x.avgFirstPinMs ?? 0, 30000),
    facts: (s) => [{ key: 'untilFirstPin', ms: s.avgFirstPinMs ?? 0 }] },
  { id: 'firstOne', weight: 1,
    test: (s, all) => all.length >= 2 && isTop(s, all, (x) => x.firstConfirms, 2),
    facts: (s) => [{ key: 'submittedFirst', n: s.firstConfirms }] },
  { id: 'kamikaze', weight: 2,
    test: (s) => s.kamikazeRounds >= 2,
    facts: (s) => [{ key: 'firstAndWorst', n: s.kamikazeRounds }, { key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }] },
  { id: 'straggler', weight: 1,
    test: (s, all) => all.length >= 2 && isTop(s, all, (x) => x.lastConfirms, 2),
    facts: (s) => [{ key: 'submittedLast', n: s.lastConfirms }, { key: 'avgSubmitAfter', ms: s.avgConfirmMs ?? 0 }] },
  { id: 'ghost', weight: 1,
    test: (s) => s.missed >= 1,
    facts: (s) => [{ key: 'roundsWithoutGuess', n: s.missed }] },

  // --- Street View (client telemetry) ---
  { id: 'explorer', weight: 2,
    test: (s, all) => isTop(s, all, (x) => x.panoStepsAvg, 12),
    facts: (s) => [{ key: 'stepsPerRound', n: Math.round(s.panoStepsAvg) }, { key: 'stepsTotal', n: Math.round(s.panoStepsTotal) }] },
  { id: 'marathon', weight: 3,
    test: (s) => s.panoStepsTotal >= 120,
    facts: (s) => [{ key: 'panoStepsTotal', n: Math.round(s.panoStepsTotal) }] },
  { id: 'lost', weight: 4,
    test: (s, all, ctx) => !ctx.settings.noMove && s.avgDistanceKm !== null
      && isTop(s, all, (x) => x.panoStepsAvg, 10) && isTop(s, all, (x) => x.avgDistanceKm ?? 0, 1000),
    facts: (s) => [{ key: 'stepsPerRound', n: Math.round(s.panoStepsAvg) }, { key: 'andStillOff', km: km(s.avgDistanceKm) }] },
  { id: 'returner', weight: 3,
    test: (s, _all, ctx) => !ctx.settings.noMove && s.panoReturnsTotal >= 2,
    facts: (s) => [{ key: 'returnsToStart', n: s.panoReturnsTotal }, { key: 'stepsPerRound', n: Math.round(s.panoStepsAvg) }] },
  { id: 'homebodyPano', weight: 1,
    test: (s, all, ctx) => !ctx.settings.noMove && s.roundCount >= 2 && isBottom(s, all, (x) => x.panoStepsAvg, 1),
    facts: (s) => [{ key: 'stepsPerRoundFine', n: s.panoStepsAvg }] },
  { id: 'detective', weight: 2,
    test: (s, all, ctx) => !ctx.settings.noZoom && isTop(s, all, (x) => x.zoomMaxAvg, 2),
    facts: (s) => [{ key: 'maxZoom', level: s.zoomMaxAvg }] },
  { id: 'zoomJunkie', weight: 2,
    test: (s, all, ctx) => !ctx.settings.noZoom && isTop(s, all, (x) => x.zoomEventsAvg, 15),
    facts: (s) => [{ key: 'zoomChangesPerRound', n: Math.round(s.zoomEventsAvg) }, { key: 'maxZoom', level: s.zoomMaxAvg }] },
  { id: 'signReader', weight: 3,
    test: (s, _all, ctx) => !ctx.settings.noZoom && s.zoomMaxAvg > 2 && s.avgDistanceKm !== null && s.avgDistanceKm < 1500,
    facts: (s) => [{ key: 'maxZoom', level: s.zoomMaxAvg }, { key: 'avgDistance', km: km(s.avgDistanceKm) }] },
  { id: 'carousel', weight: 2,
    test: (s, all, ctx) => !ctx.settings.noPan && isTop(s, all, (x) => x.panDegAvg, 900),
    facts: (s) => [{ key: 'turnsPerRound', n: s.panDegAvg / 360 }] },
  { id: 'panoramaPhotographer', weight: 3,
    test: (s, _all, ctx) => !ctx.settings.noPan && !ctx.settings.noMove && s.panDegAvg > 720 && s.panoStepsAvg < 1,
    facts: (s) => [{ key: 'turnsPerRound', n: s.panDegAvg / 360 }, { key: 'onlySteps', n: s.panoStepsAvg }] },
  { id: 'tunnelVision', weight: 2,
    test: (s, all, ctx) => !ctx.settings.noPan && s.roundCount >= 2 && isBottom(s, all, (x) => x.panDegAvg, 120),
    facts: (s) => [{ key: 'onlyLookedAround', deg: Math.round(s.panDegAvg) }] },
  { id: 'cartographer', weight: 2,
    test: (s, all) => isTop(s, all, (x) => x.mapZoomMaxAvg, 9),
    facts: (s) => [{ key: 'maxMapZoom', level: s.mapZoomMaxAvg }] },
  { id: 'highFlyer', weight: 2,
    test: (s, all) => s.played >= 2 && isBottom(s, all, (x) => x.mapZoomMaxAvg, 4),
    facts: (s) => [{ key: 'maxMapZoomOnly', level: s.mapZoomMaxAvg }] },

  // --- Duel ---
  { id: 'survivor', weight: 4,
    test: (s, _all, ctx) => s.duel !== null && s.duel.hpLeft > 0 && s.duel.hpLeft <= ctx.duel!.startHp * 0.1,
    facts: (s, _all, ctx) => [{ key: 'hpLeft', hp: s.duel?.hpLeft ?? 0, percent: Math.round(((s.duel?.hpLeft ?? 0) / ctx.duel!.startHp) * 100) }] },
  { id: 'executioner', weight: 2,
    test: (s) => s.duel?.finalBlow != null,
    facts: (s) => [{ key: 'decidingRound', n: s.duel?.finalBlow?.round ?? 0 }, { key: 'knockouts', n: s.duel?.finalBlow?.knockouts ?? 0 }] },
  // Hands it out and takes it: at least half the starting HP each way. Only
  // alone - in a team everyone takes the same damage.
  { id: 'glassCannon', weight: 3,
    test: (s, all, ctx) => s.duel !== null && !ctx.duel!.teams
      && s.duel.damageTaken >= ctx.duel!.startHp * 0.5 && s.duel.damageDealt >= ctx.duel!.startHp * 0.5
      && isTop(s, all, (x) => x.duel?.damageDealt ?? 0, 0),
    facts: (s) => [{ key: 'damageDealt', hp: s.duel?.damageDealt ?? 0 }, { key: 'damageTaken', hp: s.duel?.damageTaken ?? 0 }] },
];

/** If nothing stands out - everyone gets a title anyway. */
const FALLBACKS: Title[] = [
  { id: 'solid', facts: (s) => [{ key: 'avgPointsPerRound', points: s.avgPoints }] },
  { id: 'unremarkable', facts: (s) => [{ key: 'guessesSubmitted', n: s.played }] },
  { id: 'wanderer', facts: (s) => [s.favouriteContinent ? { key: 'favouriteContinent', continent: s.favouriteContinent } : { key: 'guessesSubmitted', n: s.played }] },
];

// --- Statistics table ------------------------------------------------------

interface Metric {
  dir: MetricDirection;
  unit: MetricUnit;
  pick: (s: Summary) => number | null;
}

const METRICS: Record<MetricKey, Metric> = {
  score: { dir: 'high', unit: 'points', pick: (s) => s.score },
  avgPoints: { dir: 'high', unit: 'points', pick: (s) => s.avgPoints },
  bestRoundPoints: { dir: 'high', unit: 'points', pick: (s) => s.bestRoundPoints },
  pointsSpread: { dir: 'low', unit: 'spread', pick: (s) => s.pointsSpread },
  roundWins: { dir: 'high', unit: 'count', pick: (s) => s.roundWins },
  avgDistanceKm: { dir: 'low', unit: 'km', pick: (s) => s.avgDistanceKm },
  bestDistanceKm: { dir: 'low', unit: 'km', pick: (s) => s.bestDistanceKm },
  worstDistanceKm: { dir: 'low', unit: 'km', pick: (s) => s.worstDistanceKm },
  continentHits: { dir: 'high', unit: 'count', pick: (s) => s.continentHits },
  missed: { dir: 'low', unit: 'count', pick: (s) => s.missed },
  avgConfirmMs: { dir: 'low', unit: 'seconds', pick: (s) => s.avgConfirmMs },
  fastestConfirmMs: { dir: 'low', unit: 'seconds', pick: (s) => s.fastestConfirmMs },
  firstConfirms: { dir: 'high', unit: 'count', pick: (s) => s.firstConfirms },
  avgPins: { dir: null, unit: 'decimal', pick: (s) => s.avgPins },
  maxPins: { dir: null, unit: 'count', pick: (s) => s.maxPins },
  avgPinPathKm: { dir: null, unit: 'km', pick: (s) => s.avgPinPathKm },
  avgMoveKm: { dir: null, unit: 'km', pick: (s) => s.avgMoveKm },
  fineTuneRounds: { dir: null, unit: 'count', pick: (s) => s.fineTuneRounds },
  pointsLetGo: { dir: 'low', unit: 'points', pick: (s) => (s.played ? s.pointsLetGo : null) },
  panoStepsTotal: { dir: null, unit: 'integer', pick: (s) => s.panoStepsTotal },
  panoStepsAvg: { dir: null, unit: 'decimal', pick: (s) => s.panoStepsAvg },
  panDegAvg: { dir: null, unit: 'degreesInt', pick: (s) => s.panDegAvg },
  zoomMaxAvg: { dir: null, unit: 'decimal', pick: (s) => s.zoomMaxAvg },
  mapZoomMaxAvg: { dir: null, unit: 'decimal', pick: (s) => s.mapZoomMaxAvg },
  guessSpreadKm: { dir: null, unit: 'km', pick: (s) => s.guessSpreadKm },
  biasLat: { dir: null, unit: 'biasLat', pick: (s) => s.biasLat },
  biasLng: { dir: null, unit: 'biasLng', pick: (s) => s.biasLng },
};

function buildMetrics(all: Summary[]): MetricRow[] {
  return METRIC_KEYS.map((key) => {
    const metric = METRICS[key];
    const values = all.map((s) => ({ playerId: s.playerId, value: metric.pick(s) }));
    const usable = values.filter((v): v is { playerId: string; value: number } => v.value !== null && Number.isFinite(v.value));

    let bestIds: string[] = [];
    if (metric.dir && usable.length > 1) {
      const best = metric.dir === 'high' ? Math.max(...usable.map((v) => v.value)) : Math.min(...usable.map((v) => v.value));
      // Only highlight when there are differences at all.
      if (usable.some((v) => v.value !== best)) bestIds = usable.filter((v) => v.value === best).map((v) => v.playerId);
    }

    return {
      key,
      dir: metric.dir,
      unit: metric.unit,
      values: values.map((v) => ({
        playerId: v.playerId,
        value: v.value !== null && Number.isFinite(v.value) ? v.value : null,
        best: bestIds.includes(v.playerId),
      })),
    };
  });
}

// --- Awarding --------------------------------------------------------------

/** Draws a title - the harder to earn, the likelier. Fallbacks count the same. */
function pickWeighted(list: Title[], random: () => number): Title {
  const total = sum(list.map((t) => t.weight ?? 1));
  let roll = random() * total;
  for (const title of list) {
    roll -= title.weight ?? 1;
    if (roll < 0) return title;
  }
  return list[list.length - 1]!;
}

function matches(title: Title, s: Summary, all: Summary[], ctx: Context): boolean {
  try {
    return !!title.test?.(s, all, ctx);
  } catch {
    return false; // a broken test must never cost the final screen
  }
}

/** How many submitted at all in this round? (for "Straggler") */
function countConfirms(entries: PlayerEntry[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    for (const r of entry.rounds) {
      if (r.confirmMs === null) continue;
      counts.set(r.round, (counts.get(r.round) ?? 0) + 1);
    }
  }
  return counts;
}

export interface FinalStats {
  titles: Record<string, AwardedTitle>;
  metrics: MetricRow[];
}

function prepare(entries: PlayerEntry[], rawCtx: TitleContext): { ctx: Context; all: Summary[]; candidates: Map<string, Title[]> } {
  const lastRound = Math.max(0, ...entries.flatMap((e) => e.rounds.map((r) => r.round)));
  const roundPoints = new Map<number, number[]>();
  for (const e of entries) {
    for (const r of e.rounds) if (r.guess) roundPoints.set(r.round, [...(roundPoints.get(r.round) ?? []), r.points]);
  }
  const scoreBeforeLast = new Map(entries.map((e) => [e.playerId, sum(e.rounds.filter((r) => r.round < lastRound).map((r) => r.points))]));
  const ctx: Context = { ...rawCtx, confirmCounts: countConfirms(entries), roundPoints, scoreBeforeLast, lastRound };
  const all = entries.map((e) => summarize(e, ctx));
  addRivalStats(all);
  const candidates = new Map(all.map((s) => [s.playerId, CATALOG.filter((t) => matches(t, s, all, ctx))]));
  return { ctx, all, candidates };
}

/** Every title a player qualifies for, before the draw - for tests. */
export function titleCandidates(entries: PlayerEntry[], ctx: TitleContext): Record<string, TitleId[]> {
  const { candidates } = prepare(entries, ctx);
  return Object.fromEntries([...candidates].map(([id, list]) => [id, list.map((t) => t.id)]));
}

/**
 * One title per player plus the statistics table.
 *
 * If several titles apply, weighted chance decides. Whoever has the fewest
 * matches chooses first - otherwise a many-match player grabs the only title
 * someone else could get at all. `random` is injectable for tests.
 */
export function buildFinalStats(entries: PlayerEntry[], rawCtx: TitleContext, random: () => number = Math.random): FinalStats {
  const { ctx, all, candidates } = prepare(entries, rawCtx);
  const order = [...all].sort((a, b) => candidates.get(a.playerId)!.length - candidates.get(b.playerId)!.length);

  const used = new Set<TitleId>();
  const titles: Record<string, AwardedTitle> = {};
  for (const s of order) {
    const hits = candidates.get(s.playerId)!.filter((t) => !used.has(t.id));
    const freeFallbacks = FALLBACKS.filter((t) => !used.has(t.id));
    const pool = hits.length ? hits : (freeFallbacks.length ? freeFallbacks : FALLBACKS);

    const title = pickWeighted(pool, random);
    used.add(title.id);
    titles[s.playerId] = {
      id: title.id,
      group: titleGroupOf(title.id),
      facts: title.facts(s, all, ctx).filter((f): f is Fact => f !== null),
    };
  }

  return { titles, metrics: buildMetrics(all) };
}
