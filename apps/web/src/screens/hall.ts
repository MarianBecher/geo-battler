// The Hall of Fame and the personal stats. Both come over HTTP rather than
// the WebSocket so they are reachable from the home screen too.

import { MAX_POINTS, type HallView, type HttpError, type PlayerProfile, type TitleId } from '@geo-battler/shared';
import { $, escapeHtml } from '../dom.ts';
import { countryName, fmtDate, fmtNum, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { continentName, errorText, km, mrzPad, mrzText, titleName } from '../format.ts';
import { INKS, WorldMap, inkLabel } from '../maps/worldmap.ts';
import { photo } from '../photo.ts';

let profileMap: WorldMap | null = null;
let ownName: () => string = () => '';

export async function openHall(): Promise<void> {
  $('hall-overlay').hidden = false;
  showHallMain();
  $('hall-sub').textContent = t('hall.loading');
  $('hall-records').innerHTML = '';
  $('hall-table').innerHTML = '';
  try {
    const res = await fetch('/api/hall');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderHall((await res.json()) as HallView);
  } catch (err) {
    $('hall-sub').textContent = t('hall.unavailable');
    $('hall-records').innerHTML = `<p class="hall-empty">${escapeHtml((err as Error).message)}</p>`;
  }
}

export const closeHall = (): void => { $('hall-overlay').hidden = true; };

/** `unit` sits small after the value; `live` marks a record that is still being extended. */
function recordCard(label: string, value: string, who: string, where: string | null, opts: { unit?: string; live?: boolean } = {}): string {
  return `<div class="hall-record">
    <p class="label">${escapeHtml(label)}</p>
    <p class="value">${escapeHtml(value)}${opts.unit ? ` <small>${escapeHtml(opts.unit)}</small>` : ''}</p>
    <p class="who">${escapeHtml(who)}</p>
    ${where ? `<p class="where${opts.live ? ' live' : ''}">${escapeHtml(where)}</p>` : ''}
  </div>`;
}

type HallPlayer = HallView['players'][number];
const streakLive = (p: HallPlayer): boolean => p.streak > 0 && p.streak === p.bestStreak;

/** Column label, cell text, and an optional class on the cell. */
const COLUMNS: [MessageKey & `hall.${string}`, (p: HallPlayer) => string, ((p: HallPlayer) => string)?][] = [
  ['hall.games', (p) => String(p.games)],
  ['hall.wins', (p) => String(p.wins)],
  ['hall.streak', (p) => String(p.bestStreak), (p) => (streakLive(p) ? 'streak-live' : '')],
  ['hall.avgPerRound', (p) => fmtNum(Math.round(p.avgPoints))],
  ['hall.bestGame', (p) => fmtNum(p.bestGameScore)],
  ['hall.bestGuess', (p) => km(p.bestDistanceKm)],
  ['hall.perfects', (p) => String(p.perfects)],
];

/** "still running · since 12.09.26" or the span it covered; a single day is named once. */
function streakWhere(s: NonNullable<HallView['records']['bestStreak']>): string {
  if (s.live) return t('hall.streakLive', { date: fmtDate(s.from) });
  const from = fmtDate(s.from);
  const to = fmtDate(s.to);
  return from === to ? from : t('hall.streakSpan', { from, to });
}

function renderHall(data: HallView): void {
  $('hall-sub').textContent = data.games ? `${t('games', { n: data.games })} · ${t('rounds', { n: data.rounds })}` : t('hall.sub');

  const r = data.records;
  $('hall-records').innerHTML = [
    r.bestGuess && recordCard(t('hall.record.bestGuess'), km(r.bestGuess.distanceKm), r.bestGuess.name, r.bestGuess.place),
    r.bestGame && recordCard(t('hall.record.bestGame'), t('points', { n: fmtNum(r.bestGame.score) }), r.bestGame.name, t('hall.overRounds', { rounds: t('rounds', { n: r.bestGame.rounds }) })),
    r.bestStreak && recordCard(t('hall.record.bestStreak'), String(r.bestStreak.wins), r.bestStreak.name, streakWhere(r.bestStreak), { unit: t('hall.winsInARow', { n: r.bestStreak.wins }), live: r.bestStreak.live }),
  ].filter((x): x is string => typeof x === 'string').join('');

  if (!data.players.length) {
    $('hall-table').innerHTML = `<tbody><tr><td class="hall-empty">${t('hall.empty')}</td></tr></tbody>`;
    return;
  }
  const head = `<tr><th>${t('hall.player')}</th>${COLUMNS.map(([key]) => `<th>${escapeHtml(t(key))}</th>`).join('')}<th>${t('hall.favouriteTitle')}</th></tr>`;
  // The first three get their rank stamped, the rest sit quietly.
  const body = data.players.map((p, i) => `<tr>
    <th scope="row"><span class="rank-col">${i < 3 ? `<span class="stamp rank-stamp rank-${i + 1}">${i + 1}</span>` : i + 1}</span>${p.hasProfile
      ? `<button class="name-link" data-profile="${escapeHtml(p.name)}" title="${escapeHtml(t('hall.personalStats'))}">${escapeHtml(p.name)}</button>`
      : escapeHtml(p.name)}</th>
    ${COLUMNS.map(([, pick, cls]) => `<td${cls?.(p) ? ` class="${cls(p)}"` : ''}>${escapeHtml(pick(p))}</td>`).join('')}
    <td class="title-cell">${p.favouriteTitle ? escapeHtml(titleName(p.favouriteTitle as TitleId)) + (p.favouriteTitleCount > 1 ? ` (${p.favouriteTitleCount}×)` : '') : '-'}</td>
  </tr>`).join('');
  $('hall-table').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

// --- Personal stats ------------------------------------------------------------------

function showHallMain(): void {
  $('hall-main').hidden = false;
  $('hall-profile').hidden = true;
  $('hall-title').textContent = t('hall.title');
  $('btn-hall-back').hidden = true;
  $('btn-hall-me').hidden = !ownName();
}

async function openProfile(name: string): Promise<void> {
  $('hall-overlay').hidden = false;
  $('hall-main').hidden = true;
  $('hall-profile').hidden = false;
  $('btn-hall-back').hidden = false;
  $('btn-hall-me').hidden = true;
  $('hall-title').textContent = name;
  $('hall-sub').textContent = `${t('hall.personalStats')} · ${t('hall.loading')}`;
  $('profile-tiles').innerHTML = '';
  try {
    const res = await fetch(`/api/hall/player/${encodeURIComponent(name)}`);
    const data = (await res.json().catch(() => null)) as PlayerProfile | HttpError | null;
    if (!res.ok || !data || 'error' in data) throw new Error(data && 'error' in data ? errorText({ code: data.error, params: {}, message: data.message }) : `HTTP ${res.status}`);
    renderProfile(data);
  } catch (err) {
    $('hall-sub').textContent = t('hall.personalStats');
    $('profile-tiles').innerHTML = `<p class="hall-empty">${escapeHtml((err as Error).message)}</p>`;
    for (const id of ['profile-continents', 'profile-best', 'profile-worst', 'profile-form', 'profile-legend', 'profile-map']) $(id).innerHTML = '';
    $('profile-note').textContent = '';
    $('profile-pick').textContent = '';
  }
}

function renderProfile(data: PlayerProfile): void {
  $('hall-title').textContent = data.name;
  $('hall-sub').textContent = `${t('hall.title')} · ${t('hall.personalStats')}`;

  // The header as the passport's data page, with the balance as a machine-readable zone.
  const field = (key: 'games' | 'wins' | 'rounds' | 'avgPoints' | 'medianKm' | 'perfects', value: string): string =>
    `<div class="dp-field"><span class="dp-label">${t(`profile.field.${key}`)} <em>/ ${t(`profile.fieldAlt.${key}`)}</em></span><span class="dp-value">${value}</span></div>`;
  const count = (n: number, w: number): string => String(n).padStart(w, '0');
  const mrz = `${mrzPad(`P<GEO<${mrzText(data.name)}`)}\n${mrzPad(`${count(data.games, 3)}${mrzText(t('mrz.games'))}<${count(data.wins, 3)}${mrzText(t('mrz.wins'))}<${count(data.rounds, 4)}${mrzText(t('mrz.rounds'))}`)}`;
  $('profile-tiles').innerHTML = `
    <div class="dp-id">
      <div class="dp-photo">${photo(data.name, '#dce5db', data.face)}</div>
      <div class="dp-fields">
        ${field('games', fmtNum(data.games))}
        ${field('wins', fmtNum(data.wins))}
        ${field('rounds', fmtNum(data.rounds))}
        ${field('avgPoints', data.avgPoints === null ? '–' : fmtNum(data.avgPoints))}
        ${field('medianKm', km(data.medianKm))}
        ${field('perfects', fmtNum(data.perfects))}
      </div>
    </div>
    <p class="mrz profile-mrz" aria-hidden="true">${escapeHtml(mrz)}</p>`;

  profileMap ??= new WorldMap($('profile-map'), $('profile-pick'));
  void profileMap.render(data.map);
  $('profile-map-sub').textContent = data.map.length ? t('profile.lastRounds', { n: data.map.length }) : '';
  $('profile-legend').innerHTML = INKS.map((i) => `<span><i class="wm-${i.cls}"></i>${inkLabel(i)}</span>`).join('') + `<span class="legend-note">${t('profile.legendNote')}</span>`;

  $('profile-continents').innerHTML = data.continents.map((c) => `
    <li>
      <span class="label">${escapeHtml(continentName(c.code))}</span>
      <span class="track"><span style="--share:${(c.avgPoints / MAX_POINTS).toFixed(3)}"></span></span>
      <span class="value">${fmtNum(c.avgPoints)}</span>
      <span class="meta">${t('rounds', { n: c.rounds })} · ${t('profile.hitRate', { percent: Math.round(c.hitRate * 100) })} · ${t('profile.typically', { distance: km(c.medianKm) })}</span>
    </li>`).join('') || `<li class="hall-empty">${t('profile.noRounds')}</li>`;

  // Strongest and weakest countries - with few, they share the list.
  const n = Math.min(5, Math.floor(data.countries.length / 2));
  const countryRow = (c: PlayerProfile['countries'][number]): string => `<li><img class="flag-img" src="/flags/${c.code.toLowerCase()}.svg" alt="" loading="lazy"><span class="label">${escapeHtml(countryName(c.code))}</span><span class="value">${fmtNum(c.avgPoints)}</span><span class="meta">${c.rounds}×</span></li>`;
  const tooFew = `<li class="empty">${t('profile.tooFewCountries')}</li>`;
  $('profile-best').innerHTML = n ? data.countries.slice(0, n).map(countryRow).join('') : tooFew;
  $('profile-worst').innerHTML = n ? data.countries.slice(-n).reverse().map(countryRow).join('') : tooFew;

  renderForm(data.form);
  $('profile-note').textContent = data.since ? t('profile.sinceNote', { date: fmtDate(data.since) }) : t('profile.noCoordsYet');
}

/** Form as columns, one per game. Drawn by hand: for 30 columns no chart library is worth it. */
function renderForm(form: PlayerProfile['form']): void {
  const box = $('profile-form');
  if (form.length < 2) {
    box.innerHTML = `<p class="hall-empty">${t('profile.formNeedsTwo')}</p>`;
    return;
  }
  const W = Math.max(280, Math.round(box.clientWidth || 640));
  const H = 150, left = 40, right = 6, top = 8, bottom = 8;
  const innerW = W - left - right, innerH = H - top - bottom;
  const base = top + innerH;
  const slot = innerW / form.length;
  const barW = Math.max(3, Math.min(26, slot - 2));
  // The axis reaches the next full thousand above the best game - with 5,000 as the ceiling, weak evenings would stay a flat line.
  const peak = Math.min(MAX_POINTS, Math.max(1000, Math.ceil(Math.max(...form.map((g) => g.avgPoints)) / 1000) * 1000));
  const y = (pts: number): number => base - (pts / peak) * innerH;

  const grid = [0, peak / 2, peak].map((v) => `
    <line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${fmtNum(v)}</text>`).join('');
  const bars = form.map((g, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const top0 = y(g.avgPoints);
    const r = Math.min(4, barW / 2, base - top0);
    const path = `M${x},${base} V${top0 + r} Q${x},${top0} ${x + r},${top0} H${x + barW - r} Q${x + barW},${top0} ${x + barW},${top0 + r} V${base} Z`;
    return `<path d="${path}" class="bar"/><rect x="${left + i * slot}" y="${top}" width="${slot}" height="${innerH}" class="hit" data-i="${i}"/>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t('profile.formAria', { n: form.length }))}">${grid}${bars}</svg><div class="form-tip" hidden></div>`;

  const tip = box.querySelector<HTMLElement>('.form-tip')!;
  const svg = box.querySelector('svg')!;
  svg.addEventListener('pointermove', (e) => {
    const hit = (e.target as Element).closest<SVGElement>('.hit');
    const g = hit ? form[Number(hit.dataset.i)] : undefined;
    if (!hit || !g) { tip.hidden = true; return; }
    tip.innerHTML = `<strong>Ø ${fmtNum(g.avgPoints)}</strong> ${fmtDate(g.at)} · ${t('rounds', { n: g.rounds })}${g.mode === 'duel' ? ` · ${t('mode.duel')}` : ''}`;
    tip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    tip.style.left = `${Math.min(boxRect.width - tip.offsetWidth, Math.max(0, hitRect.left - boxRect.left + hitRect.width / 2 - tip.offsetWidth / 2))}px`;
    for (const el of svg.querySelectorAll('.hit.on')) el.classList.remove('on');
    hit.classList.add('on');
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    for (const el of svg.querySelectorAll('.hit.on')) el.classList.remove('on');
  });
}

export function initHall(getOwnName: () => string): void {
  ownName = getOwnName;
  $('hall-table').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-profile]');
    if (btn?.dataset.profile) void openProfile(btn.dataset.profile);
  });
  $('btn-hall-me').addEventListener('click', () => { void openProfile(ownName()); });
  $('btn-hall-back').addEventListener('click', () => { void openHall(); });
  $('btn-hall').addEventListener('click', () => { void openHall(); });
  $('btn-hall-home').addEventListener('click', () => { void openHall(); });
  $('btn-hall-close').addEventListener('click', closeHall);
  $('hall-overlay').addEventListener('click', (e) => { if (e.target === $('hall-overlay')) closeHall(); });
}
