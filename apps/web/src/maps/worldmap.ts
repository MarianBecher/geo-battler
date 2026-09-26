// The printed world map of the personal profile.
//
// Not a Google map: in a small box with zoom buttons it looked like a
// foreign body in the passport, and "where were my targets" needs neither
// streets nor satellite. Instead an SVG in ink on paper - the countries one
// has guessed in, tinted by one's own average there, the targets as dots in
// the three stamp colours. A click on a dot shows the guess that went with it.
//
// The outlines (Natural Earth 1:110m) live in public/geo/world.json, see
// scripts/build-world.ts.

import type { ProfileRound } from '@geo-battler/shared';
import { countryName, fmtNum, t } from '../i18n/index.ts';
import { formatDistance } from './google.ts';
import { fetchWorld, naturalEarth, NE_HALF_WIDTH } from './projection.ts';

const W = 940;
const H = 410;
const SCALE = W / (2 * NE_HALF_WIDTH);
const OX = W / 2;
const OY = H / 2 + 12; // Antarctica is left out - Europe moves up to use the room

export type InkClass = 'good' | 'mid' | 'bad';
export interface Ink {
  min: number;
  cls: InkClass;
}

/** The three stamp colours - the same thresholds for dots and countries. */
export const INKS: readonly Ink[] = [
  { min: 2500, cls: 'good' },
  { min: 1000, cls: 'mid' },
  { min: 0, cls: 'bad' },
];

/** Legend text of an ink ("2,500 and up"). */
export function inkLabel(ink: Ink | InkClass): string {
  const cls = typeof ink === 'string' ? ink : ink.cls;
  return t(`worldmap.ink.${cls}`);
}

export const inkOf = (pts: number): InkClass => INKS.find((i) => pts >= i.min)?.cls ?? 'bad';

/** Longitude/latitude to SVG coordinates of the map. */
export function project(lng: number, lat: number): [x: number, y: number] {
  const [x, y] = naturalEarth(lng, lat);
  return [OX + x * SCALE, OY - y * SCALE];
}

const pt = (lng: number, lat: number): string => project(lng, lat).map((v) => v.toFixed(1)).join(',');

/** One ring in tenths of a degree. When it jumps across the date line, a new stroke begins. */
function ringPath(flat: readonly number[]): string {
  let d = '';
  let prev: number | null = null;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lng = flat[i]! / 10;
    const jump = prev !== null && Math.abs(lng - prev) > 180;
    d += `${!d || jump ? 'M' : 'L'}${pt(lng, flat[i + 1]! / 10)}`;
    prev = lng;
  }
  return `${d}Z`;
}

/** Parallels and meridians, dashed - the grid of the printed map. */
function graticule(): string {
  const lines: string[] = [];
  for (let lat = -60; lat <= 80; lat += 20) {
    const pts: string[] = [];
    for (let lng = -180; lng <= 180; lng += 5) pts.push(pt(lng, lat));
    lines.push(`M${pts.join('L')}`);
  }
  for (let lng = -180; lng <= 180; lng += 30) {
    const pts: string[] = [];
    for (let lat = -60; lat <= 84; lat += 4) pts.push(pt(lng, lat));
    lines.push(`M${pts.join('L')}`);
  }
  return `<path class="wm-grat" d="${lines.join('')}"/>`;
}

interface CountryPath {
  code: string;
  d: string;
}

let worldPromise: Promise<CountryPath[]> | null = null;
function loadWorld(): Promise<CountryPath[]> {
  worldPromise ??= fetchWorld()
    .then((w) => {
      // Big countries first, so enclaves like Lesotho lie on top.
      const size = (c: { r: number[][] }): number => c.r.reduce((s, ring) => s + ring.length, 0);
      return [...w.countries].sort((a, b) => size(b) - size(a))
        .map((c) => ({ code: c.c, d: c.r.map(ringPath).join('') }));
    })
    .catch((err: unknown) => {
      worldPromise = null; // try again next time
      throw err;
    });
  return worldPromise;
}

