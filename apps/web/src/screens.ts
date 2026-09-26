// Screen switching plus the mood the music follows and where the chat sits.

import * as sfx from './audio/sound.ts';
import { placeChat } from './chat.ts';

export type ScreenId = 'screen-home' | 'screen-lobby' | 'screen-loading' | 'screen-game' | 'screen-reveal' | 'screen-final';

// Which music belongs to which screen. The final screen deliberately says
// `null`: the fanfare should stand alone there, the music returns afterwards.
const SCREEN_MOOD: Record<ScreenId, 'lobby' | 'game' | 'reveal' | null> = {
  'screen-home': 'lobby',
  'screen-lobby': 'lobby',
  'screen-loading': 'lobby',
  'screen-game': 'game',
  'screen-reveal': 'reveal', // what follows is decided by sfx.arrive()
  'screen-final': null,
};

export function show(id: ScreenId): void {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === id);
  sfx.setMood(SCREEN_MOOD[id]);
  placeChat(id);
}

export const moodOf = (id: ScreenId): 'lobby' | 'game' | 'reveal' | null => SCREEN_MOOD[id];
