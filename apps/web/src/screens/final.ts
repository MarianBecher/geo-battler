// The final standings: the podium with titles, the world map of all rounds,
// Street View per round and the statistics table.

import { TEAMS, type AwardedTitle, type FinalMessage, type LeaderboardEntry, type MetricRow, type TeamStanding, type TitleGroup } from '@geo-battler/shared';
import * as sfx from '../audio/sound.ts';
import { $, escapeHtml, motionAllowed, replay } from '../dom.ts';
import { fmtNum, t } from '../i18n/index.ts';
import { factText, metricText, teamName, titleExplain, titleName } from '../format.ts';
import { FinalMap, PanoView } from '../maps/google.ts';
import { photo } from '../photo.ts';
import { activeScreen, isHost, isMe, me, state } from '../state.ts';
import { send } from '../socket.ts';
import { hpBar } from './game.ts';
import { celebrate } from './reveal.ts';

let finalMap: FinalMap | null = null;
let finalPano: PanoView | null = null;
let finalMetrics: MetricRow[] = [];
let finalCheer: ReturnType<typeof setTimeout> | null = null;

// Title stamps: every group of the title catalogue has its own stamp style -
// frame and ink come from the CSS (.ts-<group>), symbol and group line from
// here. Line symbols, so they look stamped.
const TITLE_ICONS: Record<TitleGroup, string | null> = {
  accuracy: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  form: '<path d="M2 17l5-6 4 4 5-8 6 6"/>',
  geography: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  map: '<path d="M12 22s7-7.2 7-12a7 7 0 0 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  timing: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  streetview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  note: null,
};

/** Slightly askew, but always the same for the same title - never straight. */
function titleTilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const deg = (h % 9) - 4;
  return deg === 0 ? 2 : deg;
}

