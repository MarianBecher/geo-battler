// Game settings as the lobby edits them and the server enforces them.

export const GAME_MODES = ['classic', 'duel'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Map packs: which region boxes the location search rolls in (see the server's locations module). */
export const PACK_IDS = ['world', 'europe', 'dach', 'americas', 'asia', 'africa', 'oceania'] as const;
export type PackId = (typeof PACK_IDS)[number];
export const DEFAULT_PACK: PackId = 'world';
export const isPackId = (value: unknown): value is PackId => PACK_IDS.includes(value as PackId);

/** The restrictions the lobby votes on. */
export const VOTE_FLAGS = ['noMove', 'noPan', 'noZoom'] as const;
export type VoteFlag = (typeof VOTE_FLAGS)[number];
/** Everything voted on: the restrictions yes/no, the pack by choice. */
export const VOTE_KEYS = [...VOTE_FLAGS, 'pack'] as const;
export type VoteKey = (typeof VOTE_KEYS)[number];

export interface Settings {
  mode: GameMode;
  /** Classic: rounds per game. */
  rounds: number;
  /** Duel: hit points at the start. */
  hp: number;
  /** Duel in two teams instead of everyone for themselves. */
  teams: boolean;
  /** Seconds per round, 0 = unlimited. */
  timeLimit: number;
  noMove: boolean;
  noPan: boolean;
  noZoom: boolean;
  pack: PackId;
  /** Which of the voted keys the host locked - the lobby votes on the rest. */
  locked: Record<VoteKey, boolean>;
}

export const LIMITS = {
  rounds: { min: 1, max: 20 },
  hp: { min: 1000, max: 20000, step: 100 },
  timeLimit: { min: 10, max: 600 },
  players: 16,
  nameLength: 16,
  chatLength: 200,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'classic',
  rounds: 5,
  hp: 6000,
  teams: false,
  timeLimit: 90,
  noMove: false,
  noPan: false,
  noZoom: false,
  pack: DEFAULT_PACK,
  locked: { noMove: false, noPan: false, noZoom: false, pack: false },
};

/** Team duel: two teams with a shared HP bar. Names are translated on the client. */
export const TEAM_IDS = ['red', 'blue'] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAMS: readonly { id: TeamId; color: string }[] = [
  { id: 'red', color: '#f97362' },
  { id: 'blue', color: '#4fc3f7' },
];
export const isTeamId = (value: unknown): value is TeamId => TEAM_IDS.includes(value as TeamId);

export const PLAYER_COLORS: readonly string[] = [
  '#f97362', '#4fc3f7', '#ffd166', '#8ce99a', '#c792ea',
  '#ff9ff3', '#7dd3c0', '#ffa94d', '#a5b4fc', '#f472b6',
  '#94d82d', '#66d9e8', '#ffc9c9', '#b197fc', '#ffe066',
  '#63e6be',
];

/**
 * In a team duel everyone wears a shade of their team: red only reds, oranges
 * and yellows, blue only blues, teals and petrol. Eight each, chosen so the
 * two most similar still differ clearly (OKLab dE >= 9.7). The first shade is
 * the team colour itself.
 */
export const TEAM_PALETTES: Record<TeamId, readonly string[]> = {
  red: ['#f97362', '#e8322f', '#ff9124', '#fcc419', '#fff176', '#b8430f', '#ffc19a', '#9c6b00'],
  blue: ['#4fc3f7', '#1c6fe0', '#0fa3b8', '#1fc99a', '#00788c', '#a9dcff', '#8ff5da', '#4d9bff'],
};

/** 3-2-1 before every round; pins are accepted only after. */
export const COUNTDOWN_MS = 3000;

/** Duel: from this round on the damage factor is more than x1, growing by the step per round. */
export const DUEL_MULTIPLIER_FROM = 6;
export const DUEL_MULTIPLIER_STEP = 0.5;

/** Damage factor of a (1-based) round in a duel. */
export function damageMultiplier(round: number): number {
  if (round < DUEL_MULTIPLIER_FROM) return 1;
  return 1 + (round - DUEL_MULTIPLIER_FROM + 1) * DUEL_MULTIPLIER_STEP;
}
