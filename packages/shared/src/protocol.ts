// The WebSocket protocol between server and client, plus the JSON shapes of
// the HTTP endpoints. Both sides import these types, so a message one side
// sends and the other does not understand is a compile error.

import type { ErrorCode, ErrorParams, GameErrorPayload } from './errors.ts';
import type { LatLng } from './scoring.ts';
import type { GameMode, PackId, Settings, TeamId, VoteFlag, VoteKey } from './settings.ts';
import type { AwardedTitle, MetricRow } from './titles.ts';
import type { ContinentCode } from './continents.ts';

export type RoomPhase = 'lobby' | 'loading' | 'playing' | 'reveal' | 'finished';

/** Why someone is watching instead of guessing. */
export type SpectatorReason = 'out' | 'nextGame' | 'nextRound';

// --- Client -> server --------------------------------------------------------

/** What the client counts while the player plays; feeds the titles only. */
export interface Telemetry {
  panoSteps: number;
  panoReturns: number;
  panDeg: number;
  zoomMax: number;
  zoomEvents: number;
  mapZoomMax: number;
  mapClicks: number;
}

export type ClientMessage =
  | { t: 'create'; name: string; face: number | null; settings: Partial<Settings> }
  | { t: 'join'; code: string; name: string; face: number | null; playerId?: string }
  | { t: 'settings'; settings: Partial<Settings> }
  | { t: 'start' }
  | { t: 'pin'; lat: number; lng: number }
  | { t: 'guess'; lat: number; lng: number }
  | { t: 'telemetry'; stats: Partial<Telemetry> }
  | { t: 'ready'; value: boolean }
  | { t: 'vote'; flag: VoteFlag; value: boolean | null }
  | { t: 'vote'; flag: 'pack'; value: PackId | null }
  | { t: 'team'; team: TeamId }
  | { t: 'color'; color: string }
  | { t: 'face'; face: number }
  | { t: 'chat'; text: string }
  | { t: 'next' }
  | { t: 'lobby' }
  | { t: 'kick'; playerId: string }
  | { t: 'host'; playerId: string }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'leave' }
  | { t: 'ping' };

export type ClientMessageType = ClientMessage['t'];

// --- Server -> client --------------------------------------------------------

export interface PlayerSnapshot {
  id: string;
  name: string;
  color: string;
  /** Passport photo seed, null = drawn from the name. */
  face: number | null;
  score: number;
  hp: number | null;
  outRound: number | null;
  team: TeamId;
  connected: boolean;
  hasGuessed: boolean;
  ready: boolean;
  isHost: boolean;
  spectator: boolean;
}

export interface VoteTally {
  noMove: { yes: string[]; no: string[] };
  noPan: { yes: string[]; no: string[] };
  noZoom: { yes: string[]; no: string[] };
  /** packId -> voters */
  pack: Partial<Record<PackId, string[]>>;
}

/** What the restrictions and the pack would be if the game started now. */
export type EffectiveFlags = Record<VoteFlag, boolean> & { pack: PackId };

export interface TeamState {
  hp: number;
  outRound: number | null;
}

/** Why the last start failed - shown in the lobby, translated by its code. */
export type LoadError = GameErrorPayload;

export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  phase: RoomPhase;
  settings: Settings;
  round: number;
  totalRounds: number | null;
  roundEndsAt: number | null;
  paused: boolean;
  /** Server clock, lets the client compensate drift. */
  now: number;
  loadError: LoadError | null;
  teamState: Record<TeamId, TeamState> | null;
  votes: VoteTally;
  flags: EffectiveFlags;
  players: PlayerSnapshot[];
}

