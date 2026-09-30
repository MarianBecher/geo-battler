// The lobby: the open passport with the travellers on the left and the
// travel conditions on the right. Settings belong to the host. For the three
// restrictions and the map pack everyone sets a wish, and at the start one
// wish is drawn (see the draw screen).

import {
  DEFAULT_PACK, DEFAULT_SETTINGS, LIMITS, TEAMS, VOTE_FLAGS, isPackId,
  type EffectiveFlags, type PackId, type PlayerSnapshot, type RoomSnapshot, type Settings, type TeamId, type VoteFlag, type VoteKey, type VoteTally,
} from '@geo-battler/shared';
import { $, escapeHtml, inkOn, toast } from '../dom.ts';
import { fmtNum, t } from '../i18n/index.ts';
import { errorText, flagName, fmtTime, mrzPad, mrzText, packHint, packName, teamName } from '../format.ts';
import { photo, randomFace, rememberFace } from '../photo.ts';
import { isHost, isMe, isTeamDuel, me, state } from '../state.ts';
import { send } from '../socket.ts';

const TIME_STEPS = [0, 15, 30, 45, 60, 90, 120, 180, 300, 600];
// Hit points in a duel - fine steps at the bottom, coarse at the top, the
// way you would set them by hand.
const HP_STEPS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 12000, 15000, 20000];

const LOCK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/>'
  + '<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const output = (id: string): HTMLOutputElement => $<HTMLOutputElement>(id);
const dataValue = (id: string, fallback: number): number => Number(output(id).dataset.value ?? fallback);

/** The settings as the form shows them. The voted keys come from the room, not the form. */
export function collectSettings(): Settings {
  const base = state.room?.settings ?? state.config?.defaults ?? DEFAULT_SETTINGS;
  const mode = $('mode-switch').querySelector<HTMLElement>('.on')?.dataset.mode;
  return {
    mode: mode === 'duel' ? 'duel' : 'classic',
    rounds: dataValue('set-rounds', DEFAULT_SETTINGS.rounds),
    hp: dataValue('set-hp', DEFAULT_SETTINGS.hp),
    timeLimit: dataValue('set-time', DEFAULT_SETTINGS.timeLimit),
    noMove: base.noMove,
    noPan: base.noPan,
    noZoom: base.noZoom,
    pack: base.pack,
    locked: { ...DEFAULT_SETTINGS.locked, ...base.locked },
    teams: $<HTMLInputElement>('setting-teams').querySelector<HTMLInputElement>('input')?.checked ?? false,
  };
}

export function paintSettings(settings: Settings): void {
  const duel = settings.mode === 'duel';
  for (const btn of $('mode-switch').querySelectorAll<HTMLButtonElement>('button')) {
    const on = btn.dataset.mode === settings.mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
  }
  // In a duel the HP replace the round count - both at once only confuse.
  $('setting-rounds').hidden = duel;
  $('setting-hp').hidden = !duel;
  $('duel-hint').hidden = !duel;
  $('setting-teams').hidden = !duel;

  output('set-rounds').textContent = String(settings.rounds);
  output('set-rounds').dataset.value = String(settings.rounds);
  output('set-hp').textContent = fmtNum(settings.hp);
  output('set-hp').dataset.value = String(settings.hp);
  output('set-time').textContent = fmtTime(settings.timeLimit);
  output('set-time').dataset.value = String(settings.timeLimit);

  const teams = $('setting-teams').querySelector<HTMLInputElement>('input');
  if (teams) teams.checked = settings.teams;
}

function pushSettings(patch: Partial<Settings>): void {
  const next = { ...collectSettings(), ...patch };
  paintSettings(next);
  send({ t: 'settings', settings: next });
}

/** Host: lock a restriction (on/off) or release it to the vote again. For the pack, `value` is the pack id. */
function lockFlag(flag: VoteKey, value: boolean | PackId | null): void {
  const current = collectSettings();
  const patch: Partial<Settings> = { locked: { ...current.locked, [flag]: value !== null } };
  if (value !== null) {
    if (flag === 'pack') {
      if (isPackId(value)) patch.pack = value;
    } else if (typeof value === 'boolean') {
      patch[flag] = value;
      // No Pan without No Move makes no sense - pull both ways.
      if (flag === 'noPan' && value) patch.noMove = true;
      if (flag === 'noMove' && !value) patch.noPan = false;
    }
  }
  pushSettings(patch);
}

