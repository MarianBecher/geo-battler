// The round: the panorama, the HUD with timer and players, the guess map
// with its resize handle, the countdown and the host's pause.

import type { RoomSnapshot, RoundMessage, PinSnapshot } from '@geo-battler/shared';
import * as sfx from '../audio/sound.ts';
import { $, escapeHtml, replay, storage } from '../dom.ts';
import { fmtNum, t } from '../i18n/index.ts';
import { multiplierText, packName, teamName } from '../format.ts';
import { GuessMap, PanoView } from '../maps/google.ts';
import { photo } from '../photo.ts';
import { amOut, isDuel, isHost, isMe, isTeamDuel, serverNow, state } from '../state.ts';
import { send } from '../socket.ts';
import { TEAMS } from '@geo-battler/shared';

let panoView: PanoView | null = null;
let guessMap: GuessMap | null = null;

const roundLabel = (round: number, total: number | null): string => (total ? t('game.roundOf', { n: round, total }) : t('game.round', { n: round }));

// --- HUD -------------------------------------------------------------------------

/** The HP bar - in the player's colour, empty means out. */
export function hpBar(hp: number | null, maxHp: number | null, color: string): string {
  const share = Math.max(0, Math.min(1, (hp ?? 0) / (maxHp ?? 1)));
  return `<span class="hp" style="--hp:${share.toFixed(3)};--hp-color:${color}"><span></span></span>`;
}

/** Who has already submitted this round - so the stamp only lands once. */
const hudGuessed = new Set<string>();

export function renderHudPlayers(room: RoomSnapshot): void {
  const duel = isDuel();
  const teamState = isTeamDuel() ? room.teamState : null;

  // Team duel: the HP belong to the team - one bar per team up front.
  const teamChips = teamState ? TEAMS.map((team) => {
    const hp = teamState[team.id].hp;
    return `
    <li class="team-chip ${hp > 0 ? '' : 'out'}" style="--team:${team.color}" title="${escapeHtml(hp > 0 ? t('hp.count', { n: fmtNum(hp) }) : t('hp.out'))}">
      <span class="name">${escapeHtml(teamName(team.id))}</span>
      ${hp > 0 ? hpBar(hp, room.settings.hp, team.color) : `<span class="ko">${t('hp.out')}</span>`}
    </li>`;
  }).join('') : '';

  $('hud-players').innerHTML = teamChips + room.players.filter((p) => !p.spectator || (duel && !((p.hp ?? 0) > 0))).map((p) => {
    const out = duel && !((p.hp ?? 0) > 0);
    const team = teamState ? TEAMS.find((x) => x.id === p.team) ?? null : null;
    const fresh = p.hasGuessed && !hudGuessed.has(p.id);
    if (p.hasGuessed) hudGuessed.add(p.id); else hudGuessed.delete(p.id);
    const title = duel ? (out ? t('hp.out') : t('hp.count', { n: fmtNum(p.hp ?? 0) })) : '';
    return `
    <li class="${p.hasGuessed ? 'done' : ''} ${p.connected ? '' : 'off'} ${isMe(p.id) ? 'me' : ''} ${out ? 'out' : ''} ${team ? 'in-team' : ''}" ${team ? `style="--team:${team.color}"` : ''} title="${escapeHtml(title)}">
      ${photo(p.name, p.color, p.face)}
      <span class="name">${escapeHtml(p.name)}</span>
      ${p.hasGuessed ? `<span class="stamp stamp-ok hud-check ${fresh ? 'press' : ''}" aria-label="${escapeHtml(t('game.submitted'))}">✓</span>` : ''}
      ${duel && !out && !team ? hpBar(p.hp, room.settings.hp, p.color) : ''}
      ${out && !team ? `<span class="ko">${t('hp.out')}</span>` : ''}
    </li>`;
  }).join('');

  updateGuessControls();
}

function guessedCount(): { done: number; total: number } {
  const players = (state.room?.players ?? []).filter((p) => p.connected && !p.spectator && (!isDuel() || (p.hp ?? 0) > 0));
  return { done: players.filter((p) => p.hasGuessed).length, total: players.length };
}

const samePin = (a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null): boolean =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;