export class WorldMap {
  private rounds: ProfileRound[] = [];

  /**
   * @param el receives the SVG
   * @param caption shows the clicked round
   */
  constructor(private readonly el: HTMLElement, private readonly caption: HTMLElement) {
    el.addEventListener('click', (e) => {
      const dot = e.target instanceof Element ? e.target.closest<SVGElement>('[data-i]') : null;
      this.select(dot ? Number(dot.dataset.i) : null);
    });
  }

  async render(rounds: ProfileRound[]): Promise<void> {
    this.rounds = rounds;
    let countries: CountryPath[];
    try {
      countries = await loadWorld();
    } catch (err) {
      const p = document.createElement('p');
      p.className = 'hall-empty';
      p.textContent = t('worldmap.loadFailed', { error: err instanceof Error ? err.message : String(err) });
      this.el.replaceChildren(p);
      return;
    }

    // Per country: how often and with what average. The more often, the stronger.
    const stats = new Map<string, { n: number; sum: number }>();
    for (const r of rounds) {
      if (!r.cc) continue;
      const s = stats.get(r.cc) ?? { n: 0, sum: 0 };
      s.n++;
      s.sum += r.pts;
      stats.set(r.cc, s);
    }
    const land = countries.map(({ code, d }) => {
      const s = stats.get(code);
      if (!s) return `<path class="wm-land" d="${d}"/>`;
      const avg = s.sum / s.n;
      const alpha = (0.2 + 0.1 * Math.min(4, s.n)).toFixed(2);
      const title = escapeXml(t('worldmap.countryTitle', { n: s.n, points: fmtNum(Math.round(avg)) }));
      return `<path class="wm-land wm-${inkOf(avg)}" style="fill-opacity:${alpha}" d="${d}"><title>${title}</title></path>`;
    }).join('');

    // Strong rounds last, so on top - otherwise they vanish in the crowd.
    const order = rounds.map((_, i) => i).sort((a, b) => rounds[a]!.pts - rounds[b]!.pts);
    const dots = order.map((i) => {
      const r = rounds[i]!;
      const [x, y] = project(r.a[1], r.a[0]);
      const rad = (3.2 + r.pts / 1300).toFixed(1);
      return `<circle class="wm-dot wm-${inkOf(r.pts)}" data-i="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}"/>`;
    }).join('');

    const aria = escapeXml(t('worldmap.aria', { n: rounds.length }));
    this.el.innerHTML = `<svg class="wm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`
      + `<rect class="wm-sea" width="${W}" height="${H}"/>${graticule()}<g>${land}</g><g class="wm-focus"></g><g>${dots}</g></svg>`;
    this.select(null);
  }

  /** Highlight one round: a dashed line to the guess, the details below. */
  select(i: number | null): void {
    const focus = this.el.querySelector('.wm-focus');
    if (!focus) return;
    for (const d of this.el.querySelectorAll('.wm-dot.on')) d.classList.remove('on');
    const r = i === null ? undefined : this.rounds[i];
    if (!r) {
      focus.innerHTML = '';
      this.caption.textContent = t('worldmap.hint');
      return;
    }
    this.el.querySelector(`.wm-dot[data-i="${i}"]`)?.classList.add('on');
    const [x1, y1] = project(r.a[1], r.a[0]);
    if (r.g) {
      const [x2, y2] = project(r.g[1], r.g[0]);
      focus.innerHTML = `<path class="wm-line" d="M${x1},${y1}L${x2},${y2}"/><circle class="wm-guess" cx="${x2}" cy="${y2}" r="4.5"/>`;
    } else {
      focus.innerHTML = '';
    }
    const where = r.cc ? `${countryName(r.cc)} · ` : '';
    const miss = r.km === null ? t('worldmap.noGuess') : t('worldmap.off', { distance: formatDistance(r.km) });
    this.caption.textContent = `${where}${t('worldmap.caption', { points: fmtNum(r.pts), miss })}`;
  }
}

const escapeXml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