/** Only redraw when something changed - otherwise a button loses keyboard focus on every room message. */
function paintVoteBody(box: HTMLElement, body: string): void {
  const bodyEl = box.querySelector<HTMLElement>('.vote-body');
  if (bodyEl && bodyEl.dataset.rendered !== body) {
    bodyEl.innerHTML = body;
    bodyEl.dataset.rendered = body;
  }
}

const voteBox = (key: VoteKey): HTMLElement => document.querySelector<HTMLElement>(`[data-vote-box="${key}"]`)!;

/** Every player's whole wish, rebuilt from the tally. */
function wishesOf(votes: VoteTally): Map<string, EffectiveFlags> {
  const out = new Map<string, EffectiveFlags>();
  for (const [pack, ids] of Object.entries(votes.pack) as [PackId, string[]][]) {
    for (const id of ids) {
      out.set(id, { pack, noMove: votes.noMove.yes.includes(id), noPan: votes.noPan.yes.includes(id), noZoom: votes.noZoom.yes.includes(id) });
    }
  }
  return out;
}

const percent = (part: number, whole: number): string => `${fmtNum(whole ? Math.round((part / whole) * 100) : 0)}\u00a0%`;

/** The share of wishes that come out the same as mine - the host's locks apply to all of them alike. */
function myChance(room: RoomSnapshot, wishes: Map<string, EffectiveFlags>, mine: EffectiveFlags): string {
  const open = (['pack', ...VOTE_FLAGS] as VoteKey[]).filter((key) => !room.settings.locked[key]);
  const same = [...wishes.values()].filter((w) => open.every((key) => w[key] === mine[key])).length;
  return percent(same, wishes.size);
}

/**
 * The three restrictions. While open, the result on the right says how many
 * of the wishes have it on, below it your own On/Off and who wants what.
 * Locked by the host, the result is the host's On/Off as a stamp.
 */
function paintVotes(room: RoomSnapshot): void {
  const locked = room.settings.locked;
  const host = isHost() && room.phase === 'lobby';
  const wishes = wishesOf(room.votes);
  const total = wishes.size;
  const mine = state.playerId ? wishes.get(state.playerId) ?? null : null;

  for (const flag of VOTE_FLAGS) {
    const box = voteBox(flag);
    const yes = room.votes[flag].yes.length;
    const on = room.settings[flag];
    // No Pan only works with No Move - if the host switched No Move off, there is nothing left to wish for here.
    const blocked = flag === 'noPan' && locked.noMove && !room.settings.noMove;

    box.classList.toggle('on', locked[flag] && on);
    box.classList.toggle('locked', locked[flag]);
    const result = box.querySelector<HTMLElement>('.vote-result')!;
    result.classList.toggle('share', !locked[flag]);
    result.innerHTML = locked[flag] ? LOCK_ICON + (on ? t('vote.on') : t('vote.off')) : total ? percent(yes, total) : '–';
    result.title = locked[flag] ? t('vote.lockedByHost') : t('vote.shareTitle');

    let body: string;
    if (locked[flag]) {
      body = host
        ? `<div class="seg" role="group" aria-label="${escapeHtml(t('vote.lockAria', { flag }))}">
             <button type="button" data-set="${flag}" data-value="on" aria-pressed="${on}">${t('vote.on')}</button>
             <button type="button" data-set="${flag}" data-value="off" aria-pressed="${!on}">${t('vote.off')}</button>
           </div>
           <span class="vote-state">${t('vote.lockedByYou')}</span>
           <button type="button" class="vote-link" data-unlock="${flag}">${t('vote.letVote')}</button>`
        : `<span class="vote-state">${t('vote.lockedByHost')}</span>`;
    } else if (blocked) {
      body = `<span class="vote-state">${t('vote.onlyWithNoMove')}</span>`;
    } else {
      const who = total
        ? `<button type="button" class="who-btn" data-who="${flag}" aria-expanded="false">${t('vote.wantItOn', { n: yes, total })}</button>`
        : t('vote.noWishesYet');
      body = `<div class="seg" role="group" aria-label="${escapeHtml(t('vote.yourVote'))}">
          <button type="button" data-vote="${flag}" data-value="yes" aria-pressed="${!!mine?.[flag]}">${t('vote.on')}</button>
          <button type="button" data-vote="${flag}" data-value="no" aria-pressed="${!!mine && !mine[flag]}">${t('vote.off')}</button>
        </div>
        <span class="vote-state">${who}</span>
        ${host ? `<button type="button" class="vote-link" data-lock="${flag}">${t('vote.lock')}</button>` : ''}`;
    }
    paintVoteBody(box, body);
  }
  paintPackVote(room, host, wishes, mine);
}

