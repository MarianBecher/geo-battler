// Every rule the server enforces reaches the player as one of these codes.
// The server never sends prose: the client translates the code and fills in
// the parameters, so everyone reads it in their own language.

export const ERROR_CODES = [
  'alreadyInRoom', 'noServerKey', 'unknownRoom', 'notInRoom', 'invalidMessage', 'unknownAction',
  'lanOnly', 'hallUnreadable', 'profileUnknown', 'profileUnreadable',
  'banned', 'roomFull', 'invalidGuess',
  'lobbyOnlyColor', 'lobbyOnlyFace', 'lobbyOnlyTeam', 'lobbyOnlyVote', 'lobbyOnlySettings',
  'unknownPlayer', 'teamColorsOnly', 'unknownColor', 'colorTaken', 'unknownTeam',
  'cannotKickSelf', 'playerAway',
  'noRoundRunning', 'afterCountdown', 'roundNotStarted', 'roundPaused', 'spectating',
  'chatClosed', 'chatTooFast',
  'notVotable', 'hostLocked', 'unknownPack', 'noPanNeedsNoMove',
  'wrongMoment', 'hostOnly', 'gameRunning', 'noPlayers', 'duelNeedsTwo', 'teamEmpty',
  'roundStillRunning', 'noLocationFound', 'noRoomCodes', 'noStreetView',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Parameters some codes carry; everything else has none. */
export interface ErrorParams {
  max?: number;
  action?: string;
  team?: string;
}

export interface GameErrorPayload {
  code: ErrorCode | null;
  params: ErrorParams;
  /** English fallback for clients that do not know the code. */
  message: string;
}
