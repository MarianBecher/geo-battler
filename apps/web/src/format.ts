// Formatting for prose: numbers, distances, facts and metrics - everything
// the server sends raw and the player reads in their language.

import type { Fact, MetricUnit, ContinentCode, GameErrorPayload, PackId, TeamId, TitleId, VoteFlag } from '@geo-battler/shared';
import { fmtNum, t, type MessageKey } from './i18n/index.ts';
import { formatDistance } from './maps/google.ts';

export const km = formatDistance;
export const secText = (ms: number | null): string => (ms === null ? '-' : `${fmtNum(ms / 1000, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`);
export const ptsText = (v: number): string => fmtNum(Math.round(v));
export const decText = (v: number, digits = 1): string => fmtNum(v, { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const degText = (v: number): string => `${decText(v)}°`;
export const multiplierText = (m: number): string => `×${fmtNum(m)}`;

export const packName = (id: PackId): string => t(`pack.${id}.name`);
export const packHint = (id: PackId): string => t(`pack.${id}.hint`);
/** The restrictions go by their GeoGuessr names in every language. */
export const flagName = (flag: VoteFlag): string => ({ noMove: 'No Move', noPan: 'No Pan', noZoom: 'No Zoom' })[flag];
export const teamName = (id: TeamId): string => t(`team.${id}`);
export const teamShort = (id: TeamId): string => t(`team.${id}.short`);
export const continentName = (code: ContinentCode): string => t(`continent.${code}`);
export const titleName = (id: TitleId): string => t(`title.${id}.name`);
export const titleExplain = (id: TitleId): string => t(`title.${id}.explain`);

export function fmtTime(seconds: number): string {
  if (!seconds) return '∞';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/** Translates a server error - the code wins, the English text is the fallback. */
export function errorText(err: GameErrorPayload | null | undefined): string {
  if (!err) return '';
  if (!err.code) return err.message;
  const params: Record<string, string | number | undefined> = { ...err.params };
  if (err.params.team) params.team = t(`team.${err.params.team as TeamId}`);
  return t(`err.${err.code}`, params);
}

/**
 * A fact under a title: the server sends the key and raw numbers, the
 * template and formatting live here. Parameter names carry their unit.
 */
export function factText(fact: Fact): string {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fact)) {
    if (key === 'key') continue;
    const n = typeof value === 'number' ? value : 0;
    switch (key) {
      case 'km': params[key] = km(n); break;
      case 'ms': params[key] = secText(n); break;
      case 'points': case 'from': case 'to': params[key] = ptsText(n); break;
      case 'deg': params[key] = degText(n); break;
      case 'level': params[key] = decText(n); break;
      case 'continent': params[key] = continentName(value as ContinentCode); break;
      case 'n': params[key] = Number.isInteger(n) ? fmtNum(n) : decText(n); break;
      default: params[key] = typeof value === 'number' ? fmtNum(value) : String(value);
    }
  }
  return t(`fact.${fact.key}` as MessageKey, params);
}

/** A cell of the statistics table - formatted by the unit the server names. */
export function metricText(unit: MetricUnit, value: number | null): string {
  if (value === null) return '-';
  switch (unit) {
    case 'points': return ptsText(value);
    case 'spread': return `±${ptsText(value)}`;
    case 'km': return km(value);
    case 'seconds': return secText(value);
    case 'decimal': return decText(value);
    case 'integer': return fmtNum(Math.round(value));
    case 'degreesInt': return `${Math.round(value)}°`;
    case 'biasLat': return `${degText(Math.abs(value))} ${value >= 0 ? t('compass.N') : t('compass.S')}`;
    case 'biasLng': return `${degText(Math.abs(value))} ${value >= 0 ? t('compass.E') : t('compass.W')}`;
    case 'count': return String(value);
  }
}

export function formatCoords({ lat, lng }: { lat: number; lng: number }): string {
  const one = (value: number, pos: string, neg: string): string => `${decText(Math.abs(value))}° ${value >= 0 ? pos : neg}`;
  return `${one(lat, t('compass.N'), t('compass.S'))}, ${one(lng, t('compass.E'), t('compass.W'))}`;
}

// --- Machine-readable zone ---------------------------------------------------
//
// Like the two lines at the bottom of a passport page: 44 characters, only
// A-Z, 0-9 and "<" as filler. Umlauts are rewritten as in a real passport.

export const MRZ_WIDTH = 44;

export function mrzText(str: string): string {
  return str
    .replace(/[äÄ]/g, 'AE').replace(/[öÖ]/g, 'OE').replace(/[üÜ]/g, 'UE').replace(/ß/g, 'SS')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '<');
}

export const mrzPad = (str: string, width = MRZ_WIDTH): string => str.slice(0, width).padEnd(width, '<');