/** The map pack: a choice instead of On/Off. Open, every pack shows its share of the wishes; locked, only the host picks. */
function paintPackVote(room: RoomSnapshot, host: boolean, wishes: Map<string, EffectiveFlags>, mine: EffectiveFlags | null): void {
  const box = voteBox('pack');
  const packs = state.config?.packs ?? [];
  const locked = room.settings.locked.pack;
  const votes = room.votes.pack;
  const total = wishes.size;
  const chosen = room.settings.pack;
  const distinct = Object.keys(votes).length;

  box.classList.toggle('on', locked && chosen !== DEFAULT_PACK);
  box.classList.toggle('locked', locked);
  const result = box.querySelector<HTMLElement>('.vote-result')!;
  result.classList.toggle('share', !locked);
  result.innerHTML = locked ? LOCK_ICON + escapeHtml(packName(chosen)) : total ? t('vote.packs', { n: distinct }) : '–';
  result.title = locked ? t('vote.lockedByHost') : t('vote.packsTitle');
  $('pack-hint').textContent = packHint(locked ? chosen : mine?.pack ?? DEFAULT_PACK);

  let body: string;
  if (locked && !host) {
    body = `<span class="vote-state">${t('vote.lockedByHost')}</span>`;
  } else {
    const attr = locked ? 'data-set' : 'data-vote';
    const chips = packs.map((id) => {
      const count = votes[id]?.length ?? 0;
      const pressed = locked ? id === chosen : mine?.pack === id;
      const share = !locked && count ? ` <b>${percent(count, total)}</b>` : '';
      const who = !locked && count ? ` data-who="pack:${id}"` : '';
      return `<button type="button" ${attr}="pack" data-value="${id}" aria-pressed="${pressed}"${who}>${escapeHtml(packName(id))}${share}</button>`;
    }).join('');
    const explain = locked ? t('vote.lockedByYou')
      : !total ? t('vote.noWishesStart')
        : `${t('vote.drawExplain', { n: total })} ${mine ? t('vote.yourChance', { pct: myChance(room, wishes, mine) }) : t('vote.setToCount')}`;
    body = `<div class="seg pack-seg" role="group" aria-label="${escapeHtml(locked ? t('vote.lockPackAria') : t('vote.yourChoice'))}">${chips}</div>
      <span class="vote-state">${explain}</span>
      ${host ? (locked
        ? `<button type="button" class="vote-link" data-unlock="pack">${t('vote.letVote')}</button>`
        : `<button type="button" class="vote-link" data-lock="pack">${t('vote.lock')}</button>`) : ''}`;
  }
  paintVoteBody(box, body);
}

// --- Who wants what ------------------------------------------------------------
//
// Hovering (or tapping) "3 of 4 want it on" or a pack's share opens a small
// card with the names. It is built from the room at the moment it opens.

let popAnchor: HTMLElement | null = null;
/** How the last press came in - a mouse already opened the card by hovering. */
let lastPointer = 'mouse';
/** When it came in: focus right after a press is the press, not the keyboard. */
let pressedAt = 0;

