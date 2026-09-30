// The room state machine: lobby -> loading -> playing -> reveal -> finished.
//
// A room knows nothing about sockets or files. It keeps the players, the
// settings and the round state, enforces the rules, and reports changes
// through the `events` callbacks that the WebSocket layer wires up.

import { randomUUID } from 'node:crypto';
import {
  COUNTDOWN_MS, DEFAULT_PACK, DEFAULT_SETTINGS, LIMITS, PLAYER_COLORS, TEAM_IDS, TEAM_PALETTES, TEAMS, VOTE_FLAGS, VOTE_KEYS,
  damageMultiplier, distanceKm, isPackId, isTeamId, scoreGuess,
  type DrawResult, type EffectiveFlags, type GameMode, type LatLng, type LeaderboardEntry, type LoadError, type PackId, type PlayedRound,
  type RevealMessage, type RoomPhase, type RoomSnapshot, type RoundMessage, type RoundResult, type Settings, type SpectatorReason,
  type TeamId, type TeamRoundResult, type TeamStanding, type TeamState, type VoteFlag, type VoteKey, type VoteTally, type PinSnapshot, type ChatMessage,
  GAME_MODES,
} from '@geo-battler/shared';
import { pickLocations, type SearchOptions } from './locations.ts';
import { attachPlaces, type Located } from './geocode.ts';
import { closeRoundStat, emptyRoundStat, recordPin, sanitizeTelemetry, type RoundStat } from './stats.ts';
import { buildFinalStats, type FinalStats } from './titles.ts';
import { errorPayload, fail } from './errors.ts';
import type { GameSummary } from './hall.ts';

/** How long a disconnected player keeps their seat (and points). */
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
/** Empty rooms are cleaned up after this long. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** Chat: this many messages go to whoever joins late; and a flood limit per player. */
const CHAT_HISTORY = 60;
const CHAT_BURST = 4;
const CHAT_WINDOW_MS = 4000;

// Duel: the number of rounds is open, so locations are fetched in small
// batches while the reveal is showing instead of all at once.
const DUEL_BATCH = 3;   // this many locations are fetched at once
const DUEL_BUFFER = 2;  // fewer than this in stock triggers a top-up

/**
 * How long the drawn wish is shown before the first round - at least, the
 * places may take longer. The client's animation is built to fit.
 */
export const DRAW_REVEAL_MS = 4500;

/** What a player's socket must offer the room: nothing but a way to be closed. */
export interface PlayerSocket {
  close(code: number, reason: string): void;
}

export interface Player {
  id: string;
  name: string;
  socket: PlayerSocket | null;
  connected: boolean;
  color: string;
  face: number | null;
  team: TeamId;
  score: number;
  hp: number | null;
  outRound: number | null;
  /** Last pin placed - counts even without submitting. */
  pin: (LatLng & { at: number }) | null;
  confirmed: boolean;
  /** Joined mid-game? Then watch first. */
  spectator: boolean;
  disconnectedAt: number | null;
  ready: boolean;
  stats: RoundStat[];
  roundStat: RoundStat | null;
  chattedAt: number[];
}

export interface RoomEvents {
  onChange(): void;
  onRoundStart(): void;
  onPins(): void;
  onReveal(): void;
  onFinal(): void;
}

const noEvents: RoomEvents = { onChange() {}, onRoundStart() {}, onPins() {}, onReveal() {}, onFinal() {} };

/** Finds `count` places for a game - the real one asks Google, tests inject their own. */
export type LocationFinder = (count: number, options: SearchOptions) => Promise<Located[]>;

export const googleFinder = (apiKey: string): LocationFinder => async (count, options) => {
  const found = await pickLocations(count, apiKey, options);
  // Locations with place names - the name never decides a game, so no fuss.
  await attachPlaces(found, apiKey);
  return found;
};

type Ballot = Partial<Record<VoteFlag, boolean>> & { pack?: PackId };

/** A ballot as a whole wish: what the player did not set is off, the pack the world. */
function wishOf(ballot: Ballot): EffectiveFlags {
  return { noMove: !!ballot.noMove, noPan: !!ballot.noPan, noZoom: !!ballot.noZoom, pack: ballot.pack ?? DEFAULT_PACK };
}

export interface RoomOptions {
  /** Picks the wish - tests pass their own. Returns a number in [0, 1). */
  random?: () => number;
  /** See DRAW_REVEAL_MS. */
  drawRevealMs?: number;
}

// --- Input sanitising ----------------------------------------------------------

const finite = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export function sanitizeSettings(input: Partial<Settings> | undefined, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = input ?? {};
  const rounds = finite(raw.rounds) ?? base.rounds;
  const hp = finite(raw.hp) ?? base.hp;
  const rawLimit = finite(raw.timeLimit) ?? base.timeLimit;

  const flag = (name: VoteFlag): boolean => (raw[name] === undefined ? base[name] : !!raw[name]);
  const locked = Object.fromEntries(VOTE_KEYS.map((name) => [
    name, raw.locked?.[name] === undefined ? base.locked[name] : !!raw.locked[name],
  ])) as Record<VoteKey, boolean>;
  // No Pan without No Move makes no sense: whoever may walk turns with it.
  const noPan = flag('noPan');
  const noMove = flag('noMove') || noPan;

  return {
    mode: GAME_MODES.includes(raw.mode as GameMode) ? (raw.mode as GameMode) : base.mode,
    rounds: Math.min(LIMITS.rounds.max, Math.max(LIMITS.rounds.min, Math.round(rounds))),
    hp: Math.min(LIMITS.hp.max, Math.max(LIMITS.hp.min, Math.round(hp / LIMITS.hp.step) * LIMITS.hp.step)),
    teams: raw.teams === undefined ? base.teams : !!raw.teams,
    timeLimit: rawLimit <= 0 ? 0 : Math.min(LIMITS.timeLimit.max, Math.max(LIMITS.timeLimit.min, Math.round(rawLimit))),
    noMove,
    noPan,
    noZoom: flag('noZoom'),
    pack: isPackId(raw.pack) ? raw.pack : base.pack,
    locked,
  };
}

