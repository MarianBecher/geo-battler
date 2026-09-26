// The reveal: the map with all pins, the entry stamp with the place, and the
// result list whose points count up.

import { MAX_POINTS, type RevealMessage, type RoundResult, type TeamRoundResult } from '@geo-battler/shared';
import * as sfx from '../audio/sound.ts';
import { $, escapeHtml, motionAllowed, replay } from '../dom.ts';
import { fmtDate, fmtNum, t } from '../i18n/index.ts';
import { formatCoords, km, multiplierText, teamName, teamShort } from '../format.ts';
import { RevealMap } from '../maps/google.ts';
import { photo, teamPhoto } from '../photo.ts';
import { burst } from '../ui/confetti.ts';
import { isMe, me, state } from '../state.ts';
import { send } from '../socket.ts';
import { renderReadyUi } from './lobby.ts';

/** How long the points count up. */
const COUNT_UP_MS = 1400;

let revealMap: RevealMap | null = null;

export function showReveal(msg: RevealMessage, show: () => void): void {
  show();

  // The round state falls away here - the next round brings its own.
  state.guess = null;
  state.submittedPin = null;
  state.submitted = false;

  revealMap ??= new RevealMap($('reveal-map'));
  revealMap.refresh();
  revealMap.render(msg.actual, msg.results);

  state.reveal = msg;
  $<HTMLButtonElement>('btn-force-next').disabled = false;
  $('reveal-round').textContent = msg.totalRounds
    ? t('reveal.roundOf', { n: msg.round, total: msg.totalRounds })
    : `${msg.teams ? t('mode.teamDuel') : t('mode.duel')} · ${t('game.round', { n: msg.round })}${(msg.multiplier ?? 1) > 1 ? ` · ${t('game.damageFactor', { factor: multiplierText(msg.multiplier ?? 1) })}` : ''}`;
  showPlace(msg);
  startCountUp();
  renderReadyUi();
  renderRevealList();

  // Roll, stamp and then the country's anthem. The player's own perfect hit
  // gets its own fanfare - after the stamp, otherwise the two drown each
  // other out. Likewise the player's own knock-out; the anthem waits for it.
  const mine = msg.results.find((r) => isMe(r.playerId));
  sfx.arrive(msg.place?.countryCode, { knockedOut: !!mine?.knockedOut });
  if (mine && mine.points >= MAX_POINTS) setTimeout(() => sfx.play('perfect'), 420);
  else if (mine?.knockedOut) setTimeout(() => sfx.play('knockout'), COUNT_UP_MS);

  // Whoever is out guesses for fun only - confetti is for the race.
  celebrate(msg.results.filter((r) => r.contender), (r) => r.points, 1500);
}

/** Where was that? As an entry stamp: the place in large type, region, country and date below. */
function showPlace(msg: RevealMessage): void {
  const heading = $('reveal-place');
  const label = msg.place?.label;
  // The server delivers "place, region, country" - duplicates already removed.
  const [name = '', ...rest] = label ? label.split(', ') : [formatCoords(msg.actual)];

  heading.classList.toggle('unknown', !label);
  heading.textContent = name;
  // Long names shrink instead of running over the stamp's edge.
  heading.style.setProperty('--len', String(Math.max(8, name.length)));
  $('reveal-place-sub').textContent = [...rest, fmtDate(new Date())].join(' · ');

  // The flag sits faintly in the stamp, as if printed into the passport paper.
  const code = msg.place?.countryCode ?? '';
  const flag = $('reveal-flag');
  flag.hidden = !/^[A-Z]{2}$/i.test(code);
  if (!flag.hidden) flag.style.setProperty('--flag', `url(/flags/${code.toLowerCase()}.svg)`);

  replay($('entry-stamp'), 'press');

  const link = $<HTMLAnchorElement>('reveal-place-link');
  link.hidden = false;
  link.href = `https://www.google.com/maps/search/?api=1&query=${msg.actual.lat},${msg.actual.lng}`;
}

// --- Counting up the points ---------------------------------------------------------
//
// The list is also redrawn on every room change ("ready"), so the animation
// must not depend on that. The list computes the progress from the clock
// every time - a redraw in the middle always hits the right intermediate value.

