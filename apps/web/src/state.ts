// The client's single source of truth: what the server last told us, plus
// the bits of local state a screen needs to render (the pin on the map, the
// running animations). Screens read it and the socket layer writes it.

import type { ClientConfig, LatLng, PlayedRound, RevealMessage, RoomSnapshot, RoundMessage, SpectatorReason } from '@geo-battler/shared';

export interface AppState {
  config: ClientConfig | null;
  playerId: string | null;
  code: string | null;
  name: string;
  room: RoomSnapshot | null;
  /** The current round message. */
  round: RoundMessage | null;
  /** The pin on the map right now. */
  guess: LatLng | null;
  /** Marked ready - the pin can still move. */
  submitted: boolean;
  /** Only watching this round (joined late or out of the duel). */
  spectating: boolean;
  spectatorReason: SpectatorReason | null;
  /** The last reveal message (the ready display redraws it). */
  reveal: RevealMessage | null;
  /** Is the count-up running? Its start on the performance clock. */
  revealAnim: { start: number } | null;
  /** Start of the reveal - the beat for the row animation. */
  revealT0: number;
  /** Round history for the map on the final screen. */
  finalRounds: PlayedRound[];
  /** null = show all rounds. */
  roundFilter: number | null;
  /** serverNow - clientNow */
  clockOffset: number;
  rejoining: boolean;
  /** When the first lobby arrives after creating or joining, the passport turns into it. */
  entering: boolean;
}

export const state: AppState = {
  config: null,
  playerId: null,
  code: null,
  name: '',
  room: null,
  round: null,
  guess: null,
  submitted: false,
  spectating: false,
  spectatorReason: null,
  reveal: null,
  revealAnim: null,
  revealT0: 0,
  finalRounds: [],
  roundFilter: null,
  clockOffset: 0,
  rejoining: false,
  entering: false,
};

/** Server time right now, drift-corrected. */
export const serverNow = (): number => Date.now() + state.clockOffset;

export const isMe = (id: string): boolean => id === state.playerId;

/** The player's own record in the current room snapshot. */
export const me = () => state.room?.players.find((p) => p.id === state.playerId) ?? null;

export const isHost = (): boolean => !!state.room && state.room.hostId === state.playerId;
export const isDuel = (): boolean => state.room?.settings.mode === 'duel';
export const isTeamDuel = (): boolean => isDuel() && !!state.room?.settings.teams;

/** Out of the duel - may still guess, but for fun only. */
export const amOut = (): boolean => isDuel() && state.room?.phase !== 'lobby' && !((me()?.hp ?? 0) > 0);

export const activeScreen = (): string | null => document.querySelector('.screen.active')?.id ?? null;
