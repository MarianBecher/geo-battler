// Titles and the facts under them, as the server awards them and the client
// renders them. Only ids and raw numbers cross the wire.

export const TITLE_GROUPS = {
  accuracy: ['sharpshooter', 'bullseye', 'precision', 'globetrotter'],
  form: ['roundKing', 'streak', 'rock', 'rollerCoaster', 'oneHitWonder', 'comeback',
    'onTheRise', 'lateBloomer', 'fastStarter', 'photoFinish', 'unlucky', 'blank'],
  geography: ['antipode', 'aroundTheWorld', 'continentalDrift', 'seafarer', 'homebody',
    'regular', 'dejaVu', 'polarExplorer', 'tropical', 'homeAdvantage', 'blindSpot', 'shadow',
    'loneWolf', 'northernLight', 'southerner', 'eastward', 'westward'],
  map: ['luckyGuess', 'homingIn', 'oneClickWonder', 'anchor', 'undecided', 'changeOfHeart', 'coldFeet', 'gutFeeling'],
  timing: ['snapDecision', 'efficiency', 'metronome', 'lastSecond', 'ponderer', 'warmUp',
    'firstOne', 'straggler', 'ghost'],
  streetview: ['explorer', 'marathon', 'lost', 'returner', 'homebodyPano', 'detective',
    'zoomJunkie', 'signReader', 'carousel', 'panoramaPhotographer', 'tunnelVision', 'cartographer',
    'highFlyer'],
  /** Fallbacks when nothing stands out - everyone gets a title. */
  note: ['solid', 'unremarkable', 'wanderer'],
} as const;

export type TitleGroup = keyof typeof TITLE_GROUPS;
export type TitleId = (typeof TITLE_GROUPS)[TitleGroup][number];

export const TITLE_IDS: readonly TitleId[] = Object.values(TITLE_GROUPS).flat();

const GROUP_OF = new Map<TitleId, TitleGroup>(
  (Object.entries(TITLE_GROUPS) as [TitleGroup, readonly TitleId[]][]).flatMap(([group, ids]) => ids.map((id) => [id, group] as const)),
);
export const titleGroupOf = (id: TitleId): TitleGroup => GROUP_OF.get(id) ?? 'note';

/** The parameters every fact template needs. The names carry the unit: km, ms, points, deg, n, ... */
export interface FactParams {
  bestGuessOff: { km: number };
  over4800: { n: number };
  bestRound: { points: number };
  avgDistance: { km: number };
  continentHits: { hits: number; n: number };
  roundWins: { n: number };
  winStreak: { n: number };
  roundWinsTotal: { n: number };
  pointsSpread: { points: number };
  avgPointsPerRound: { points: number };
  bestRoundShare: { percent: number };
  comebackJump: { points: number };
  noSetback: { n: number };
  fromTo: { from: number; to: number };
  firstHalf: { points: number };
  secondHalf: { points: number };
  behindFirst: { points: number };
  noRoundWin: object;
  under100: { n: number };
  worstGuessOff: { km: number };
  totalOff: { km: number };
  circumnavigations: { n: number };
  wrongContinent: { n: number };
  oceanGuesses: { n: number };
  allWithin: { km: number };
  favouriteContinent: { continent: string };
  guessedOnContinent: { n: number; continent: string };
  twoGuessesApart: { km: number };
  allNorthOf: { lat: number };
  maxFromEquator: { deg: number };
  continentAvg: { continent: string; points: number; n: number };
  overallAvg: { points: number };
  toRivalGuesses: { km: number; name: string };
  toOtherGuesses: { km: number };
  tooFarNorth: { deg: number };
  tooFarSouth: { deg: number };
  tooFarEast: { deg: number };
  tooFarWest: { deg: number };
  pinPathPerRound: { km: number };
  avgPoints: { points: number };
  fineTuneRounds: { n: number };
  pinsPerRound: { n: number };
  anchorRounds: { n: number };
  firstToLastPin: { km: number };
  maxPins: { n: number };
  gutFeelingRounds: { n: number };
  closestPin: { km: number };
  submittedOff: { km: number };
  pointsLetGo: { points: number };
  avgSubmitAfter: { ms: number };
  fastestSubmit: { ms: number };
  pointsPerSecond: { points: number };
  submitSpread: { ms: number };
  lastSecondRounds: { n: number };
  untilFirstPin: { ms: number };
  submittedFirst: { n: number };
  submittedLast: { n: number };
  roundsWithoutGuess: { n: number };
  stepsPerRound: { n: number };
  stepsPerRoundFine: { n: number };
  stepsTotal: { n: number };
  panoStepsTotal: { n: number };
  andStillOff: { km: number };
  returnsToStart: { n: number };
  onlySteps: { n: number };
  maxZoom: { level: number };
  zoomChangesPerRound: { n: number };
  turnsPerRound: { n: number };
  onlyLookedAround: { deg: number };
  maxMapZoom: { level: number };
  maxMapZoomOnly: { level: number };
  guessesSubmitted: { n: number };
}
export type FactKey = keyof FactParams;
export type Fact = { [K in FactKey]: { key: K } & FactParams[K] }[FactKey];

export interface AwardedTitle {
  id: TitleId;
  group: TitleGroup;
  facts: Fact[];
}

// --- The statistics table -------------------------------------------------

export const METRIC_KEYS = [
  'score', 'avgPoints', 'bestRoundPoints', 'pointsSpread', 'roundWins',
  'avgDistanceKm', 'bestDistanceKm', 'worstDistanceKm', 'continentHits', 'missed',
  'avgConfirmMs', 'fastestConfirmMs', 'firstConfirms',
  'avgPins', 'maxPins', 'avgPinPathKm', 'avgMoveKm', 'fineTuneRounds', 'pointsLetGo',
  'panoStepsTotal', 'panoStepsAvg', 'panDegAvg', 'zoomMaxAvg', 'mapZoomMaxAvg',
  'guessSpreadKm', 'biasLat', 'biasLng',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** How the client formats a raw metric value. */
export type MetricUnit = 'points' | 'spread' | 'count' | 'km' | 'seconds' | 'decimal' | 'integer' | 'degreesInt' | 'biasLat' | 'biasLng';

/** 'high' = bigger is better, 'low' = smaller is better, null = pure observation. */
export type MetricDirection = 'high' | 'low' | null;

export interface MetricRow {
  key: MetricKey;
  dir: MetricDirection;
  unit: MetricUnit;
  values: { playerId: string; value: number | null; best: boolean }[];
}