export interface ChatMessage {
  id: number;
  playerId: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

export interface PinSnapshot extends LatLng {
  playerId: string;
  confirmed: boolean;
}

export interface Place {
  label: string;
  countryCode: string | null;
}

export interface RoundMessage {
  t: 'round';
  round: number;
  totalRounds: number | null;
  multiplier: number | null;
  panoId: string;
  /** End of the countdown. */
  startsAt: number;
  endsAt: number | null;
  now: number;
  settings: Settings;
  /** On reconnect: the player's own state. */
  myPin?: LatLng | null;
  myConfirmed?: boolean;
  spectating?: boolean;
  spectatorReason?: SpectatorReason;
  pins?: PinSnapshot[];
}

export interface RoundResult {
  playerId: string;
  name: string;
  color: string;
  face: number | null;
  guess: LatLng | null;
  distanceKm: number | null;
  points: number;
  total: number;
  /** Duel: was the player still in the race before this round? */
  contender: boolean;
  hp?: number | null;
  outRound?: number | null;
  damage?: number;
  hpBefore?: number;
  knockedOut?: boolean;
  team?: TeamId;
}

export interface TeamRoundResult {
  id: TeamId;
  color: string;
  contender: boolean;
  avg: number | null;
  damage: number;
  hpBefore: number;
  hp: number;
  knockedOut: boolean;
  outRound: number | null;
}

export interface RevealMessage {
  t: 'reveal';
  round: number;
  totalRounds: number | null;
  mode: GameMode;
  maxHp: number | null;
  multiplier: number | null;
  teams: TeamRoundResult[] | null;
  actual: LatLng;
  place: Place | null;
  panoId: string;
  isLastRound: boolean;
  results: RoundResult[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  color: string;
  face: number | null;
  score: number;
  hp: number | null;
  outRound: number | null;
  team: TeamId | null;
  connected: boolean;
}

export interface TeamStanding {
  id: TeamId;
  color: string;
  hp: number;
  outRound: number | null;
  avgPoints: number;
  members: string[];
}

export interface PlayedRoundGuess {
  playerId: string;
  name: string;
  color: string;
  guess: LatLng;
  distanceKm: number;
  points: number;
  damage: number | null;
  knockedOut: boolean;
  team: TeamId | null;
}

export interface PlayedRound {
  round: number;
  actual: LatLng;
  place: Place | null;
  panoId: string;
  results: PlayedRoundGuess[];
}

export interface FinalMessage {
  t: 'final';
  mode: GameMode;
  totalRounds: number;
  maxHp: number | null;
  teams: TeamStanding[] | null;
  leaderboard: LeaderboardEntry[];
  rounds: PlayedRound[];
  titles: Record<string, AwardedTitle>;
  metrics: MetricRow[];
}

export type ServerMessage =
  | { t: 'hello'; playerId: string; code: string; color: string; name: string }
  | { t: 'room'; room: RoomSnapshot }
  | RoundMessage
  | { t: 'pins'; round: number; pins: PinSnapshot[] }
  | RevealMessage
  | FinalMessage
  | { t: 'chatLog'; messages: ChatMessage[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; code: ErrorCode | null; params: ErrorParams; message: string }
  | { t: 'pong' };

export type ServerMessageType = ServerMessage['t'];

// --- HTTP ---------------------------------------------------------------------

/** GET /api/config */
export interface ClientConfig {
  mapsApiKey: string;
  colors: readonly string[];
  teams: readonly { id: TeamId; color: string }[];
  teamPalettes: Record<TeamId, readonly string[]>;
  packs: PackId[];
  configured: boolean;
  missing: string[];
  defaults: Settings;
  lanUrls: string[];
}

/** GET /api/hall */
export interface HallRecords {
  bestGame?: { name: string; score: number; rounds: number; at: string };
  bestRound?: { name: string; points: number; place: string | null; at: string };
  bestGuess?: { name: string; distanceKm: number; place: string | null; at: string };
}

export interface HallPlayer {
  name: string;
  face: number | null;
  games: number;
  wins: number;
  rounds: number;
  avgPoints: number;
  bestGameScore: number;
  bestRoundPoints: number;
  bestDistanceKm: number | null;
  perfects: number;
  continentHits: number;
  favouriteTitle: string | null;
  favouriteTitleCount: number;
  lastSeen: string | null;
  hasProfile: boolean;
}

export interface HallView {
  games: number;
  rounds: number;
  updatedAt: string | null;
  records: HallRecords;
  players: HallPlayer[];
}

/** GET /api/hall/player/:name */
export interface ProfileRound {
  /** target [lat, lng] */
  a: [number, number];
  /** guess [lat, lng] or null */
  g: [number, number] | null;
  pts: number;
  km: number | null;
  cc: string | null;
}

export interface PlayerProfile {
  name: string;
  face: number | null;
  games: number;
  wins: number;
  since: string | null;
  rounds: number;
  avgPoints: number | null;
  medianKm: number | null;
  perfects: number;
  continents: { code: ContinentCode; rounds: number; avgPoints: number; medianKm: number | null; hitRate: number }[];
  countries: { code: string; rounds: number; avgPoints: number }[];
  form: { at: string; mode: GameMode; rounds: number; avgPoints: number }[];
  map: ProfileRound[];
}

/** Error body of the HTTP endpoints. */
export interface HttpError {
  error: ErrorCode;
  message: string;
}

export type { VoteKey };