function startCountUp(): void {
  state.revealT0 = performance.now();
  state.revealAnim = motionAllowed() ? { start: state.revealT0 } : null;
  if (state.revealAnim) requestAnimationFrame(stepCountUp);
}

function stepCountUp(): void {
  if (!state.revealAnim || !state.reveal) return;
  const done = countUpProgress() >= 1;
  renderRevealList();
  if (done) state.revealAnim = null;
  else requestAnimationFrame(stepCountUp);
}

/** 0 to 1, slowed at the end - otherwise the stop feels like a cut. */
function countUpProgress(): number {
  if (!state.revealAnim) return 1;
  const raw = Math.min(1, (performance.now() - state.revealAnim.start) / COUNT_UP_MS);
  return 1 - (1 - raw) ** 3;
}

/** Stamps never sit perfectly straight - a fixed alternation that stays stable on redraws. */
export const stampTilt = (i: number): string => `${[3, -2.5, 2, -3.5][i % 4]}deg`;

const share = (v: number, max: number | null): string => Math.max(0, Math.min(1, v / (max ?? 1))).toFixed(3);

/** The result list also shows who is ready - so it is redrawn on every room change. */
export function renderRevealList(): void {
  const msg = state.reveal;
  if (!msg) return;

  const p = countUpProgress();
  const readySet = new Set((state.room?.players ?? []).filter((x) => x.ready).map((x) => x.id));
  const duel = msg.mode === 'duel';
  const teamRows = msg.teams ? msg.teams.map((tm, i) => teamRevealRow(tm, msg.maxHp, p, i)).join('') : '';
  // The best points of the round get the red stamp, the rest grey.
  const best = Math.max(0, ...msg.results.map((r) => r.points));
  const meLabel = escapeHtml(t('role.you'));

  $('reveal-results').innerHTML = teamRows + msg.results.map((r, i) => {
    const points = Math.round(r.points * p);
    const readyTag = readySet.has(r.playerId) ? `<span class="mini-tag ready">${t('ready')}</span>` : '';
    const dist = r.guess ? t('reveal.away', { distance: km(r.distanceKm) }) : t('reveal.noGuess');
    const tilt = `--tilt:${stampTilt(i + (msg.teams?.length ?? 0))}`;
    // Rows glide in staggered, the stamp lands when the points have finished counting.
    const since = performance.now() - state.revealT0;
    const timing = `--in:${Math.round(i * 90 - since)}ms;--land:${Math.round(COUNT_UP_MS + i * 90 - since)}ms`;
    const ink = best > 0 && r.points === best ? 'stamp-red' : 'stamp-grey';
    const nameEl = `<span class="name" data-me-label="${meLabel}">${escapeHtml(r.name)}</span>`;
    const rowClass = `${r.guess ? '' : 'miss'} ${isMe(r.playerId) ? 'me' : ''} ${r.contender ? '' : 'out'}`;

    if (msg.teams) {
      const team = msg.teams.find((x) => x.id === r.team);
      return `
      <li class="teammate ${rowClass}" style="--team:${team?.color ?? 'transparent'}">
        ${photo(r.name, r.color, r.face)}
        <span>
          ${nameEl}${readyTag}
          <span class="dist">${dist} · ${r.contender && team ? `<span class="team-dot"></span>${escapeHtml(teamName(team.id))}` : t('reveal.outOfContention')}</span>
        </span>
        <span class="pts"><span class="stamp ${ink}" style="${tilt}">${fmtNum(points)}</span></span>
      </li>`;
    }

    if (duel) return duelRow(r, msg, p, rowClass, nameEl, readyTag, dist, tilt);

    // The total grows out of the state *before* this round.
    const total = Math.round(r.total - r.points + r.points * p);
    return `
    <li class="${rowClass}" style="${timing}">
      ${photo(r.name, r.color, r.face)}
      <span>
        ${nameEl}${readyTag}
        <span class="dist"><span class="nowrap">${dist}</span> · <span class="nowrap">${t('reveal.total', { points: fmtNum(total) })}</span></span>
      </span>
      <span class="pts"><span class="stamp ${ink}" style="${tilt}">${fmtNum(points)}</span></span>
    </li>`;
  }).join('');
}

