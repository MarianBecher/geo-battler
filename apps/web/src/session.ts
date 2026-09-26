// The session survives a reload: room code, player id and name live in
// sessionStorage so a refresh lands back in the running round.

import { state } from './state.ts';

const STORE_KEY = 'geo-battle-session';
export const NAME_KEY = 'geo-battle-name';

interface Saved {
  code: string;
  playerId: string;
  name: string;
}

export function remember(): void {
  if (!state.code || !state.playerId) return;
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ code: state.code, playerId: state.playerId, name: state.name } satisfies Saved));
  } catch { /* private mode - then no reconnect */ }
}

export function forget(): void {
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* nothing to forget */ }
}

export function recall(): Saved | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') as Partial<Saved> | null;
    return raw?.code && raw.playerId && typeof raw.name === 'string' ? { code: raw.code, playerId: raw.playerId, name: raw.name } : null;
  } catch { return null; }
}