/** The face is a 32-bit number the client draws the photo from. Anything else is discarded. */
export function sanitizeFace(raw: unknown): number | null {
  const face = Number(raw);
  return Number.isInteger(face) && face >= 0 && face <= 0xffffffff ? face : null;
}

export function sanitizeName(raw: unknown): string {
  const name = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameLength);
  return name || 'Player';
}

/** Validates a guess and normalises the longitude (the map scrolls endlessly). */
function normalizePin(lat: number, lng: number): LatLng & { at: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90) fail('invalidGuess');
  return { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180, at: Date.now() };
}

// --- The room ------------------------------------------------------------------

export class Room {
  readonly players = new Map<string, Player>();
  hostId: string | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS, locked: { ...DEFAULT_SETTINGS.locked } };
  phase: RoomPhase = 'lobby';
  roundIndex = -1;
  locations: Located[] = [];
  roundEndsAt: number | null = null;
  lastRoundResults: RevealMessage | null = null;
  /** Finished rounds, for the map on the final screen. */
  history: RevealMessage[] = [];
  chatLog: ChatMessage[] = [];
  events: RoomEvents = noEvents;

  private roundTimer: NodeJS.Timeout | null = null;
  private emptySince: number | null = Date.now();
  private loadError: LoadError | null = null;
  private roundStartedAt: number | null = null;
  private confirmCount = 0;
  private finalStatsCache: FinalStats | null = null;
  /** Counts games - so a late top-up does not land in the next one. */
  private gameId = 0;
  private locationFetch: Promise<void> | null = null;
  private teamState: Record<TeamId, TeamState> | null = null;
  private readonly votes = new Map<string, Ballot>();
  private draw: DrawResult | null = null;
  private chatSeq = 0;
  /** Names (lower-cased) the host kicked. */
  private readonly banned = new Set<string>();
  private pausedAt: number | null = null;
  private pauseLeftMs: number | null = null;

  private readonly random: () => number;
  private readonly drawRevealMs: number;

  constructor(readonly code: string, private readonly finder: LocationFinder, options: RoomOptions = {}) {
    this.random = options.random ?? Math.random;
    this.drawRevealMs = options.drawRevealMs ?? DRAW_REVEAL_MS;
  }

  isPaused(): boolean { return this.pausedAt !== null; }
  isDuel(): boolean { return this.settings.mode === 'duel'; }
  isTeamDuel(): boolean { return this.isDuel() && this.settings.teams; }

  /** Duel: still in the race. Classic: always. */
  isAlive(player: Player): boolean {
    return !this.isDuel() || (player.hp ?? 0) > 0;
  }

  /**
   * Spectators do not guess but see everyone else's pins: whoever joins in
   * the middle of a game (classic until the next round, duel until the next
   * game) and whoever is knocked out of a duel.
   */
  isSpectator(player: Player): boolean {
    if (player.spectator) return true;
    return this.isDuel() && this.phase !== 'lobby' && !this.isAlive(player);
  }

  spectatorReason(player: Player): SpectatorReason | null {
    if (!this.isSpectator(player)) return null;
    if (!player.spectator) return 'out';
    return this.isDuel() ? 'nextGame' : 'nextRound';
  }

  /** The pins of the round as they lie right now - meant for spectators only. */
  currentPins(): PinSnapshot[] {
    if (this.phase !== 'playing') return [];
    return [...this.players.values()]
      .filter((p) => p.pin && !this.isSpectator(p))
      .map((p) => ({ playerId: p.id, lat: p.pin!.lat, lng: p.pin!.lng, confirmed: p.confirmed }));
  }

  alivePlayers(): Player[] {
    return [...this.players.values()].filter((p) => this.isAlive(p));
  }

  /** The duel is decided as soon as at most one player (or team) is standing. */
  duelDecided(): boolean {
    if (!this.isDuel()) return false;
    if (this.isTeamDuel()) return TEAM_IDS.filter((id) => (this.teamState?.[id].hp ?? 0) > 0).length <= 1;
    return this.alivePlayers().length <= 1;
  }

  /** Time since the round started - basis for every timing statistic. */
  elapsedMs(): number {
    return this.roundStartedAt ? Math.max(0, Date.now() - this.roundStartedAt) : 0;
  }

  inCountdown(): boolean {
    return this.phase === 'playing' && (this.roundStartedAt ?? 0) > Date.now();
  }

  activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** Players whose guess can end the round. Knocked-out duellists may guess for fun but hold nobody up. */
  contenders(): Player[] {
    return this.activePlayers().filter((p) => this.isAlive(p) && !p.spectator);
  }

  // --- Players ---------------------------------------------------------

  private takenColors(exceptId: string | null = null): Set<string> {
    return new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.color));
  }

  /** First free colour from `palette` - if all are taken, any free one. */
  private nextColor(palette: readonly string[] = PLAYER_COLORS, exceptId: string | null = null): string {
    const taken = this.takenColors(exceptId);
    return palette.find((c) => !taken.has(c))
      ?? PLAYER_COLORS.find((c) => !taken.has(c))
      ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length]!;
  }

  /** The colours a player may wear - in a team duel those of their team. */
  private paletteFor(team: TeamId): readonly string[] {
    return this.isTeamDuel() ? TEAM_PALETTES[team] : PLAYER_COLORS;
  }

  /** Whoever wears a colour outside their palette gets the first free matching one. */
  private matchTeamColors(): void {
    for (const p of this.players.values()) {
      const palette = this.paletteFor(p.team);
      if (palette.includes(p.color)) continue;
      const color = this.nextColor(palette, p.id);
      if (palette.includes(color)) p.color = color;
    }
  }

  private requirePlayer(playerId: string): Player {
    return this.players.get(playerId) ?? fail('unknownPlayer');
  }

  private inLobby(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  /** Free colour choice in the lobby - every colour exists only once. */
  setColor(playerId: string, color: string): void {
    if (!this.inLobby()) fail('lobbyOnlyColor');
    const player = this.requirePlayer(playerId);
    if (!this.paletteFor(player.team).includes(color)) fail(this.isTeamDuel() ? 'teamColorsOnly' : 'unknownColor');
    if (player.color === color) return;
    if ([...this.players.values()].some((p) => p.id !== playerId && p.color === color)) fail('colorTaken');
    player.color = color;
    this.events.onChange();
  }

  /** A freshly rolled passport photo - like the colour, lobby only. */
  setFace(playerId: string, raw: unknown): void {
    if (!this.inLobby()) fail('lobbyOnlyFace');
    const player = this.requirePlayer(playerId);
    const face = sanitizeFace(raw);
    if (face === null || face === player.face) return;
    player.face = face;
    this.events.onChange();
  }

  /** The smaller team - newcomers land there, everyone may switch themselves. */
  private smallerTeam(): TeamId {
    const size = (id: TeamId): number => this.activePlayers().filter((p) => p.team === id).length;
    return TEAM_IDS.reduce((best, id) => (size(id) < size(best) ? id : best));
  }

  setTeam(playerId: string, team: unknown): void {
    if (!this.inLobby()) fail('lobbyOnlyTeam');
    const player = this.requirePlayer(playerId);
    if (!isTeamId(team)) fail('unknownTeam');
    if (player.team === team) return;
    player.team = team;
    this.matchTeamColors();
    this.events.onChange();
  }

  addPlayer(name: string, socket: PlayerSocket | null, face: number | null = null): Player {
    if (this.banned.has(name.toLowerCase())) fail('banned');
    if (this.activePlayers().length >= LIMITS.players) fail('roomFull', { max: LIMITS.players });
    // Assigned even without team mode: when it is switched on, nobody is left without a team.
    const team = this.smallerTeam();
    const player: Player = {
      id: randomUUID(),
      name: this.uniqueName(name),
      socket,
      connected: true,
      color: this.nextColor(this.paletteFor(team)),
      face: sanitizeFace(face),
      team,
      score: 0,
      hp: null,
      outRound: null,
      pin: null,
      confirmed: false,
      spectator: !this.inLobby(),
      disconnectedAt: null,
      ready: false,
      stats: [],
      roundStat: null,
      chattedAt: [],
    };
    this.players.set(player.id, player);
    this.hostId ??= player.id;
    this.emptySince = null;
    return player;
  }

  private uniqueName(name: string, exceptId: string | null = null): string {
    const existing = new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!existing.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const candidate = `${name} ${i}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${name} ${Date.now() % 1000}`;
  }

  reattach(playerId: string, socket: PlayerSocket, name?: string): Player | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (player.socket && player.socket !== socket && player.connected) {
      // Replace the old connection.
      try { player.socket.close(4001, 'Taken over by another tab'); } catch { /* already gone */ }
    }
    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = null;
    if (name) player.name = this.uniqueName(sanitizeName(name), player.id);
    this.emptySince = null;
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;
    return player;
  }

  markDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.socket = null;
    player.disconnectedAt = Date.now();

    // In the lobby (and after the game) nobody needs to hold a seat.
    if (this.inLobby()) {
      this.players.delete(playerId);
      this.votes.delete(playerId);
    }

    if (this.hostId === playerId) this.promoteNewHost();
    if (this.activePlayers().length === 0) this.emptySince = Date.now();
  }

  // --- Host tools ------------------------------------------------------------

  /** Kick: the player leaves, their name stays banned for this room. Returns the player so the socket can be closed. */
  kick(hostId: string, playerId: string): Player {
    this.assertHost(hostId);
    if (playerId === hostId) fail('cannotKickSelf');
    const player = this.requirePlayer(playerId);
    this.banned.add(player.name.toLowerCase());
    this.players.delete(playerId);
    this.votes.delete(playerId);
    if (this.activePlayers().length === 0) this.emptySince = Date.now();
    return player;
  }

  transferHost(hostId: string, playerId: string): void {
    this.assertHost(hostId);
    const player = this.players.get(playerId);
    if (!player?.connected) fail('playerAway');
    this.hostId = playerId;
  }

  /** Pause the round: the timer stops, pins are refused, everyone sees the pause. */
  pause(hostId: string): void {
    this.assertHost(hostId);
    if (this.phase !== 'playing') fail('noRoundRunning');
    if (this.inCountdown()) fail('afterCountdown');
    if (this.isPaused()) return;
    this.pausedAt = Date.now();
    this.pauseLeftMs = this.roundEndsAt ? Math.max(0, this.roundEndsAt - this.pausedAt) : null;
    this.stopTimer();
  }

  /** Resume: the remaining time runs again, the stats do not count the pause. */
  resume(hostId: string): void {
    this.assertHost(hostId);
    if (this.pausedAt === null) return;
    const pausedFor = Date.now() - this.pausedAt;
    this.roundStartedAt = (this.roundStartedAt ?? Date.now()) + pausedFor;
    if (this.pauseLeftMs !== null) {
      this.roundEndsAt = Date.now() + this.pauseLeftMs;
      this.roundTimer = setTimeout(() => {
        this.roundTimer = null;
        this.endRound();
      }, this.pauseLeftMs);
    }
    this.pausedAt = null;
    this.pauseLeftMs = null;
  }

  private promoteNewHost(): void {
    const crowd = this.activePlayers();
    const next = crowd.find((p) => !this.isSpectator(p)) ?? crowd[0] ?? null;
    this.hostId = next ? next.id : null;
    if (!next) this.stopTimer();
  }

  // --- Chat ----------------------------------------------------------------

  /** Validates and stores a chat message. Returns it, or null if empty. */
  chat(playerId: string, raw: unknown): ChatMessage | null {
    const player = this.requirePlayer(playerId);
    // Whoever is guessing should not chat - spectators may.
    if (this.phase === 'playing' && !this.isSpectator(player)) fail('chatClosed');

    const text = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.chatLength);
    if (!text) return null;

    const now = Date.now();
    player.chattedAt = player.chattedAt.filter((t) => now - t < CHAT_WINDOW_MS);
    if (player.chattedAt.length >= CHAT_BURST) fail('chatTooFast');
    player.chattedAt.push(now);

    const message: ChatMessage = { id: ++this.chatSeq, playerId, name: player.name, color: player.color, text, at: now };
    this.chatLog.push(message);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
    return message;
  }

  // --- Wishes for No Move / No Pan / No Zoom and the map pack ------------
  //
  // Everyone who sets anything has a whole wish (see wishOf). At the start
  // one wish is drawn at random and applies as it is, so a minority gets its
  // turn too. Whatever the host locks applies on every wish.

  vote(playerId: string, flag: VoteKey, value: boolean | PackId | null): void {
    if (!this.inLobby()) fail('lobbyOnlyVote');
    if (!VOTE_KEYS.includes(flag)) fail('notVotable');
    if (!this.players.has(playerId)) fail('unknownPlayer');
    const { locked } = this.settings;
    if (locked[flag]) fail('hostLocked');

    const ballot: Ballot = { ...(this.votes.get(playerId) ?? {}) };
    if (flag === 'pack') {
      if (value !== null && !isPackId(value)) fail('unknownPack');
      if (value === null) delete ballot.pack;
      else ballot.pack = value;
      this.storeBallot(playerId, ballot);
      return;
    }

    if (typeof value === 'string') fail('notVotable');
    if (flag === 'noPan' && value === true && locked.noMove && !this.settings.noMove) fail('noPanNeedsNoMove');

    if (value === null) delete ballot[flag];
    else ballot[flag] = value;

    // No Pan requires No Move - on every single wish.
    if (flag === 'noPan' && ballot.noPan === true && !locked.noMove) ballot.noMove = true;
    if (flag === 'noMove' && ballot.noMove !== true && ballot.noPan === true) {
      if (ballot.noMove === false) ballot.noPan = false;
      else delete ballot.noPan;
    }
    this.storeBallot(playerId, ballot);
  }

  /** A ballot with nothing set is no wish. */
  private storeBallot(playerId: string, ballot: Ballot): void {
    if (Object.keys(ballot).length) this.votes.set(playerId, ballot);
    else this.votes.delete(playerId);
    this.events.onChange();
  }

  /** The wishes of the players still present. */
  private wishes(): { player: Player; wish: EffectiveFlags }[] {
    return [...this.votes]
      .map(([id, ballot]) => ({ player: this.players.get(id), wish: wishOf(ballot) }))
      .filter((w): w is { player: Player; wish: EffectiveFlags } => !!w.player?.connected);
  }

  /** Who wants what, per restriction and per pack. */
  voteTally(): VoteTally {
    const tally: VoteTally = { noMove: { yes: [], no: [] }, noPan: { yes: [], no: [] }, noZoom: { yes: [], no: [] }, pack: {} };
    for (const { player, wish } of this.wishes()) {
      for (const flag of VOTE_FLAGS) tally[flag][wish[flag] ? 'yes' : 'no'].push(player.id);
      (tally.pack[wish.pack] ??= []).push(player.id);
    }
    return tally;
  }

  /** A wish with the host's locks laid over it. */
  private withLocks(wish: EffectiveFlags): EffectiveFlags {
    const { locked } = this.settings;
    const out = { ...wish };
    for (const key of VOTE_KEYS) if (locked[key]) Object.assign(out, { [key]: this.settings[key] });
    // The wish is consistent in itself, but a lock can cut across: then the lock wins.
    if (out.noPan && !out.noMove) {
      if (locked.noMove) out.noPan = false;
      else out.noMove = true;
    }
    return out;
  }

  /**
   * Draws the wish for the next game. Without wishes, or with everything
   * locked, there is nothing to draw: then the locks and otherwise the
   * defaults apply.
   */
  drawWish(): { flags: EffectiveFlags; draw: DrawResult | null } {
    const wishes = this.wishes();
    const locked = VOTE_KEYS.filter((key) => this.settings.locked[key]);
    const fallback = this.withLocks({ noMove: false, noPan: false, noZoom: false, pack: DEFAULT_PACK });
    if (!wishes.length || locked.length === VOTE_KEYS.length) return { flags: fallback, draw: null };

    const index = Math.min(wishes.length - 1, Math.floor(this.random() * wishes.length));
    const { player, wish } = wishes[index]!;
    const flags = this.withLocks(wish);
    const same = (other: EffectiveFlags): boolean => {
      const o = this.withLocks(other);
      return o.pack === flags.pack && VOTE_FLAGS.every((f) => o[f] === flags[f]);
    };
    return {
      flags,
      draw: {
        playerId: player.id,
        name: player.name,
        color: player.color,
        face: player.face,
        flags,
        locked,
        alike: wishes.filter((w) => w.player.id !== player.id && same(w.wish)).map((w) => w.player.id),
        wishes: wishes.length,
      },
    };
  }

  // --- Ready -------------------------------------------------------------

  /** "Ready" in the lobby and the reveal. Once everyone is, the game starts or continues by itself. */
  async setReady(playerId: string, value: boolean): Promise<void> {
    if (this.phase !== 'lobby' && this.phase !== 'reveal') fail('wrongMoment');
    const player = this.requirePlayer(playerId);
    player.ready = value;
    this.events.onChange();
    await this.advanceIfAllReady();
  }

  private clearReady(): void {
    for (const p of this.players.values()) p.ready = false;
  }

  /** Nobody missing? Then move on. Disconnected players hold nothing up. */
  async advanceIfAllReady(): Promise<void> {
    const crowd = this.activePlayers();
    if (!crowd.length || !crowd.every((p) => p.ready)) return;
    if (this.phase === 'lobby') await this.beginGame();
    else if (this.phase === 'reveal') await this.advance();
  }

  // --- Flow --------------------------------------------------------------

  updateSettings(playerId: string, patch: Partial<Settings>): void {
    this.assertHost(playerId);
    if (!this.inLobby()) fail('lobbyOnlySettings');
    this.settings = sanitizeSettings(patch, this.settings);
    this.matchTeamColors(); // team mode just switched on? Then team shades.
  }

  private assertHost(playerId: string): void {
    if (playerId !== this.hostId) fail('hostOnly');
  }

  /** Host variant: starts even if not everyone is ready yet. */
  async start(playerId: string): Promise<void> {
    this.assertHost(playerId);
    await this.beginGame();
  }

  private async beginGame(): Promise<void> {
    if (this.phase === 'playing' || this.phase === 'loading') fail('gameRunning');
    if (this.activePlayers().length === 0) fail('noPlayers');
    if (this.isDuel() && this.activePlayers().length < 2) fail('duelNeedsTwo');
    if (this.isTeamDuel()) {
      const empty = TEAMS.find((t) => !this.activePlayers().some((p) => p.team === t.id));
      if (empty) fail('teamEmpty', { team: empty.id });
    }

    // The drawn wish applies from here on and stays as the setting.
    const { flags, draw } = this.drawWish();
    Object.assign(this.settings, flags);
    this.draw = draw;

    const duel = this.isDuel();
    this.teamState = this.isTeamDuel()
      ? { red: { hp: this.settings.hp, outRound: null }, blue: { hp: this.settings.hp, outRound: null } }
      : null;
    for (const p of this.players.values()) {
      p.score = 0;
      p.hp = duel ? this.settings.hp : null;
      p.outRound = null;
      p.spectator = false; // a new game, everyone is in
      p.stats = [];
      this.clearPin(p);
    }
    this.phase = 'loading';
    this.gameId++;
    this.locationFetch = null;
    this.roundIndex = -1;
    this.locations = [];
    this.lastRoundResults = null;
    this.history = [];
    this.loadError = null;
    this.finalStatsCache = null;
    this.clearReady();
    this.events.onChange();

    try {
      // In a duel the number of rounds is open - fetch a stock first, the rest is topped up during the reveals.
      // Everyone gets to see the drawn wish, even if the places come quickly.
      const shown = draw && this.drawRevealMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.drawRevealMs)) : null;
      this.locations = await this.findLocations(duel ? DUEL_BATCH : this.settings.rounds);
      if (shown) await shown;
    } catch (err) {
      this.phase = 'lobby';
      this.draw = null;
      this.loadError = errorPayload(err);
      this.events.onChange();
      throw err;
    }

    if (!this.stillLoading(this.gameId)) return; // cancelled in the meantime
    this.beginRound(0);
  }

  private findLocations(count: number): Promise<Located[]> {
    return this.finder(count, { requireMove: !this.settings.noMove, pack: this.settings.pack });
  }

  /** Read fresh after an await: the game may have been cancelled or restarted meanwhile. */
  private stillLoading(gameId: number): boolean {
    return gameId === this.gameId && this.phase === 'loading';
  }

  private spareLocations(): number {
    return this.locations.length - (this.roundIndex + 1);
  }

  /**
   * Duel: when the stock runs low, top up in the background. Runs during the
   * reveal. Whoever ends the game in between does not get the result slipped
   * in (gameId).
   */
  private topUpLocations(): Promise<void> | null {
    if (!this.isDuel() || this.locationFetch) return this.locationFetch;
    if (this.spareLocations() >= DUEL_BUFFER) return null;

    const gameId = this.gameId;
    this.locationFetch = this.findLocations(DUEL_BATCH)
      .then((found) => {
        if (gameId !== this.gameId) return;
        const known = new Set(this.locations.map((l) => l.panoId));
        for (const loc of found) if (!known.has(loc.panoId)) this.locations.push(loc);
      })
      .finally(() => {
        if (gameId === this.gameId) this.locationFetch = null;
      });
    return this.locationFetch;
  }

  private beginRound(index: number): void {
    this.stopTimer();
    this.pausedAt = null;
    this.pauseLeftMs = null;
    this.roundIndex = index;
    this.phase = 'playing';
    this.lastRoundResults = null;
    // Time only runs after the countdown - for the stats as well.
    this.roundStartedAt = Date.now() + COUNTDOWN_MS;
    this.confirmCount = 0;
    this.clearReady();
    for (const p of this.players.values()) {
      // Classic: whoever watched so far joins in. Not in a duel: entering a running game with full HP would be unfair.
      if (!this.isDuel()) p.spectator = false;
      this.clearPin(p);
      p.roundStat = emptyRoundStat(index + 1);
    }

    this.roundEndsAt = this.settings.timeLimit > 0 ? this.roundStartedAt + this.settings.timeLimit * 1000 : null;
    if (this.roundEndsAt) {
      this.roundTimer = setTimeout(() => {
        this.roundTimer = null;
        this.endRound();
      }, this.roundEndsAt - Date.now());
    }

    this.events.onRoundStart();
    this.events.onChange();
  }

  stopTimer(): void {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    this.roundEndsAt = null;
  }

  private clearPin(player: Player): void {
    player.pin = null;
    player.confirmed = false;
  }

  /** Places the pin without submitting it. If time runs out, exactly this pin counts. */
  setPin(playerId: string, lat: number, lng: number): void {
    const player = this.requirePlaying(playerId);
    player.pin = normalizePin(lat, lng);
    if (player.roundStat) recordPin(player.roundStat, player.pin, this.elapsedMs(), this.currentLocation());
    this.events.onPins();
  }

  /** Street View numbers from the client - purely descriptive, no effect on the game. */
  recordTelemetry(playerId: string, raw: unknown): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(playerId);
    if (player?.roundStat) player.roundStat.tele = sanitizeTelemetry(raw);
  }

  /** Submit. Adjusting stays allowed while the round runs - it ends anyway once everyone has submitted. */
  submitGuess(playerId: string, lat: number, lng: number): void {
    const player = this.requirePlaying(playerId);
    player.pin = normalizePin(lat, lng);
    if (player.roundStat) {
      recordPin(player.roundStat, player.pin, this.elapsedMs(), this.currentLocation());
      if (!player.confirmed) {
        player.roundStat.confirmMs = this.elapsedMs();
        player.roundStat.confirmRank = ++this.confirmCount;
      }
    }
    player.confirmed = true;

    this.events.onPins();
    this.events.onChange();
    if (this.contenders().every((p) => p.confirmed)) this.endRound();
  }

  private requirePlaying(playerId: string): Player {
    if (this.phase !== 'playing') fail('noRoundRunning');
    if (this.inCountdown()) fail('roundNotStarted');
    if (this.isPaused()) fail('roundPaused');
    const player = this.requirePlayer(playerId);
    if (this.isSpectator(player)) fail('spectating');
    return player;
  }

  endRound(): void {
    if (this.phase !== 'playing') return;
    this.stopTimer();
    this.pausedAt = null;
    this.pauseLeftMs = null;

    const actual = this.currentLocation();
    if (!actual) return;
    const round = this.roundIndex + 1;
    const duel = this.isDuel();

    // Spectators did not play this round - knocked-out duellists stay in the list, they appear there as "out".
    const scored = [...this.players.values()].filter((p) => !p.spectator).map((player) => {
      const result: RoundResult = {
        playerId: player.id,
        name: player.name,
        color: player.color,
        face: player.face,
        guess: null,
        distanceKm: null,
        points: 0,
        total: 0,
        contender: this.isAlive(player),
      };
      if (player.pin) {
        const { distanceKm: distance, points } = scoreGuess(player.pin, actual);
        result.guess = { lat: player.pin.lat, lng: player.pin.lng };
        result.distanceKm = distance;
        result.points = points;
      }
      player.score += result.points;

      const stat = player.roundStat ?? emptyRoundStat(round);
      closeRoundStat(stat, { guess: result.guess, actual, distance: result.distanceKm, points: result.points });
      if (result.guess && stat.trail.length >= 2) result.trail = stat.trail;
      player.stats.push(stat);
      player.roundStat = null;

      return { result, player };
    });

    let teams: TeamRoundResult[] | null = null;
    if (this.isTeamDuel()) teams = this.dealTeamDamage(scored, round);
    else if (duel) this.dealDamage(scored, round);

    const results = scored.map(({ result, player }) => {
      result.total = player.score;
      if (duel) {
        result.hp = player.hp;
        result.outRound = player.outRound;
      }
      return result;
    });

    // Whoever is out guesses for fun only - and therefore sits at the bottom.
    results.sort((a, b) => Number(b.contender) - Number(a.contender) || b.points - a.points);

    this.lastRoundResults = {
      t: 'reveal',
      round,
      totalRounds: duel ? null : this.settings.rounds,
      mode: this.settings.mode,
      maxHp: duel ? this.settings.hp : null,
      multiplier: duel ? damageMultiplier(round) : null,
      teams,
      actual: { lat: actual.lat, lng: actual.lng },
      place: actual.place ?? null,
      panoId: actual.panoId,
      isLastRound: duel ? this.duelDecided() : round >= this.settings.rounds,
      results,
    };
    this.history.push(this.lastRoundResults);
    this.phase = 'reveal';
    void this.topUpLocations();
    this.events.onReveal();
    this.events.onChange();
  }

  /** Duel: everyone still in the race loses the gap to the best guess of the round. */
  private dealDamage(scored: { result: RoundResult; player: Player }[], round: number): void {
    const inRace = scored.filter((s) => s.result.contender);
    const best = Math.max(0, ...inRace.map((s) => s.result.points));
    const factor = damageMultiplier(round);

    for (const { result, player } of scored) {
      if (!result.contender) {
        Object.assign(result, { damage: 0, hpBefore: 0, knockedOut: false });
        continue;
      }
      const damage = Math.round((best - result.points) * factor);
      result.damage = damage;
      result.hpBefore = player.hp ?? 0;
      player.hp = Math.max(0, (player.hp ?? 0) - damage);
      result.knockedOut = player.hp === 0;
      if (result.knockedOut) player.outRound = round;
    }
  }

  /**
   * Team duel: each team loses the gap between its average points and the
   * best team average of the round, times the factor. The HP belong to the
   * team; every player mirrors them so leaderboard and HUD work as usual.
   */
  private dealTeamDamage(scored: { result: RoundResult; player: Player }[], round: number): TeamRoundResult[] {
    const teamState = this.teamState!;
    const factor = damageMultiplier(round);
    const inRace = TEAMS.filter((t) => teamState[t.id].hp > 0).map((team) => {
      const members = scored.filter((s) => s.result.contender && s.player.team === team.id);
      // Whoever is away and did not guess does not drag the average down.
      const counting = members.filter((s) => s.result.guess !== null || s.player.connected);
      const avg = counting.length ? counting.reduce((sum, s) => sum + s.result.points, 0) / counting.length : 0;
      return { team, members, avg };
    });
    const best = Math.max(0, ...inRace.map((x) => x.avg));

    const outcome = new Map<TeamId, { avg: number; damage: number; hpBefore: number; knockedOut: boolean }>();
    for (const { team, members, avg } of inRace) {
      const state = teamState[team.id];
      const damage = Math.round((best - avg) * factor);
      const hpBefore = state.hp;
      state.hp = Math.max(0, state.hp - damage);
      const knockedOut = state.hp === 0;
      if (knockedOut) state.outRound = round;

      for (const { result, player } of members) {
        Object.assign(result, { damage, hpBefore, knockedOut });
        player.hp = state.hp;
        if (knockedOut) player.outRound = round;
      }
      outcome.set(team.id, { avg: Math.round(avg), damage, hpBefore, knockedOut });
    }

    for (const { result, player } of scored) {
      result.team = player.team;
      if (result.damage === undefined) Object.assign(result, { damage: 0, hpBefore: 0, knockedOut: false });
    }

    return TEAMS.map((team) => {
      const state = teamState[team.id];
      const played = outcome.get(team.id);
      return {
        id: team.id,
        color: team.color,
        contender: !!played,
        avg: played?.avg ?? null,
        damage: played?.damage ?? 0,
        hpBefore: played?.hpBefore ?? 0,
        hp: state.hp,
        knockedOut: played?.knockedOut ?? false,
        outRound: state.outRound,
      };
    });
  }

  /** Host variant: moves on even if not everyone is ready yet. */
  async next(playerId: string): Promise<void> {
    this.assertHost(playerId);
    await this.advance();
  }

  private async advance(): Promise<void> {
    if (this.phase !== 'reveal') fail('roundStillRunning');
    const over = this.isDuel() ? this.duelDecided() : this.roundIndex + 1 >= this.settings.rounds;
    if (over) {
      this.phase = 'finished';
      this.events.onFinal();
      this.events.onChange();
    } else {
      await this.beginNextRound();
    }
  }

  /** Classic: all locations are ready since the start. In a duel the top-up may still be running - then wait briefly. */
  private async beginNextRound(): Promise<void> {
    const index = this.roundIndex + 1;
    if (!this.locations[index]) {
      const gameId = this.gameId;
      this.phase = 'loading';
      this.events.onChange();
      try {
        await (this.topUpLocations() ?? this.locationFetch);
      } catch { /* handled below as a missing location */ }
      if (!this.stillLoading(gameId)) return; // cancelled while we waited
      if (this.locations.at(index) === undefined) {
        this.phase = 'reveal';
        this.events.onChange();
        fail('noLocationFound');
      }
    }
    this.beginRound(index);
  }

  backToLobby(playerId: string): void {
    this.assertHost(playerId);
    this.stopTimer();
    this.pausedAt = null;
    this.pauseLeftMs = null;
    this.phase = 'lobby';
    this.gameId++;
    this.locationFetch = null;
    this.roundIndex = -1;
    this.locations = [];
    this.lastRoundResults = null;
    this.history = [];
    this.loadError = null;
    this.finalStatsCache = null;
    this.teamState = null;
    this.draw = null;
    this.clearReady();
    for (const p of this.players.values()) {
      p.score = 0;
      p.hp = null;
      p.outRound = null;
      p.stats = [];
      p.roundStat = null;
      p.spectator = false;
      this.clearPin(p);
      // Disconnected players no longer hold a seat in the lobby.
      if (!p.connected) this.players.delete(p.id);
    }
    if (!this.hostId || !this.players.has(this.hostId)) this.promoteNewHost();
    this.events.onChange();
  }

  currentLocation(): Located | null {
    return this.locations[this.roundIndex] ?? null;
  }

  /** Classic: points count. Duel: survivors first (more HP is better), then the knocked-out by staying power. */
  leaderboard(): LeaderboardEntry[] {
    const duel = this.isDuel();
    // Whoever only watched and played no round is not on the final screen.
    const list: LeaderboardEntry[] = [...this.players.values()].filter((p) => p.stats.length || !p.spectator).map((p) => ({
      playerId: p.id,
      name: p.name,
      color: p.color,
      face: p.face,
      score: p.score,
      hp: duel ? p.hp : null,
      outRound: duel ? p.outRound : null,
      team: this.isTeamDuel() ? p.team : null,
      connected: p.connected,
    }));

    if (duel) {
      const teamOrder = (p: LeaderboardEntry): number => (p.team ? TEAM_IDS.indexOf(p.team) : TEAM_IDS.length);
      return list.sort((a, b) => (b.hp ?? 0) - (a.hp ?? 0)
        || (b.outRound ?? 0) - (a.outRound ?? 0)
        || teamOrder(a) - teamOrder(b)
        || b.score - a.score || a.name.localeCompare(b.name));
    }
    return list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** The winners of the game - in a duel the survivors, otherwise the top scorers. */
  winners(): LeaderboardEntry[] {
    const board = this.leaderboard();
    if (!board.length) return [];
    if (this.isDuel()) return board.filter((p) => (p.hp ?? 0) > 0);
    const best = board[0]!.score;
    return best > 0 ? board.filter((p) => p.score === best) : [];
  }

  /** Team duel: the teams in final-screen order. */
  teamStandings(): TeamStanding[] | null {
    if (!this.isTeamDuel() || !this.teamState) return null;
    const teamState = this.teamState;
    return TEAMS.map((team) => {
      const members = [...this.players.values()].filter((p) => p.team === team.id && p.stats.length);
      const rounds = members.reduce((n, p) => n + p.stats.length, 0);
      const points = members.reduce((n, p) => n + p.score, 0);
      return {
        id: team.id,
        color: team.color,
        hp: teamState[team.id].hp,
        outRound: teamState[team.id].outRound,
        avgPoints: rounds ? Math.round(points / rounds) : 0,
        members: members.map((p) => p.id),
      };
    }).sort((a, b) => b.hp - a.hp || (b.outRound ?? 0) - (a.outRound ?? 0));
  }

  /** Titles and the statistics table, memoised: a reconnect must not hand anyone a new title. */
  finalStats(): FinalStats {
    if (this.finalStatsCache) return this.finalStatsCache;

    const roundWinners = new Map<number, Set<string>>();
    for (const r of this.history) {
      const best = Math.max(0, ...r.results.map((x) => x.points));
      roundWinners.set(r.round, new Set(best > 0 ? r.results.filter((x) => x.points === best).map((x) => x.playerId) : []));
    }

    const spots = this.history.map((r) => r.actual);
    const actuals = new Map(this.history.map((r) => [r.round, r.actual]));
    let actualSpreadKm = 0;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) actualSpreadKm = Math.max(actualSpreadKm, distanceKm(spots[i]!, spots[j]!));
    }

    const entries = [...this.players.values()].filter((p) => p.stats.length)
      .map((p) => ({ playerId: p.id, name: p.name, color: p.color, score: p.score, rounds: p.stats }));

    const duel = this.isDuel()
      ? {
          startHp: this.settings.hp,
          teams: this.isTeamDuel(),
          rounds: this.history.map((r) => ({
            round: r.round,
            damage: new Map(r.results.filter((x) => x.contender).map((x) => [x.playerId, x.damage ?? 0])),
            knockedOut: new Set(r.results.filter((x) => x.knockedOut).map((x) => x.playerId)),
          })),
          hpLeft: new Map(entries.map((e) => [e.playerId, this.players.get(e.playerId)?.hp ?? 0])),
        }
      : null;

    this.finalStatsCache = entries.length
      ? buildFinalStats(entries, { roundWinners, actuals, actualSpreadKm, settings: this.settings, timeLimitMs: this.settings.timeLimit * 1000, duel })
      : { titles: {}, metrics: [] };
    return this.finalStatsCache;
  }

  /** What is worth keeping from this game beyond the evening - the input for the Hall of Fame. */
  gameSummary(): GameSummary {
    const titles = this.finalStats().titles;
    const byRound = new Map(this.history.map((r) => [r.round, r]));
    return {
      at: Date.now(),
      mode: this.settings.mode,
      rounds: this.history.length,
      settings: { ...this.settings, locked: { ...this.settings.locked } },
      winners: this.winners().map((p) => p.name),
      players: [...this.players.values()].filter((p) => p.stats.length).map((p) => ({
        name: p.name,
        face: p.face,
        score: p.score,
        title: titles[p.id]?.id ?? null,
        rounds: p.stats.map((r) => ({
          points: r.points,
          distanceKm: r.distanceKm,
          continentHit: r.continentHit,
          place: byRound.get(r.round)?.place?.label ?? null,
          actual: byRound.get(r.round)?.actual ?? null,
          countryCode: byRound.get(r.round)?.place?.countryCode ?? null,
          guess: r.guess,
        })),
      })),
    };
  }

  // --- Serialisation ----------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      round: this.roundIndex + 1,
      totalRounds: this.isDuel() ? null : this.settings.rounds,
      roundEndsAt: this.roundEndsAt,
      paused: this.isPaused(),
      now: Date.now(),
      loadError: this.loadError,
      teamState: this.teamState,
      votes: this.voteTally(),
      draw: this.draw,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        face: p.face,
        score: p.score,
        hp: p.hp,
        outRound: p.outRound,
        team: p.team,
        connected: p.connected,
        hasGuessed: p.confirmed,
        ready: p.ready,
        isHost: p.id === this.hostId,
        spectator: this.isSpectator(p),
      })),
    };
  }

  /** Everything the client needs to load the panorama - without the answer. */
  roundPayload(): RoundMessage | null {
    const loc = this.currentLocation();
    if (!loc || this.phase !== 'playing') return null;
    const round = this.roundIndex + 1;
    return {
      t: 'round',
      round,
      totalRounds: this.isDuel() ? null : this.settings.rounds,
      multiplier: this.isDuel() ? damageMultiplier(round) : null,
      panoId: loc.panoId,
      startsAt: this.roundStartedAt ?? Date.now(),
      endsAt: this.roundEndsAt,
      now: Date.now(),
      settings: this.settings,
    };
  }

  /** All rounds with target and guesses - basis of the map on the final screen. */
  playedRounds(): PlayedRound[] {
    return this.history.map((r) => ({
      round: r.round,
      actual: r.actual,
      place: r.place,
      panoId: r.panoId,
      results: r.results.flatMap((x) => (x.guess && x.distanceKm !== null ? [{
        playerId: x.playerId,
        name: x.name,
        color: x.color,
        guess: x.guess,
        distanceKm: x.distanceKm,
        points: x.points,
        damage: x.damage ?? null,
        knockedOut: !!x.knockedOut,
        team: x.team ?? null,
      }] : [])),
    }));
  }

  isStale(): boolean {
    return this.emptySince !== null && Date.now() - this.emptySince > EMPTY_ROOM_TTL_MS;
  }

  pruneGhosts(): void {
    for (const p of this.players.values()) {
      if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt > RECONNECT_GRACE_MS) this.players.delete(p.id);
    }
    if (this.hostId && !this.players.has(this.hostId)) this.promoteNewHost();
  }
}

// --- Rooms ------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly finder: LocationFinder) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  private createCode(): string {
    for (let i = 0; i < 200; i++) {
      const code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    return fail('noRoomCodes');
  }

  create(): Room {
    const room = new Room(this.createCode(), this.finder);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: unknown): Room | null {
    return this.rooms.get((typeof code === 'string' ? code : '').trim().toUpperCase()) ?? null;
  }

  sweep(): void {
    for (const [code, room] of this.rooms) {
      room.pruneGhosts();
      if (room.isStale()) {
        room.stopTimer();
        this.rooms.delete(code);
      }
    }
  }

  close(): void {
    clearInterval(this.sweeper);
  }
}
