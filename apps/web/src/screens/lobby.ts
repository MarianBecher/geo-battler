// The lobby: the open passport with the travellers on the left and the
// travel conditions on the right. Settings belong to the host, the three
// restrictions and the map pack are voted on.

import {
  DEFAULT_SETTINGS, LIMITS, TEAMS, VOTE_FLAGS, isPackId,
  type PackId, type PlayerSnapshot, type RoomSnapshot, type Settings, type TeamId, type VoteFlag, type VoteKey,
} from '@geo-battler/shared';
import { $, escapeHtml, inkOn, toast } from '../dom.ts';
import { fmtNum, t } from '../i18n/index.ts';
import { errorText, fmtTime, mrzPad, mrzText, packHint, packName, teamName } from '../format.ts';
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

/**
 * The three restrictions with their vote. The result on the right shows what
 * would apply at the start - "On" as a red stamp. Below it the vote row: a
 * for/against switch while open, the host's on/off switch when locked.
 */
function paintVotes(room: RoomSnapshot): void {
  const flags = room.flags;
  const locked = room.settings.locked;
  const host = isHost() && room.phase === 'lobby';
  const names = new Map(room.players.map((p) => [p.id, p.name]));
  const who = (ids: string[]): string => (ids.length ? ids.map((id) => escapeHtml(names.get(id) ?? '?')).join(', ') : t('vote.nobodyYet'));

  for (const flag of VOTE_FLAGS) {
    const box = voteBox(flag);
    const tally = room.votes[flag];
    const yes = tally.yes.length;
    const no = tally.no.length;
    const on = flags[flag];
    // No Pan only works with No Move - if the host switched No Move off, there is nothing left to vote on here.
    const blocked = flag === 'noPan' && locked.noMove && !room.settings.noMove;
    const forced = flag === 'noMove' && on && flags.noPan && !locked.noMove && !(yes > no);

    box.classList.toggle('on', on);
    box.classList.toggle('locked', locked[flag]);
    const result = box.querySelector<HTMLElement>('.vote-result')!;
    result.innerHTML = (locked[flag] ? LOCK_ICON : '') + (on ? t('vote.on') : t('vote.off'));
    result.title = locked[flag] ? t('vote.lockedByHost') : t('vote.currentState');

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
      const mine = state.playerId && tally.yes.includes(state.playerId) ? 'yes' : state.playerId && tally.no.includes(state.playerId) ? 'no' : null;
      const reason = forced ? t('vote.onBecauseNoPan')
        : yes > no ? t('vote.majorityFor')
          : no > yes ? t('vote.majorityAgainst')
            : yes ? t('vote.tie') : t('vote.noVotesYet');
      body = `<div class="seg" role="group" aria-label="${escapeHtml(t('vote.yourVote'))}">
          <button type="button" data-vote="${flag}" data-value="yes" aria-pressed="${mine === 'yes'}" title="${t('vote.for')}: ${who(tally.yes)}">${t('vote.for')} <b>${yes}</b></button>
          <button type="button" data-vote="${flag}" data-value="no" aria-pressed="${mine === 'no'}" title="${t('vote.against')}: ${who(tally.no)}">${t('vote.against')} <b>${no}</b></button>
        </div>
        <span class="vote-state">${reason}</span>
        ${host ? `<button type="button" class="vote-link" data-lock="${flag}">${t('vote.lock')}</button>` : ''}`;
    }
    paintVoteBody(box, body);
  }
  paintPackVote(room, host, who);
}

/** The map pack: a choice instead of for/against. The leading pack applies - locked, only the host picks. */
function paintPackVote(room: RoomSnapshot, host: boolean, who: (ids: string[]) => string): void {
  const box = voteBox('pack');
  const packs = state.config?.packs ?? [];
  const locked = room.settings.locked.pack;
  const votes = room.votes.pack;
  const chosen = room.flags.pack;
  const mine = (Object.entries(votes) as [PackId, string[]][]).find(([, ids]) => state.playerId && ids.includes(state.playerId))?.[0] ?? null;

  box.classList.toggle('on', chosen !== 'world');
  box.classList.toggle('locked', locked);
  const result = box.querySelector<HTMLElement>('.vote-result')!;
  result.innerHTML = (locked ? LOCK_ICON : '') + escapeHtml(packName(chosen));
  result.title = locked ? t('vote.lockedByHost') : t('vote.currentState');
  $('pack-hint').textContent = packHint(chosen);

  const counts = Object.values(votes).map((ids) => ids.length);
  const top = Math.max(0, ...counts);
  const leaders = (Object.entries(votes) as [PackId, string[]][]).filter(([, ids]) => ids.length === top && top > 0);

  let body: string;
  if (locked && !host) {
    body = `<span class="vote-state">${t('vote.lockedByHost')}</span>`;
  } else {
    const attr = locked ? 'data-set' : 'data-vote';
    const chips = packs.map((id) => {
      const ids = votes[id] ?? [];
      const pressed = locked ? id === chosen : mine === id;
      const count = !locked && ids.length ? ` <b>${ids.length}</b>` : '';
      return `<button type="button" ${attr}="pack" data-value="${id}" aria-pressed="${pressed}" title="${escapeHtml(packHint(id))}${locked ? '' : ` - ${who(ids)}`}">${escapeHtml(packName(id))}${count}</button>`;
    }).join('');
    const reason = locked ? t('vote.lockedByYou')
      : top === 0 ? t('vote.noVotesYet')
        : leaders.length > 1 ? t('vote.tie')
          : t('vote.majorityForPack', { pack: escapeHtml(packName(leaders[0]![0])) });
    body = `<div class="seg pack-seg" role="group" aria-label="${escapeHtml(locked ? t('vote.lockPackAria') : t('vote.yourChoice'))}">${chips}</div>
      <span class="vote-state">${reason}</span>
      ${host ? (locked
        ? `<button type="button" class="vote-link" data-unlock="pack">${t('vote.letVote')}</button>`
        : `<button type="button" class="vote-link" data-lock="pack">${t('vote.lock')}</button>`) : ''}`;
  }
  paintVoteBody(box, body);
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
    const flags = state.room?.flags;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    const value = btn.dataset.value ?? '';

    if (btn.dataset.vote === 'pack') {
      send({ t: 'vote', flag: 'pack', value: pressed || !isPackId(value) ? null : value });
    } else if (btn.dataset.vote) {
      // Clicking your own vote again withdraws it.
      send({ t: 'vote', flag: btn.dataset.vote as VoteFlag, value: pressed ? null : value === 'yes' });
    } else if (btn.dataset.set === 'pack') {
      if (isPackId(value)) lockFlag('pack', value);
    } else if (btn.dataset.set) {
      lockFlag(btn.dataset.set as VoteFlag, value === 'on');
    } else if (btn.dataset.lock === 'pack') {
      lockFlag('pack', flags?.pack ?? state.room?.settings.pack ?? 'world');
    } else if (btn.dataset.lock) {
      // Locking takes over the current state of the vote first.
      const flag = btn.dataset.lock as VoteFlag;
      lockFlag(flag, !!flags?.[flag]);
    } else if (btn.dataset.unlock) {
      lockFlag(btn.dataset.unlock as VoteKey, null);
    }
  });

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