/** Button and status line of the guess map. Submitting is not final. */
export function updateGuessControls(): void {
  const btn = $<HTMLButtonElement>('btn-guess');
  const status = $('guess-status');
  const hasPin = !!state.guess;
  const changed = hasPin && !samePin(state.guess, state.submittedPin);

  btn.disabled = !hasPin || (state.submitted && !changed);
  btn.textContent = !hasPin ? t('game.placePin') : !state.submitted ? t('game.submit') : changed ? t('game.updateGuess') : t('game.submitted');
  btn.classList.toggle('is-done', state.submitted && !changed);

  status.classList.toggle('done', state.submitted);
  status.classList.toggle('out', amOut());
  status.classList.toggle('watch', state.spectating);
  const { done, total } = guessedCount();
  if (state.spectating && state.spectatorReason) {
    status.hidden = false;
    status.textContent = `${t(`spectator.${state.spectatorReason}`)} ${t('game.submittedCount', { done, total })}`;
  } else if (state.submitted) {
    status.hidden = false;
    status.textContent = changed ? t('game.pinMoved') : `${t('game.submittedCount', { done, total })} ${t('game.canStillMove')}`;
  } else if (hasPin) {
    status.hidden = false;
    status.textContent = t('game.pinCountsOnTimeout');
  } else {
    status.hidden = true;
  }
}

// --- The round ---------------------------------------------------------------------

function ensureMaps(): { pano: PanoView; map: GuessMap } {
  panoView ??= new PanoView($('pano'), $('pano-lock'));
  guessMap ??= new GuessMap($('guess-map'), (pos) => {
    state.guess = pos;
    // The server remembers the pin so it counts when time runs out.
    send({ t: 'pin', lat: pos.lat, lng: pos.lng });
    sfx.play('pin');
    updateGuessControls();
  });
  return { pano: panoView, map: guessMap };
}

export function startRound(msg: RoundMessage, show: () => void): void {
  state.round = msg;
  state.revealAnim = null;
  state.spectating = !!msg.spectating;
  state.spectatorReason = msg.spectatorReason ?? null;
  // After a reload the server sends the player's own state along.
  state.guess = msg.myPin ? { lat: msg.myPin.lat, lng: msg.myPin.lng } : null;
  state.submitted = !!msg.myConfirmed;
  state.submittedPin = state.submitted ? state.guess : null;
  state.clockOffset = msg.now - Date.now();

  show();
  const { pano, map } = ensureMaps();

  $('hud-round').textContent = roundLabel(msg.round, msg.totalRounds);
  const mult = $('hud-multiplier');
  mult.hidden = !((msg.multiplier ?? 1) > 1);
  mult.textContent = t('game.damageFactor', { factor: multiplierText(msg.multiplier ?? 1) });
  $('btn-pano-home').hidden = msg.settings.noMove;
  $('hud-modes').innerHTML = [
    msg.settings.pack !== 'world' && escapeHtml(packName(msg.settings.pack)),
    msg.settings.noMove && 'NM',
    msg.settings.noPan && 'NP',
    msg.settings.noZoom && 'NZ',
  ].filter((x): x is string => typeof x === 'string').map((x) => `<span>${x}</span>`).join('');

  pano.show(msg.panoId, msg.settings);

  map.reset();
  map.locked = state.spectating;
  if (state.guess) map.setPin(state.guess);
  map.refresh();
  $('guess-box').classList.remove('pinned');
  $('btn-pin-map').classList.remove('on');
  $('btn-guess').hidden = state.spectating;
  $('hud-watch').hidden = !state.spectating;
  if (state.spectating && msg.pins) showOthersPins(msg.round, msg.pins);

  sfx.hurry(null); // a new round starts calm, even if the last one ended in a hurry
  startCountdown(msg);
  timerEndsAt = msg.endsAt;
  startTimer(msg.endsAt, msg.startsAt);
  startTelemetry();
  if (state.room) renderHudPlayers(state.room);
  syncPause();
}

/** Spectators: the others' pins on the player's own map, with name and colour. */
export function showOthersPins(round: number, pins: PinSnapshot[]): void {
  if (!state.spectating || !guessMap) return;
  if (state.round && round !== state.round.round) return; // straggler from the old round
  const players = new Map((state.room?.players ?? []).map((p) => [p.id, p]));
  guessMap.showOthers(pins.map((pin) => {
    const p = players.get(pin.playerId);
    return { ...pin, name: p?.name ?? '?', color: p?.color ?? '#55627d' };
  }));
}