function duelRow(r: RoundResult, msg: RevealMessage, p: number, rowClass: string, nameEl: string, readyTag: string, dist: string, tilt: string): string {
  // The HP shrink at the same pace the points count up - the bar shows what is left, the number the loss.
  const damage = Math.round((r.damage ?? 0) * p);
  const hpBefore = r.hpBefore ?? 0;
  const hp = r.contender ? Math.max(0, hpBefore - damage) : 0;
  const ko = !!r.knockedOut && p >= 1;
  const tag = !r.contender ? `<span class="mini-tag out">${t('hp.out')}</span>` : ko ? `<span class="mini-tag ko">${t('hp.ko')}</span>` : '';
  const bar = r.contender
    ? `<span class="hp hp-reveal" style="--hp:${share(hp, msg.maxHp)};--hp-before:${share(hpBefore, msg.maxHp)};--hp-color:${r.color}"><span class="lost"></span><span class="left"></span></span>`
    : '';
  const points = Math.round(r.points * p);
  return `
  <li class="duel ${rowClass} ${ko ? 'ko' : ''}">
    ${photo(r.name, r.color, r.face)}
    <span>
      ${nameEl}${tag}${readyTag}
      <span class="dist">${dist} · ${t('reveal.pts', { points: fmtNum(points) })}</span>
      ${bar}
    </span>
    <span class="pts">${!r.contender ? '<span class="pts-none">–</span>'
      : `<span class="stamp ${damage ? 'stamp-red' : 'stamp-ok'}" style="${tilt}">${damage ? `−${fmtNum(damage)}` : '±0'}</span>`}<small>${r.contender ? t('hp.count', { n: fmtNum(hp) }) : t('reveal.outOfContention')}</small></span>
  </li>`;
}

/** A team row of the reveal: average points, damage and the shared HP bar. */
function teamRevealRow(tm: TeamRoundResult, maxHp: number | null, p: number, i: number): string {
  const damage = Math.round(tm.damage * p);
  const hp = tm.contender ? Math.max(0, tm.hpBefore - damage) : 0;
  const ko = tm.knockedOut && p >= 1;
  const tag = !tm.contender ? `<span class="mini-tag out">${t('hp.out')}</span>` : ko ? `<span class="mini-tag ko">${t('hp.ko')}</span>` : '';
  const mine = me()?.team === tm.id;
  return `
  <li class="duel team-row ${tm.contender ? '' : 'out'} ${ko ? 'ko' : ''} ${mine ? 'mine' : ''}" style="--team:${tm.color}">
    ${teamPhoto(teamShort(tm.id), tm.color)}
    <span>
      <span class="name" data-team-label="${escapeHtml(t('team.yours'))}">${escapeHtml(teamName(tm.id))}</span>${tag}
      <span class="dist">${tm.contender ? t('reveal.avgPts', { points: fmtNum(Math.round((tm.avg ?? 0) * p)) }) : t('reveal.outSinceRound', { n: tm.outRound ?? 0 })}</span>
      ${tm.contender ? `<span class="hp hp-reveal" style="--hp:${share(hp, maxHp)};--hp-before:${share(tm.hpBefore, maxHp)};--hp-color:${tm.color}"><span class="lost"></span><span class="left"></span></span>` : ''}
    </span>
    <span class="pts">${!tm.contender ? '<span class="pts-none">–</span>'
      : `<span class="stamp ${damage ? 'stamp-red' : 'stamp-ok'}" style="--tilt:${stampTilt(i)}">${damage ? `−${fmtNum(damage)}` : '±0'}</span>`}<small>${tm.contender ? t('hp.count', { n: fmtNum(hp) }) : ''}</small></span>
  </li>`;
}

/** Confetti - but only on the winner's screen. */
export function celebrate<T extends { playerId: string; color: string }>(candidates: T[], score: (c: T) => number, durationMs: number): void {
  const best = Math.max(0, ...candidates.map(score));
  if (best <= 0) return;
  const mine = candidates.find((c) => score(c) === best && isMe(c.playerId));
  if (!mine) return; // someone else won - it stays quiet here
  burst({ colors: [mine.color, '#e24b4b', '#e8efe7'], durationMs });
}

export function initReveal(toggleReady: () => void): void {
  $('btn-next').addEventListener('click', toggleReady);
  $('btn-force-next').addEventListener('click', () => {
    $<HTMLButtonElement>('btn-force-next').disabled = true;
    send({ t: 'next' }); // the host overtakes the ready round
  });
}