function titleStamp(badge: AwardedTitle): string {
  const icon = TITLE_ICONS[badge.group];
  const name = titleName(badge.id);
  // --len as with the entry stamp: long titles shrink instead of breaking.
  return `<span class="stamp title-stamp ts-${badge.group}" style="--tilt:${titleTilt(badge.id)}deg;--len:${Array.from(name).length}">
    ${icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` : ''}
    <span class="ts-text"><span class="ts-label">${t(`titleGroup.${badge.group}`)}</span><span class="ts-name">${escapeHtml(name)}</span></span>
  </span>`;
}

const standingOf = (duel: boolean) => (p: LeaderboardEntry): number => (duel ? p.hp ?? 0 : p.score);

export function showFinal(msg: FinalMessage, show: () => void): void {
  show();
  state.revealAnim = null;
  state.finalRounds = msg.rounds;
  state.roundFilter = null;
  renderRoundFilter();
  updateStreetTools();

  finalMap ??= new FinalMap($('final-map'));
  finalMap.refresh();
  finalMap.render(state.finalRounds, state.roundFilter);

  const duel = msg.mode === 'duel';
  const roundsLabel = t('rounds', { n: msg.totalRounds });
  const teams = msg.teams;
  $('final-sub').textContent = duel
    ? t('final.decidedAfter', { mode: teams ? t('mode.teamDuel') : t('mode.duel'), rounds: roundsLabel })
    : t('final.roundsPlayed', { rounds: roundsLabel });
  $('final-title').textContent = teams && !((teams[0]?.hp ?? 0) > 0) ? t('final.draw') : t('final.title');
  renderWinner(msg, duel, teams);
  renderFinalTeams(teams, msg.maxHp);

  const standing = (p: LeaderboardEntry): string => (!duel ? `<span data-count="${p.score}">${fmtNum(p.score)}</span>`
    : (p.hp ?? 0) > 0 ? `${fmtNum(p.hp ?? 0)}<small>${t('hp.unit')}</small>`
      : `<small>${t('final.outIn')}</small>${t('game.round', { n: p.outRound ?? 0 })}`);

  // Award ceremony: the places come from the back to the front, the winner stamp last - and only with it confetti and fanfare.
  const n = msg.leaderboard.length;
  const step = motionAllowed() ? Math.min(420, 2000 / Math.max(1, n)) : 0;
  const rowDelay = (i: number): number => Math.round((n - 1 - i) * step);
  const winDelay = motionAllowed() ? rowDelay(0) + 650 : 0;
  $('final-winner').style.setProperty('--d', `${winDelay}ms`);
  const meLabel = escapeHtml(t('role.you'));

  $('final-board').innerHTML = msg.leaderboard.map((p, i) => {
    const badge = msg.titles[p.playerId];
    const out = duel && !((p.hp ?? 0) > 0);
    const team = p.team ? TEAMS.find((x) => x.id === p.team) ?? null : null;
    return `
    <li class="${i === 0 ? 'first' : ''} ${isMe(p.playerId) ? 'me' : ''} ${out ? 'out' : ''}" style="--d:${rowDelay(i)}ms" data-delay="${rowDelay(i)}">
      <span class="rank">${i + 1}</span>
      ${photo(p.name, p.color, p.face)}
      <div class="who">
        <span class="name" data-me-label="${meLabel}">${escapeHtml(p.name)}${team ? ` <span class="team-tag" style="--team:${team.color}">${escapeHtml(teamName(team.id))}</span>` : ''}</span>
        ${duel && !teams ? hpBar(p.hp, msg.maxHp, p.color) : ''}
        ${badge ? `
          ${titleStamp(badge)}
          <span class="title-why">${escapeHtml(titleExplain(badge.id))}</span>
          ${badge.facts.length ? `<span class="title-facts">${badge.facts.map((f) => escapeHtml(factText(f))).join(' &middot; ')}</span>` : ''}
        ` : ''}
      </div>
      <span class="pts ${out ? 'out' : ''}">${standing(p)}</span>
    </li>`;
  }).join('');

  finalMetrics = msg.metrics;
  renderStatsTable(msg.leaderboard);
  $('btn-stats').hidden = !finalMetrics.length;
  closeStats();
  countUpPodium();

  const pick = standingOf(duel);
  const best = Math.max(0, ...msg.leaderboard.map(pick));
  const won = best > 0 && msg.leaderboard.some((p) => isMe(p.playerId) && pick(p) === best);
  if (finalCheer) clearTimeout(finalCheer);
  finalCheer = setTimeout(() => {
    if (activeScreen() !== 'screen-final') return;
    celebrate(msg.leaderboard, pick, 3200);
    sfx.play(won ? 'fanfare' : 'finish');
    // The stamp lands - the page jolts once with it.
    const side = document.querySelector<HTMLElement>('.final-side');
    if (side && motionAllowed()) replay(side, 'thud');
  }, winDelay);

  // The final screen starts without music so the fanfare stands alone. After that it may return.
  setTimeout(() => {
    if (activeScreen() === 'screen-final') sfx.setMood('lobby');
  }, winDelay + 4200);

  $<HTMLButtonElement>('btn-again').disabled = !isHost();
  $('again-hint').hidden = isHost();
}

/** The points on the final screen count up as soon as their row comes in. */
function countUpPodium(): void {
  if (!motionAllowed()) return;
  const t0 = performance.now();
  const DURATION = 900;
  const targets = [...$('final-board').querySelectorAll<HTMLElement>('li[data-delay]')]
    .flatMap((li) => {
      const el = li.querySelector<HTMLElement>('[data-count]');
      return el ? [{ el, delay: Number(li.dataset.delay), total: Number(el.dataset.count) }] : [];
    });
  for (const x of targets) x.el.textContent = '0';
  const tick = (): void => {
    if (activeScreen() !== 'screen-final') return;
    let running = false;
    for (const x of targets) {
      const raw = Math.min(1, Math.max(0, (performance.now() - t0 - x.delay) / DURATION));
      if (raw < 1) running = true;
      x.el.textContent = fmtNum(Math.round(x.total * (1 - (1 - raw) ** 3)));
    }
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The winner as a stamp above the standings. On a tie everyone with the same score is in it. */
function renderWinner(msg: FinalMessage, duel: boolean, teams: TeamStanding[] | null): void {
  const box = $('final-winner');
  let label: string | null = null;
  let name = '';
  if (teams) {
    const first = teams[0];
    if (first && first.hp > 0) [label, name] = [t('final.win'), teamName(first.id)];
  } else {
    const pick = standingOf(duel);
    const best = Math.max(0, ...msg.leaderboard.map(pick));
    const top = best > 0 ? msg.leaderboard.filter((p) => pick(p) === best) : [];
    if (top.length) {
      label = top.length > 1 ? t('final.tie') : duel ? t('final.lastStanding') : t('final.win');
      name = top.map((p) => p.name).join(' & ');
    }
  }
  box.hidden = !label;
  if (!label) return;
  $('final-winner-label').textContent = label;
  $('final-winner-name').textContent = name;
  replay(box, 'press');
}

/** Team duel: the two teams above the individual standings. */
function renderFinalTeams(teams: TeamStanding[] | null, maxHp: number | null): void {
  const box = $('final-teams');
  box.hidden = !teams;
  if (!teams) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = teams.map((tm, i) => `
    <li class="${i === 0 && tm.hp > 0 ? 'first' : ''} ${tm.hp > 0 ? '' : 'out'} ${me()?.team === tm.id ? 'mine' : ''}" style="--team:${tm.color}">
      <div class="who">
        <span class="name">${escapeHtml(teamName(tm.id))}</span>
        ${hpBar(tm.hp, maxHp, tm.color)}
        <span class="title-why">${t('final.avgPointsPerRound', { points: fmtNum(tm.avgPoints) })}</span>
      </div>
      <span class="pts">${tm.hp > 0 ? `${fmtNum(tm.hp)}<small>${t('hp.unit')}</small>` : `<small>${t('final.outIn')}</small>${t('game.round', { n: tm.outRound ?? 0 })}`}</span>
    </li>`).join('');
}

// --- Statistics table -----------------------------------------------------------

function renderStatsTable(leaderboard: LeaderboardEntry[]): void {
  if (!finalMetrics.length) return;
  const head = `<tr><th>${t('stats.metric')}</th>${leaderboard.map((p) => `<th><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</th>`).join('')}</tr>`;
  const body = finalMetrics.map((row) => {
    const cells = new Map(row.values.map((v) => [v.playerId, v]));
    return `<tr>
      <th scope="row">${escapeHtml(t(`metric.${row.key}`))}</th>
      ${leaderboard.map((p) => {
        const cell = cells.get(p.playerId);
        return `<td class="${cell?.best ? 'best' : ''}">${escapeHtml(metricText(row.unit, cell?.value ?? null))}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
  $('stats-table').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

export const openStats = (): void => { $('stats-overlay').hidden = false; };
export const closeStats = (): void => { $('stats-overlay').hidden = true; };

// --- Rounds on the map and Street View per round -----------------------------------
// In the game the panorama is large and the map small - here it is the other
// way round: the map stays large, the panorama hangs next to it as a picture
// in picture. The swap button flips the ratio.

function renderRoundFilter(): void {
  const rounds = state.finalRounds;
  const box = $('round-filter');
  if (rounds.length < 2) {
    box.innerHTML = '';
    return;
  }
  const chip = (value: string, label: string): string => `<button data-round="${value}" class="${String(state.roundFilter ?? '') === value ? 'on' : ''}">${label}</button>`;
  box.innerHTML = [chip('', t('final.allRounds')), ...rounds.map((r) => chip(String(r.round), String(r.round)))].join('');
}

/** The round the map shows on its own right now - otherwise null. */
function selectedRound() {
  if (state.roundFilter === null) return state.finalRounds.length === 1 ? state.finalRounds[0] ?? null : null;
  return state.finalRounds.find((r) => r.round === state.roundFilter) ?? null;
}

/** Only classes and the panorama - the caller redraws the map. */
function applyStreetLayout(on: boolean): void {
  const stage = $('final-stage');
  stage.classList.toggle('with-street', on);
  if (!on) stage.classList.remove('street-big');
  const btn = $('btn-street');
  btn.classList.toggle('on', on);
  btn.textContent = on ? t('final.hideStreetView') : t('final.showStreetView');

  const round = selectedRound();
  if (!on || !round) return;
  finalPano ??= new PanoView($('final-pano'));
  // Without restrictions: the game is over, now everyone may look.
  finalPano.show(round.panoId);
  finalPano.refresh();
}

function redrawFinalMap(): void {
  finalMap?.refresh();
  finalMap?.render(state.finalRounds, state.roundFilter);
}

function updateStreetTools(): void {
  const round = selectedRound();
  // Across all rounds there is no single panorama.
  $('btn-street').hidden = !round;
  applyStreetLayout(!!round && $('final-stage').classList.contains('with-street'));
  // The place name belongs to the single round - across all there is none.
  const place = $('final-place');
  place.hidden = !round?.place?.label;
  if (round?.place?.label) place.textContent = round.place.label;
}

export function initFinal(): void {
  $('btn-stats').addEventListener('click', openStats);
  $('btn-stats-close').addEventListener('click', closeStats);
  $('stats-overlay').addEventListener('click', (e) => { if (e.target === $('stats-overlay')) closeStats(); });

  $('round-filter').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!btn) return;
    state.roundFilter = btn.dataset.round ? Number(btn.dataset.round) : null;
    renderRoundFilter();
    updateStreetTools(); // layout first, then the map - the viewport depends on its size
    finalMap?.render(state.finalRounds, state.roundFilter);
  });

  $('btn-street').addEventListener('click', () => {
    applyStreetLayout(!$('final-stage').classList.contains('with-street'));
    redrawFinalMap();
  });

  $('btn-pip-swap').addEventListener('click', () => {
    $('final-stage').classList.toggle('street-big');
    finalPano?.refresh();
    redrawFinalMap();
  });

  $('btn-again').addEventListener('click', () => {
    $<HTMLButtonElement>('btn-again').disabled = true;
    send({ t: 'lobby' });
  });
}