/** Leaving the round: stop everything that ticks. */
export function stopRound(): void {
  stopTimer();
  stopCountdown();
  stopTelemetry();
}

// --- Countdown ---------------------------------------------------------------------
//
// The server names the moment the round really starts - it refuses pins
// before that. Until then the number sits over everything while the
// panorama loads underneath.

let countdownHandle: ReturnType<typeof setInterval> | null = null;

function startCountdown(msg: RoundMessage): void {
  stopCountdown();
  const overlay = $('countdown');
  const num = $('countdown-num');
  $('countdown-round').textContent = $('hud-round').textContent;

  let shown: number | null = null;
  const tick = (): void => {
    const left = msg.startsAt - serverNow();
    if (left <= 0) {
      // After a reload mid-round there is nothing left to count.
      if (shown !== null) sfx.play('countdown', true);
      stopCountdown();
      return;
    }
    const secs = Math.ceil(left / 1000);
    if (secs !== shown) {
      shown = secs;
      overlay.hidden = false;
      num.textContent = String(secs);
      replay(num, 'pop');
      sfx.play('countdown', false);
    }
  };
  tick();
  if (!overlay.hidden) countdownHandle = setInterval(tick, 100);
}

function stopCountdown(): void {
  if (countdownHandle) clearInterval(countdownHandle);
  countdownHandle = null;
  $('countdown').hidden = true;
  syncPause(); // from now on the host may pause
}

export const inCountdown = (): boolean => countdownHandle !== null;

// --- Timer ---------------------------------------------------------------------------

let timerHandle: ReturnType<typeof setInterval> | null = null;
let timerEndsAt: number | null = null;
/** Seconds before the end at which the music turns urgent (sound.hurry). */
const HURRY_S = 30;

function startTimer(endsAt: number | null, startsAt: number | null): void {
  stopTimer();
  const chip = $('hud-timer');
  if (!endsAt) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;

  // The timer runs four times a second, but the tick should only sound once per second.
  let tickedSecond: number | null = null;
  // During the countdown the full round time is shown, not more.
  const full = startsAt ? endsAt - startsAt : Infinity;
  // From here on the music gets urgent - in short rounds only for the second half.
  const hurryFrom = Math.min(HURRY_S, full / 2000);

  const tick = (): void => {
    const left = Math.min(full, Math.max(0, endsAt - serverNow()));
    const secs = Math.ceil(left / 1000);
    chip.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    chip.classList.toggle('urgent', secs <= 10);
    if (secs !== tickedSecond) {
      tickedSecond = secs;
      if (secs > 0 && secs <= 10) sfx.play('tick', secs <= 3);
    }
    if (left > 0 && left <= (hurryFrom + sfx.HURRY_LOOKAHEAD_S) * 1000) sfx.hurry(left / 1000, hurryFrom);
    if (left <= 0) stopTimer();
  };
  tick();
  timerHandle = setInterval(tick, 250);
}

