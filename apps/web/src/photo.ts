// Passport photos: a pencil-drawn face on the player's colour, glued in
// slightly askew with a strip of tape. The face is a 32-bit seed that
// travels over the network; every browser draws the same picture from it.

import { faceFromSeed, pencilDefs, renderFace } from 'pencil-faces';
import { escapeHtml, inkOn, storage } from './dom.ts';

const FACE_KEY = 'geo-battle-face';
const FILTER_ID = 'face-pencil';

/** FNV-1a: the seed from the name, as long as nobody rolled. */
export function faceFromName(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const randomFace = (): number => (Math.random() * 2 ** 32) >>> 0;

/** The player's own face: rolled and stored, otherwise from the name. */
export function myFace(name: string): number {
  const saved = storage.get(FACE_KEY);
  if (saved !== null && /^\d+$/.test(saved)) return Number(saved);
  return faceFromName(name);
}

export const rememberFace = (face: number): void => storage.set(FACE_KEY, String(face));

/** The pencil filter lives once in the document; every face refers to it. */
export function ensureFaceDefs(): void {
  if (document.getElementById(FILTER_ID)) return;
  const holder = document.createElement('div');
  holder.innerHTML = pencilDefs(FILTER_ID);
  const svg = holder.firstElementChild;
  if (svg) document.body.appendChild(svg);
}

/**
 * Glued in, not printed: every photo sits a little askew, the tape sometimes
 * on top, sometimes over the corners. Both follow from the seed, so nothing
 * jumps on a redraw.
 */
function pasteIn(seed: number, color: string): string {
  const rot = (((seed >>> 3) & 7) - 3.5) * 0.7;
  const tapeRot = (((seed >>> 9) & 7) - 3.5) * 2.2;
  return `style="--c:${color};color:${inkOn(color)};--rot:${rot.toFixed(1)}deg;--tape-rot:${tapeRot.toFixed(1)}deg"`;
}

function tapeFor(seed: number): string {
  switch ((seed >>> 6) & 3) {
    case 0: return '<i class="tape top"></i>';
    case 1: return '<i class="tape tl"></i>';
    case 2: return '<i class="tape tr"></i>';
    default: return '<i class="tape tl"></i><i class="tape br"></i>';
  }
}

const svgCache = new Map<number, string>();

function faceSvg(seed: number): string {
  let svg = svgCache.get(seed);
  if (!svg) {
    svg = renderFace(faceFromSeed(seed), { filterId: FILTER_ID, className: 'face' });
    if (svgCache.size > 200) svgCache.clear();
    svgCache.set(seed, svg);
  }
  return svg;
}

/** A player's photo. Without a seed (old entries) the face comes from the name. */
export function photo(name: string, color: string, face: number | null): string {
  const seed = face ?? faceFromName(name);
  return `<span class="photo" ${pasteIn(seed, color)} aria-hidden="true">${faceSvg(seed)}${tapeFor(seed)}</span>`;
}

/** Teams have no face - their badge carries the initial. */
export function teamPhoto(name: string, color: string): string {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  const seed = faceFromName(name);
  return `<span class="photo initial" ${pasteIn(seed, color)} aria-hidden="true">${escapeHtml(initial)}${tapeFor(seed)}</span>`;
}
