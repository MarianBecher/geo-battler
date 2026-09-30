// The drawn wish: while the server looks for places, a visa page turns in
// over the cover and shows whose wish was drawn. The photo slides in, the
// four conditions are stamped one after another, then a line on who wanted
// the same. The server holds the first round long enough for all of it.

import { VOTE_FLAGS, type DrawResult, type RoomSnapshot } from '@geo-battler/shared';
import { $, escapeHtml, motionAllowed, replay } from '../dom.ts';
import { fmtNum, t } from '../i18n/index.ts';
import { flagName, packName } from '../format.ts';
import { photo } from '../photo.ts';
import { isMe } from '../state.ts';
import * as sfx from '../audio/sound.ts';

const LOCK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/>'
  + '<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

/** When the stamps come down, after the page has turned in (ms). Matches the CSS. */
const FIRST_STAMP_MS = 1000;
const STAMP_GAP_MS = 220;
const LEAVE_MS = 450;

/** The draw on screen right now - a new room message with the same draw must not start it over. */
let shownKey: string | null = null;
let stampTimers: number[] = [];

const percent = (part: number, whole: number): string => `${fmtNum(whole ? Math.round((part / whole) * 100) : 0)}\u00a0%`;

/** "Ada, Bob and you" */
function nameList(ids: string[], room: RoomSnapshot): string {
  const names = ids.map((id) => (isMe(id) ? t('draw.you') : escapeHtml(room.players.find((p) => p.id === id)?.name ?? '?')));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('draw.and')} ${names.at(-1)}` : names[0] ?? '';
}

function subline(draw: DrawResult): string {
  if (draw.wishes === 1) return t('draw.onlyWish');
  if (draw.alike.length === draw.wishes - 1) return t('draw.allSame');
  return t('draw.drawnFrom', { n: draw.wishes });
}

function alikeLine(draw: DrawResult, room: RoomSnapshot): string {
  if (draw.wishes === 1 || draw.alike.length === draw.wishes - 1) return '';
  const chance = percent(draw.alike.length + 1, draw.wishes);
  return draw.alike.length
    ? t('draw.alike', { names: `<b>${nameList(draw.alike, room)}</b>`, pct: chance })
    : t('draw.alone', { pct: chance });
}

function stamps(draw: DrawResult): string {
  const rows: { label: string; value: string; on: boolean; locked: boolean }[] = [
    { label: t('lobby.destination'), value: packName(draw.flags.pack), on: true, locked: draw.locked.includes('pack') },
    ...VOTE_FLAGS.map((flag) => ({
      label: flagName(flag),
      value: draw.flags[flag] ? t('vote.on') : t('vote.off'),
      on: draw.flags[flag],
      locked: draw.locked.includes(flag),
    })),
  ];
  return rows.map((row, i) => `
    <div class="visa-slot" style="--d:${FIRST_STAMP_MS + i * STAMP_GAP_MS}ms" ${row.locked ? `title="${escapeHtml(t('vote.lockedByHost'))}"` : ''}>
      <small>${escapeHtml(row.label)}</small>
      <b class="stamp ${row.on ? 'stamp-red' : 'stamp-grey'}">${row.locked ? LOCK_ICON : ''}${escapeHtml(row.value)}</b>
    </div>`).join('');
}

function clearStampTimers(): void {
  for (const id of stampTimers) clearTimeout(id);
  stampTimers = [];
}

/** Shows the visa while the room loads with a drawn wish, the plain loader otherwise. */
export function renderDraw(room: RoomSnapshot): void {
  const visa = $('visa');
  if (visa.classList.contains('leaving')) return; // on its way out into the round
  const draw = room.phase === 'loading' ? room.draw : null;
  $('loader').hidden = !!draw;
  visa.hidden = !draw;
  if (!draw) {
    shownKey = null;
    clearStampTimers();
    return;
  }
  const key = JSON.stringify(draw);
  if (key === shownKey) return;
  shownKey = key;

  const winner = room.players.find((p) => p.id === draw.playerId);
  $('visa-code').textContent = room.code;
  $('visa-photo').innerHTML = photo(draw.name, winner?.color ?? draw.color, winner?.face ?? draw.face);
  $('visa-title').textContent = isMe(draw.playerId) ? t('draw.yourWish') : t('draw.wishOf', { name: draw.name });
  $('visa-sub').textContent = subline(draw);
  $('visa-stamps').innerHTML = stamps(draw);
  const also = alikeLine(draw, room);
  $('visa-also').innerHTML = also;
  $('visa-also').hidden = !also;
  replay(visa, 'turn-in');

  // One thud per stamp, in time with the animation.
  clearStampTimers();
  const count = VOTE_FLAGS.length + 1;
  for (let i = 0; i < count; i++) {
    const at = motionAllowed() ? FIRST_STAMP_MS + i * STAMP_GAP_MS + 120 : i * 60;
    stampTimers.push(window.setTimeout(() => sfx.play('stamp'), at));
  }
}

/** The page turns away before the round shows - or right away without a visa or motion. */
export function leaveDraw(then: () => void): void {
  const visa = $('visa');
  const finish = (): void => {
    visa.classList.remove('leaving', 'turn-in');
    visa.hidden = true;
    $('loader').hidden = false;
    shownKey = null;
    clearStampTimers();
    then();
  };
  if (visa.hidden || !motionAllowed() || !document.querySelector('#screen-loading.active')) {
    finish();
    return;
  }
  visa.classList.add('leaving');
  window.setTimeout(finish, LEAVE_MS);
}
