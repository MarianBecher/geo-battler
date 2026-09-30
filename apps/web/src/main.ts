// Entry point: wires the screens to the socket and boots the page.

import './style.css';
import { loadMaps, onAuthFailure } from './maps/google.ts';
import { $, toast } from './dom.ts';
import { t, translateDom } from './i18n/index.ts';
import { ensureFaceDefs } from './photo.ts';
import { state } from './state.ts';
import { close, connect, on, onKicked, rejoin, send } from './socket.ts';
import { forget, recall, remember } from './session.ts';
import { show, moodOf } from './screens.ts';
import { openPassport, turnBackHome, turnIntoLobby, turning } from './ui/passport.ts';
import { startBackdrop } from './ui/backdrop.ts';
import * as sfx from './audio/sound.ts';
import { initSoundButtons } from './ui/sound-button.ts';
import { initChat, addChatMessage, recolorChat, setChatLog } from './chat.ts';
import { initKeyboard } from './keyboard.ts';
import { initHome, ownName, renderHomeCard, showConfigWarning } from './screens/home.ts';
import { closePop, collectSettings, initLobby, paintSettings, renderLobby } from './screens/lobby.ts';
import { inCountdown, initGame, renderHudPlayers, showOthersPins, startRound, stopRound, syncPause } from './screens/game.ts';
import { initReveal, renderRevealList, showReveal } from './screens/reveal.ts';
import { leaveDraw, renderDraw } from './screens/draw.ts';
import { closeStats, initFinal, showFinal } from './screens/final.ts';
import { closeHall, initHall } from './screens/hall.ts';
import { errorText } from './format.ts';
import type { ClientConfig } from '@geo-battler/shared';

translateDom();
ensureFaceDefs();
void startBackdrop(['screen-home', 'screen-lobby']);
initSoundButtons();
// The home screen is already active in the HTML - show() never runs for it.
sfx.setMood(moodOf('screen-home'));

const toggleReady = (): void => send({ t: 'ready', value: !(state.room?.players.find((p) => p.id === state.playerId)?.ready ?? false) });

/** Out of the room, back to the home screen - voluntarily or kicked. */
function leaveToHome(): void {
  state.code = null;
  state.playerId = null;
  state.room = null;
  forget();
  close();
  setChatLog([]);
  void turnBackHome(() => {
    renderHomeCard();
    show('screen-home');
  });
}

initHome(collectSettings);
initLobby({ leaveToHome, toggleReady });
initGame();
initReveal(toggleReady);
initFinal();
initHall(ownName);
initChat();
initKeyboard({ inCountdown, closeStats, closeHall });
onKicked(leaveToHome);

// --- Messages from the server -------------------------------------------------------

on('hello', (msg) => {
  state.playerId = msg.playerId;
  state.code = msg.code;
  state.name = msg.name;
  state.rejoining = false;
  remember();
});

on('room', ({ room }) => {
  state.clockOffset = room.now - Date.now();
  state.room = room;
  renderLobby(room);
  renderRevealList();
  renderHudPlayers(room);
  recolorChat();
  $<HTMLButtonElement>('btn-again').disabled = room.hostId !== state.playerId;
  $('again-hint').hidden = room.hostId === state.playerId;

  // Phase -> screen. The round and reveal screens are switched by their messages.
  const wasEntering = state.entering;
  state.entering = false;
  if (room.phase === 'lobby') {
    stopRound();
    if (wasEntering && document.querySelector('.screen.active')?.id === 'screen-home') {
      void turnIntoLobby(room.code, () => show('screen-lobby'));
    } else if (!turning()) {
      show('screen-lobby');
    }
  } else if (room.phase === 'loading') {
    closePop();
    show('screen-loading');
  }
  renderDraw(room);
  syncPause();
});

on('round', (msg) => leaveDraw(() => startRound(msg, () => show('screen-game'))));
on('pins', (msg) => showOthersPins(msg.round, msg.pins));
on('reveal', (msg) => {
  stopRound();
  showReveal(msg, () => show('screen-reveal'));
});
on('final', (msg) => {
  stopRound();
  showFinal(msg, () => show('screen-final'));
});
on('chatLog', (msg) => setChatLog(msg.messages));
on('chat', (msg) => addChatMessage(msg.message));
on('error', (msg) => {
  state.entering = false;
  if (state.rejoining) {
    // The old room is gone - back to the start.
    state.rejoining = false;
    state.code = null;
    state.playerId = null;
    forget();
    show('screen-home');
    openPassport({ animate: false, focus: $('input-name') });
  }
  toast(errorText(msg));
  $<HTMLButtonElement>('btn-start').disabled = false;
  $<HTMLButtonElement>('btn-force-next').disabled = false;
});
on('pong', () => { /* the heartbeat answer needs no handling */ });

// --- Boot ------------------------------------------------------------------------------

async function boot(): Promise<void> {
  let config: ClientConfig;
  try {
    config = (await (await fetch('/api/config')).json()) as ClientConfig;
  } catch {
    showConfigWarning(null);
    return;
  }
  state.config = config;
  renderHomeCard();
  showConfigWarning(config);
  if (!config.configured) return;

  paintSettings(config.defaults);
  onAuthFailure(() => toast(t('toast.mapsAuthFailed')));
  try {
    await loadMaps(config.mapsApiKey);
  } catch (err) {
    toast((err as Error).message);
    return;
  }

  // After a reload, back into the old room.
  const saved = recall();
  if (saved) {
    state.code = saved.code;
    state.playerId = saved.playerId;
    state.name = saved.name;
    state.rejoining = true;
    show('screen-loading');
    rejoin();
  }
}

void boot();
export { connect };
