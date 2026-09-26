// Errors the client can translate: a code plus parameters, with an English
// text as the fallback for clients that do not know the code.

import type { ErrorCode, ErrorParams, GameErrorPayload } from '@geo-battler/shared';

const MESSAGES: Record<ErrorCode, string> = {
  alreadyInRoom: 'You are already in a room',
  noServerKey: 'The server has no Maps key for the location search - see README',
  unknownRoom: 'There is no room with that code',
  notInRoom: 'You are not in a room',
  invalidMessage: 'Invalid message',
  unknownAction: 'Unknown action: {action}',
  lanOnly: 'Only reachable from the local network',
  hallUnreadable: 'The Hall of Fame could not be read',
  profileUnknown: 'The Hall of Fame does not know that name',
  profileUnreadable: 'The personal stats could not be read',
  banned: 'The host removed you from this room',
  roomFull: 'The lobby is full (max. {max} players)',
  invalidGuess: 'Invalid guess',
  lobbyOnlyColor: 'Colours can only be changed in the lobby',
  lobbyOnlyFace: 'The photo can only be changed in the lobby',
  lobbyOnlyTeam: 'Teams can only be changed in the lobby',
  lobbyOnlyVote: 'Voting happens in the lobby',
  lobbyOnlySettings: 'Settings can only be changed in the lobby',
  unknownPlayer: 'Unknown player',
  teamColorsOnly: 'In a team duel you can only pick shades of your team',
  unknownColor: 'That colour does not exist',
  colorTaken: 'Someone already grabbed that colour',
  unknownTeam: 'That team does not exist',
  cannotKickSelf: 'You cannot kick yourself',
  playerAway: 'That player is not here',
  noRoundRunning: 'No round is running right now',
  afterCountdown: 'Wait for the countdown to finish',
  roundNotStarted: 'The round has not started yet',
  roundPaused: 'The host paused the round',
  spectating: 'You are watching this round',
  chatClosed: 'The chat is closed during the round',
  chatTooFast: 'Slow down - too many messages at once',
  notVotable: 'That is not something to vote on',
  hostLocked: 'The host has locked that',
  unknownPack: 'That map pack does not exist',
  noPanNeedsNoMove: 'No Pan only works together with No Move',
  wrongMoment: 'This is not the moment for that',
  hostOnly: 'Only the host may do that',
  gameRunning: 'The game is already running',
  noPlayers: 'No players in the lobby',
  duelNeedsTwo: 'A duel needs at least two players',
  teamEmpty: '{team} is empty - each team needs at least one player',
  roundStillRunning: 'The round is still running',
  noLocationFound: 'No new location found - please try again',
  noRoomCodes: 'No free room codes left',
  noStreetView: 'No location with Street View coverage found',
};

function fill(template: string, params: ErrorParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = (params as Record<string, string | number | undefined>)[name];
    return value === undefined ? match : String(value);
  });
}

export class GameError extends Error {
  readonly code: ErrorCode;
  readonly params: ErrorParams;

  constructor(code: ErrorCode, params: ErrorParams = {}) {
    super(fill(MESSAGES[code], params));
    this.name = 'GameError';
    this.code = code;
    this.params = params;
  }

  toPayload(): GameErrorPayload {
    return { code: this.code, params: this.params, message: this.message };
  }
}

/** `throw` in expression position: `const x = map.get(id) ?? fail('unknownPlayer')`. */
export function fail(code: ErrorCode, params?: ErrorParams): never {
  throw new GameError(code, params);
}

/** Any error as a payload - a GameError keeps its code, anything else only its text. */
export function errorPayload(err: unknown): GameErrorPayload {
  if (err instanceof GameError) return err.toPayload();
  return { code: null, params: {}, message: err instanceof Error ? err.message : String(err) };
}