function popContent(key: string): string {
  const room = state.room;
  if (!room) return '';
  const players = new Map(room.players.map((p) => [p.id, p]));
  const list = (ids: string[]): string => (ids.length
    ? `<ul>${ids.map((id) => players.get(id)).filter((p) => !!p).map((p) => `<li><i class="dot" style="background:${p.color}"></i>${escapeHtml(p.name)}</li>`).join('')}</ul>`
    : `<ul><li class="none">${t('vote.nobodyYet')}</li></ul>`);
  if (key.startsWith('pack:')) {
    const id = key.slice(5);
    if (!isPackId(id)) return '';
    return `<div><h4>${escapeHtml(t('vote.whoPack', { pack: packName(id) }))}</h4>${list(room.votes.pack[id] ?? [])}</div>`;
  }
  const flag = key as VoteFlag;
  const name = flagName(flag);
  return `<div><h4>${escapeHtml(t('vote.whoOn', { flag: name }))}</h4>${list(room.votes[flag].yes)}</div>
    <div><h4>${escapeHtml(t('vote.whoOff', { flag: name }))}</h4>${list(room.votes[flag].no)}</div>`;
}

function openPop(anchor: HTMLElement): void {
  const pop = $('vote-pop');
  const html = popContent(anchor.dataset.who ?? '');
  if (!html) return;
  popAnchor?.setAttribute('aria-expanded', 'false');
  popAnchor = anchor;
  if (anchor.classList.contains('who-btn')) anchor.setAttribute('aria-expanded', 'true');
  pop.innerHTML = html;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12))}px`;
  const below = r.bottom + 6;
  pop.style.top = `${below + pop.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 6) : below}px`;
}

export function closePop(): void {
  popAnchor?.setAttribute('aria-expanded', 'false');
  popAnchor = null;
  $('vote-pop').hidden = true;
}

function setSettingsEditable(editable: boolean): void {
  for (const el of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.btn-step, [data-flag], #btn-nmpz, #mode-switch button')) {
    el.disabled = !editable;
  }
  $('settings-note').textContent = editable ? t('lobby.noteHost') : t('lobby.noteGuest');
}

// --- The travellers ------------------------------------------------------------

/** Who has already been seen in the lobby and who already wears "ready" - for the arrival and stamp animations. */
const lobbySeen = new Set<string>();
const lobbyReady = new Set<string>();

function playerRow(p: PlayerSnapshot, phase: RoomSnapshot['phase']): string {
  const role = [
    p.isHost && t('role.host'),
    isMe(p.id) && t('role.you'),
    p.spectator && phase !== 'lobby' && t('role.watching'),
    !p.connected ? t('role.away') : !p.ready && t('role.waiting'),
  ].filter((x): x is string => typeof x === 'string').join(' · ');
  // New travellers glide in, "ready" is pressed on - both only the first time.
  const ready = p.connected && p.ready;
  const arrived = !lobbySeen.has(p.id);
  const pressed = ready && !lobbyReady.has(p.id);
  lobbySeen.add(p.id);
  if (ready) lobbyReady.add(p.id); else lobbyReady.delete(p.id);
  // The host can kick anyone else or hand them the host role.
  const tools = isHost() && !isMe(p.id) ? `
    <span class="row-tools">
      ${p.connected ? `<button type="button" class="btn-icon" data-give-host="${p.id}" title="${escapeHtml(t('lobby.giveHost'))}">&#9733;</button>` : ''}
      <button type="button" class="btn-icon" data-kick="${p.id}" title="${escapeHtml(t('lobby.kick'))}">&times;</button>
    </span>` : '';
  return `
  <li class="${p.connected ? '' : 'off'} ${isMe(p.id) ? 'me' : ''} ${arrived ? 'arrive' : ''}">
    ${photo(p.name, p.color, p.face)}
    <span class="who"><span class="name">${escapeHtml(p.name)}</span><span class="role">${role}</span></span>
    ${ready ? `<span class="stamp stamp-ok ${pressed ? 'press' : ''}">${t('ready')}</span>` : ''}
    ${tools}
  </li>`;
}

function renderPlayers(room: RoomSnapshot): void {
  const players = room.players;
  $('player-count').textContent = String(players.filter((p) => p.connected).length);

  // Team duel: grouped by team, with a button to switch.
  $('lobby-players').innerHTML = isTeamDuel()
    ? TEAMS.map((team) => {
      const members = players.filter((p) => p.team === team.id);
      const mine = me()?.team === team.id;
      return `
        <li class="team-head" style="--team:${team.color}">
          <span class="team-name">${escapeHtml(teamName(team.id))}</span>
          <span class="count">${members.filter((p) => p.connected).length}</span>
          ${mine ? `<span class="tag mine">${t('team.yours')}</span>` : `<button class="btn btn-ghost btn-sm" data-team="${team.id}">${t('team.join')}</button>`}
        </li>
        ${members.map((p) => playerRow(p, room.phase)).join('') || `<li class="team-empty">${t('vote.nobodyYet')}</li>`}`;
    }).join('')
    : players.map((p) => playerRow(p, room.phase)).join('');
}

function renderMrz(room: RoomSnapshot): void {
  const crowd = room.players.filter((p) => p.connected);
  const tail = `<${crowd.length}<${mrzText(t('mrz.players'))}<<`;
  const width = 44;
  const names = crowd.map((p) => mrzText(p.name)).join('<<').slice(0, width - tail.length);
  $('lobby-mrz').textContent = `${mrzPad(`P<GEO<BATTLE<<${mrzText(t('mrz.room'))}<${mrzText(room.code)}`)}\n${names.padEnd(width - tail.length, '<')}${tail}`;
}

/** Free colour choice - what someone already has is locked. */
function renderColorChoice(players: PlayerSnapshot[]): void {
  const myTeam = me()?.team;
  const team = isTeamDuel() && myTeam ? TEAMS.find((x) => x.id === myTeam) ?? null : null;
  const palette = (team && state.config?.teamPalettes[team.id]) ?? state.config?.colors ?? [];
  $('color-label').textContent = team ? t('lobby.yourColorTeam', { team: teamName(team.id) }) : t('lobby.yourColor');
  const taken = new Map(players.map((p) => [p.color, p]));
  const mine = me()?.color;

  $('color-swatches').innerHTML = palette.map((color) => {
    const owner = taken.get(color);
    const free = !owner || owner.id === state.playerId;
    // Taken: the owner's initial on it, like a small passport photo.
    const initial = !owner || free ? '' : Array.from(owner.name.trim())[0]?.toUpperCase() ?? '';
    const title = free ? t('lobby.takeColor') : t('lobby.colorTakenBy', { name: owner.name });
    return `<button class="swatch ${color === mine ? 'mine' : ''}" data-color="${color}" style="background:${color};color:${inkOn(color)}" ${free ? '' : 'disabled'} title="${escapeHtml(title)}">${escapeHtml(initial)}</button>`;
  }).join('');
}

/** Lobby and reveal share the same logic: everyone presses "ready", once all are, it continues by itself. */
export function renderReadyUi(): void {
  const room = state.room;
  if (!room) return;

  const crowd = room.players.filter((p) => p.connected);
  const readyCount = crowd.filter((p) => p.ready).length;
  const amReady = !!me()?.ready;
  const missing = crowd.length - readyCount;
  const counter = t('ready.counter', { ready: readyCount, total: crowd.length });

  const start = $('btn-ready');
  start.textContent = amReady ? t('ready.waitingFor', { n: missing }) : t('ready');
  start.classList.toggle('is-done', amReady);
  $('btn-start').hidden = !isHost();
  $<HTMLButtonElement>('btn-start').disabled = !crowd.length;
  $('start-hint').textContent = crowd.length < 2 ? t('lobby.startHintSolo') : t('lobby.startHintCount', { counter });

  const last = state.reveal?.isLastRound ?? false;
  const next = $('btn-next');
  next.textContent = amReady ? t('ready.waitingFor', { n: missing }) : (last ? t('ready.forFinal') : t('ready.forNextRound'));
  next.classList.toggle('is-done', amReady);
  $('btn-force-next').hidden = !isHost();
  $('btn-force-next').textContent = last ? t('reveal.finalAnyway') : t('reveal.continueAnyway');
  $('next-hint').hidden = false;
  $('next-hint').textContent = crowd.length < 2 ? '' : counter;
}

/** Link to pass on. Deliberately NOT location.origin: the host may have the page open via localhost. */
export function joinUrl(): string {
  const base = state.config?.lanUrls[0] ?? location.origin;
  return `${base}/?code=${state.room?.code ?? ''}`;
}

const extraUrls = (): string[] => (state.config?.lanUrls ?? []).slice(1).map((u) => u.replace(/^https?:\/\//, ''));

/** Everything the lobby shows from a room snapshot. */
export function renderLobby(room: RoomSnapshot): void {
  $('code-badge').textContent = room.code;
  $('share-url').textContent = joinUrl();
  $('share-note').textContent = extraUrls().length ? t('lobby.shareNoteExtra', { urls: extraUrls().join(', ') }) : t('lobby.shareNote');

  renderPlayers(room);
  renderMrz(room);
  paintSettings(room.settings);
  setSettingsEditable(isHost() && (room.phase === 'lobby' || room.phase === 'finished'));
  paintVotes(room);
  if (popAnchor) {
    // The row may have been redrawn - follow the new anchor, or close.
    const anchor = document.querySelector<HTMLElement>(`#screen-lobby [data-who="${popAnchor.dataset.who ?? ''}"]`);
    if (anchor && document.querySelector('#screen-lobby.active')) openPop(anchor);
    else closePop();
  }
  renderColorChoice(room.players);
  renderReadyUi();

  $('lobby-error').hidden = !room.loadError;
  $('lobby-error').textContent = errorText(room.loadError);
}