export function stopTimer(): void {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

/** The host's pause: the overlay covers everything, the timer stands still. */
export function syncPause(): void {
  const room = state.room;
  if (!room || !$('screen-game').classList.contains('active')) return;
  const playing = room.phase === 'playing';
  $('pause').hidden = !(playing && room.paused);
  $('btn-resume').hidden = !isHost();
  $('pause-note').textContent = isHost() ? t('game.pausedByYou') : t('game.pausedByHost');
  $('btn-pause').hidden = !(isHost() && playing && !room.paused && !inCountdown());
  if (playing && room.paused) {
    stopTimer();
    sfx.hurry(null); // the pause takes the pressure off; the timer brings it back
    timerEndsAt = null;
  } else if (playing && room.roundEndsAt !== timerEndsAt) {
    timerEndsAt = room.roundEndsAt;
    startTimer(room.roundEndsAt, state.round?.startsAt ?? null);
  }
}

// --- Telemetry ------------------------------------------------------------------------

const TELEMETRY_INTERVAL_MS = 2000;
let telemetryHandle: ReturnType<typeof setInterval> | null = null;

function sendTelemetry(): void {
  if (!panoView || !guessMap) return;
  send({ t: 'telemetry', stats: { ...panoView.tele, ...guessMap.tele } });
}

function startTelemetry(): void {
  stopTelemetry();
  telemetryHandle = setInterval(sendTelemetry, TELEMETRY_INTERVAL_MS);
}

function stopTelemetry(): void {
  if (telemetryHandle) clearInterval(telemetryHandle);
  telemetryHandle = null;
}

// --- Resizing the map -------------------------------------------------------------------
// The box hangs bottom right, the handle sits top left: dragging left/up
// makes it bigger. The size survives rounds and reloads.

const GUESS_SIZE_KEY = 'geo-battle-map-size';
const GUESS_SIZE_DEFAULT = { w: 720, h: 520 };
const GUESS_SIZE_MIN = { w: 300, h: 190 };
interface Size { w: number; h: number }

function applyGuessSize(size: Size): Size {
  const max = { w: Math.max(GUESS_SIZE_MIN.w, window.innerWidth - 28), h: Math.max(GUESS_SIZE_MIN.h, window.innerHeight - 110) };
  const w = Math.min(Math.max(size.w, GUESS_SIZE_MIN.w), max.w);
  const h = Math.min(Math.max(size.h, GUESS_SIZE_MIN.h), max.h);
  const box = $('guess-box');
  box.style.setProperty('--guess-w', `${Math.round(w)}px`);
  box.style.setProperty('--guess-h', `${Math.round(h)}px`);
  return { w, h };
}

function loadGuessSize(): Size {
  try {
    const raw = JSON.parse(storage.get(GUESS_SIZE_KEY) ?? 'null') as Partial<Size> | null;
    if (raw && Number.isFinite(raw.w) && Number.isFinite(raw.h)) return { w: raw.w!, h: raw.h! };
  } catch { /* broken entry - then the default */ }
  return GUESS_SIZE_DEFAULT;
}

const storeGuessSize = (size: Size): void => storage.set(GUESS_SIZE_KEY, JSON.stringify(size));

function initResize(): void {
  applyGuessSize(loadGuessSize());
  const box = $('guess-box');
  const handle = $('guess-resize');
  let drag: { x: number; y: number; w: number; h: number; size: Size | null } | null = null;
  let frame = 0;

  const refreshSoon = (): void => {
    if (frame || !guessMap) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      guessMap?.refresh();
    });
  };

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    box.classList.add('resizing');
    drag = { x: e.clientX, y: e.clientY, w: box.offsetWidth, h: $('guess-map').offsetHeight, size: null };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.size = applyGuessSize({ w: drag.w + (drag.x - e.clientX), h: drag.h + (drag.y - e.clientY) });
    refreshSoon();
  });
  const endDrag = (): void => {
    if (!drag) return;
    if (drag.size) storeGuessSize(drag.size);
    drag = null;
    box.classList.remove('resizing');
    refreshSoon();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // Double-clicking the handle restores the default size.
  handle.addEventListener('dblclick', () => {
    storeGuessSize(applyGuessSize(GUESS_SIZE_DEFAULT));
    refreshSoon();
  });
  window.addEventListener('resize', () => {
    applyGuessSize(loadGuessSize());
    refreshSoon();
  });
}

// --- Wiring ---------------------------------------------------------------------------------

export function initGame(): void {
  initResize();

  $('btn-pano-home').addEventListener('click', () => panoView?.returnToStart());

  $('btn-guess').addEventListener('click', () => {
    if (!state.guess || state.spectating) return;
    sfx.play('submit');
    state.submitted = true;
    state.submittedPin = state.guess;
    sendTelemetry(); // save the state before submitting
    send({ t: 'guess', lat: state.guess.lat, lng: state.guess.lng });
    updateGuessControls();
  });

  $('btn-pin-map').addEventListener('click', () => {
    const pinned = $('guess-box').classList.toggle('pinned');
    $('btn-pin-map').classList.toggle('on', pinned);
  });

  $('guess-box').addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width') guessMap?.refresh();
  });

  $('btn-pause').addEventListener('click', () => send({ t: 'pause' }));
  $('btn-resume').addEventListener('click', () => send({ t: 'resume' }));
}