// --- Copying --------------------------------------------------------------------
//
// On the LAN the game runs on http://<ip>:3000 - and thus in no "secure
// context". navigator.clipboard simply does not exist there, so the copy
// attempt falls back to execCommand and, failing that, to "text is
// selected, please copy it yourself".

async function copyToClipboard(text: string, label: string, selectEl: HTMLElement): Promise<void> {
  if ('clipboard' in navigator) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('toast.copied', { label }), 'good');
      return;
    } catch (err) {
      console.warn('[copy] clipboard API refused:', err);
    }
  }
  if (legacyCopy(text)) {
    toast(t('toast.copied', { label }), 'good');
    return;
  }
  if (selectText(selectEl)) {
    toast(t('toast.selected', { label }));
    return;
  }
  toast(t('toast.copyFailed'));
}

/** The old execCommand route works without HTTPS too. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS ignores select() on readonly fields
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only route on plain http
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

/** Last resort: select the text so the user can copy it themselves. */
function selectText(el: HTMLElement): boolean {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return !sel.isCollapsed;
  } catch {
    return false;
  }
}

// --- Wiring ------------------------------------------------------------------------

export function initLobby(opts: { leaveToHome: () => void; toggleReady: () => void }): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.btn-step')) {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.delta);
      const current = collectSettings();
      if (btn.dataset.step === 'rounds') {
        pushSettings({ rounds: Math.min(LIMITS.rounds.max, Math.max(LIMITS.rounds.min, current.rounds + delta)) });
      } else if (btn.dataset.step === 'hp') {
        // To the next grid value in the direction of the click.
        const next = delta > 0 ? HP_STEPS.find((v) => v > current.hp) : [...HP_STEPS].reverse().find((v) => v < current.hp);
        if (next !== undefined) pushSettings({ hp: next });
      } else {
        let i = TIME_STEPS.indexOf(current.timeLimit);
        if (i === -1) i = TIME_STEPS.indexOf(90);
        i = Math.min(TIME_STEPS.length - 1, Math.max(0, i + delta));
        pushSettings({ timeLimit: TIME_STEPS[i]! });
      }
    });
  }

  $('setting-teams').querySelector('input')?.addEventListener('change', () => pushSettings({}));

  $('screen-lobby').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.vote-body button');
    if (!btn) return;
    const votes = state.room?.votes;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    const value = btn.dataset.value ?? '';

    if (btn.classList.contains('who-btn')) {
      // Touch has no hover: a tap opens the names, a second one closes them.
      if (popAnchor !== btn) openPop(btn);
      else if (lastPointer !== 'mouse') closePop();
    } else if (btn.dataset.vote === 'pack') {
      if (!pressed && isPackId(value)) send({ t: 'vote', flag: 'pack', value });
    } else if (btn.dataset.vote) {
      // A wish is always whole - pressing your own choice again changes nothing.
      if (!pressed) send({ t: 'vote', flag: btn.dataset.vote as VoteFlag, value: value === 'yes' });
    } else if (btn.dataset.set === 'pack') {
      if (isPackId(value)) lockFlag('pack', value);
    } else if (btn.dataset.set) {
      lockFlag(btn.dataset.set as VoteFlag, value === 'on');
    } else if (btn.dataset.lock === 'pack') {
      // Locking takes over what most players wish for.
      const top = (Object.entries(votes?.pack ?? {}) as [PackId, string[]][]).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
      lockFlag('pack', top ?? state.room?.settings.pack ?? DEFAULT_PACK);
    } else if (btn.dataset.lock) {
      const flag = btn.dataset.lock as VoteFlag;
      lockFlag(flag, !!votes && votes[flag].yes.length > votes[flag].no.length);
    } else if (btn.dataset.unlock) {
      lockFlag(btn.dataset.unlock as VoteKey, null);
    }
  });

  const lobbyScreen = $('screen-lobby');
  const hoverTarget = (e: Event): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>('[data-who]');
  lobbyScreen.addEventListener('pointerover', (e) => {
    const el = hoverTarget(e);
    if (el && e.pointerType === 'mouse' && el !== popAnchor) openPop(el);
  });
  lobbyScreen.addEventListener('pointerout', (e) => {
    const el = hoverTarget(e);
    if (el && e.pointerType === 'mouse' && !el.contains(e.relatedTarget as Node | null)) closePop();
  });
  lobbyScreen.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.who-btn');
    if (el && performance.now() - pressedAt > 500) openPop(el);
  });
  lobbyScreen.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement).closest('.who-btn')) closePop();
  });
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    pressedAt = performance.now();
    if (popAnchor && !(e.target as HTMLElement).closest('[data-who]')) closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popAnchor) closePop(); });
  lobbyScreen.addEventListener('scroll', closePop, { capture: true, passive: true });

  $('mode-switch').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (btn && !btn.disabled) pushSettings({ mode: btn.dataset.mode === 'duel' ? 'duel' : 'classic' });
  });

  $('btn-nmpz').addEventListener('click', () => {
    pushSettings({ noMove: true, noPan: true, noZoom: true, locked: { noMove: true, noPan: true, noZoom: true, pack: collectSettings().locked.pack } });
  });

  $('btn-start').addEventListener('click', () => {
    $<HTMLButtonElement>('btn-start').disabled = true;
    send({ t: 'start' }); // the host starts even if not everyone is ready
  });

  $('btn-leave').addEventListener('click', () => {
    send({ t: 'leave' });
    opts.leaveToHome();
  });

  $('share-link').addEventListener('click', () => { void copyToClipboard(joinUrl(), t('lobby.link'), $('share-url')); });
  $('code-badge').addEventListener('click', () => { void copyToClipboard(state.code ?? '', t('lobby.code'), $('code-badge')); });

  // Kicking takes two clicks: the first arms, the second kicks.
  let armedKick: string | null = null;
  $('lobby-players').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const team = target.closest<HTMLElement>('button[data-team]');
    if (team) {
      send({ t: 'team', team: team.dataset.team as TeamId });
      return;
    }
    const give = target.closest<HTMLElement>('[data-give-host]');
    if (give?.dataset.giveHost) {
      send({ t: 'host', playerId: give.dataset.giveHost });
      return;
    }
    const kick = target.closest<HTMLElement>('[data-kick]');
    const id = kick?.dataset.kick;
    if (!kick || !id) return;
    if (armedKick === id) {
      send({ t: 'kick', playerId: id });
      armedKick = null;
      return;
    }
    armedKick = id;
    kick.classList.add('armed');
    kick.textContent = t('lobby.kickConfirm');
    setTimeout(() => {
      if (armedKick !== id) return;
      armedKick = null;
      kick.classList.remove('armed');
      kick.innerHTML = '&times;';
    }, 3000);
  });

  // Roll again: the face stays in the browser so it is the same next evening.
  $('btn-face').addEventListener('click', () => {
    const face = randomFace();
    rememberFace(face);
    send({ t: 'face', face });
  });

  $('color-swatches').addEventListener('click', (e) => {
    const swatch = (e.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
    if (swatch && !swatch.disabled && swatch.dataset.color) send({ t: 'color', color: swatch.dataset.color });
  });

  $('btn-ready').addEventListener('click', opts.toggleReady);
}
