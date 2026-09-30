// Emoji drawn in the passport's own ink: `:shrug:` in a chat message stays
// `:shrug:` on the wire and turns into a little line drawing when shown,
// the same 24-grid strokes the title stamps use. No colour font, no system
// glyphs - every traveller sees the same picture. While typing, `suggest`
// feeds the slip under the input.

export interface Emoji {
  code: string;
  /** SVG inner markup on a 24 x 24 grid, stroked in currentColor. */
  glyph: string;
}

const dot = (cx: number, cy: number, r = 1): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
const face = (inner: string): string => `<circle cx="12" cy="12" r="9"/>${inner}`;
const eyes = dot(9, 10) + dot(15, 10);
const smile = '<path d="M8.5 14.5q3.5 3 7 0"/>';

const GLYPHS: Record<string, string> = {
  // --- Reactions ---
  smile: face(eyes + smile),
  grin: face(eyes + '<path d="M8 14h8q-1 4-4 4t-4-4z"/>'),
  wink: face(dot(15, 10) + '<path d="M7.5 10h3"/>' + smile),
  joy: face('<path d="M7.5 10.5l1.5-1.5 1.5 1.5M13.5 10.5l1.5-1.5 1.5 1.5M7.5 14h9q-1.5 5-4.5 5t-4.5-5z"/><path d="M4.5 12.5v2.5M19.5 12.5v2.5"/>'),
  cool: face('<path d="M4.5 9.5h15M7 9.5v1.5a2 2 0 0 0 4 0V9.5M13 9.5v1.5a2 2 0 0 0 4 0V9.5"/><path d="M7 9.5h4v1.5a2 2 0 0 1-4 0zM13 9.5h4v1.5a2 2 0 0 1-4 0z" fill="currentColor"/>' + smile),
  wow: face(eyes + '<circle cx="12" cy="15.5" r="2"/>'),
  thinking: face(dot(9, 10.5) + dot(15, 10.5) + '<path d="M13.5 7.5l3-.8M7 8h3M9.5 15.5h4.5"/>'),
  sweat: face(eyes + '<path d="M8.5 15c1.2-1 2.3-1 3.5 0s2.3 1 3.5 0"/>') + '<path d="M20 3.5c-1.2 1.7-1.8 2.7-1.8 3.5a1.8 1.8 0 0 0 3.6 0c0-.8-.6-1.8-1.8-3.5z" fill="currentColor"/>',
  sad: face(eyes + '<path d="M8.5 16.5q3.5-3 7 0"/>'),
  cry: face(eyes + '<path d="M8.5 16.5q3.5-3 7 0M15 12v3.5"/>'),
  angry: face(dot(9, 11) + dot(15, 11) + '<path d="M7 8l3.5 1.5M17 8l-3.5 1.5M9 16.5q3-2 6 0"/>'),
  facepalm: '<circle cx="10" cy="12.5" r="8"/><path d="M4.5 11.5q1 1 2 0M4.5 9l2.5.5"/><g transform="rotate(-20 13 13) translate(2 -.5) scale(1.05)"><path d="M8 20V8a1.2 1.2 0 0 1 2.4 0V4.5a1.2 1.2 0 0 1 2.4 0V5a1.2 1.2 0 0 1 2.4 0v2a1.2 1.2 0 0 1 2.4 0v9a4 4 0 0 1-4 4zM10.4 8v5M12.8 5v8.5M15.2 7v6" fill="var(--paper)"/></g>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.5 1.2 4.5 3 5.8V20h10v-3.2c1.8-1.3 3-3.3 3-5.8a8 8 0 0 0-8-8z"/>' + dot(9, 11, 1.8) + dot(15, 11, 1.8) + '<path d="M10 17v3M14 17v3"/>',
  ghost: '<path d="M12 3a7 7 0 0 0-7 7v11l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V10a7 7 0 0 0-7-7z"/>' + dot(9.5, 10, 1.2) + dot(14.5, 10, 1.2),
  eyes: '<ellipse cx="7.5" cy="12" rx="3.5" ry="5"/><ellipse cx="16.5" cy="12" rx="3.5" ry="5"/>' + dot(8.5, 12.5, 1.5) + dot(17.5, 12.5, 1.5),
  shrug: '<circle cx="12" cy="5.5" r="2.5"/><path d="M12 8v6.5M9 21l3-6.5 3 6.5M12 11l-4.5-1.5L4 6M12 11l4.5-1.5L20 6M4 6l-1.5.5M20 6l1.5.5"/>',
  thumbsup: '<path d="M7 11v9H4v-9zM7 11l3.5-7c1.5 0 2.5 1 2.5 2.5V10h5a2 2 0 0 1 2 2l-1.5 6a2 2 0 0 1-2 2H7"/>',
  thumbsdown: '<path d="M7 13V4H4v9zM7 13l3.5 7c1.5 0 2.5-1 2.5-2.5V14h5a2 2 0 0 0 2-2l-1.5-6a2 2 0 0 0-2-2H7"/>',
  wave: '<path d="M7 12V7a1.5 1.5 0 0 1 3 0v4M10 10V5a1.5 1.5 0 0 1 3 0v6M13 10.5V6a1.5 1.5 0 0 1 3 0v6M16 12V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3M3.5 6L5 7.5M2.5 10H4.5"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  fire: '<path d="M12 21c-4 0-6.5-2.5-6.5-6 0-3 2-5 3.5-7 .5 1.5 1 2.5 2 3 0-3 1-6 4-8 0 3 1.5 4.5 3 6.5 1 1.5 1.5 3 1.5 4.5 0 4-3 7-7.5 7z"/><path d="M12 21c-2 0-3.5-1.5-3.5-3.5 0-2 1.5-3 2.5-4.5 1 1 1.5 2 1 3.5 1.5-.5 2.5-1.5 2.5-3 1 1 1.5 2.5 1.5 4 0 2-1.5 3.5-4 3.5z"/>',
  100: '<path d="M3.5 8.5L6 7v9M11 7a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 11 7zM18 7a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 18 7zM4 19.5h16"/>',
  party: '<path d="M4 20l4-11 7 7zM8 9l7 7M14 5l1-2M18 8l2-1M16 12l1.5 1M12 3v1.5"/>' + dot(19, 4) + dot(20.5, 13),
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 14v3M10 17h4l1 3H9z"/>',
  crown: '<path d="M4 18h16M4 18L3 7l5 4 4-6 4 6 5-4-1 11z"/>' + dot(12, 13, 1.2),
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11L6 3h4l2 5 2-5h4l-2.5 8"/>',
  dart: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>' + dot(12, 12, 1.2) + '<path d="M12 12l8-8M16 4h4v4"/>',
  zzz: '<path d="M4 15h5l-5 5h5M11 9h4l-4 4h4M16 3h4l-4 4h4"/>',
  rocket: '<path d="M12 3c3 2 4.5 6 4.5 9.5l-1.5 3h-6l-1.5-3C7.5 9 9 5 12 3z"/><circle cx="12" cy="10" r="1.5"/><path d="M9 15.5l-3 3v-4M15 15.5l3 3v-4M10.5 18.5L12 21l1.5-2.5"/>',

  // --- The traveller's set ---
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7.5h14M5 16.5h14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5zM12 3v2M12 19v2M3 12h2M19 12h2"/><path d="M15.5 8.5l-2 5-1.5-1.5z" fill="currentColor"/>',
  pin: '<path d="M12 22s7-7.2 7-12a7 7 0 0 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',
  passport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/>',
  stamp: '<path d="M10 4h4v6h-4zM7 10h10a3 3 0 0 1 3 3v3H4v-3a3 3 0 0 1 3-3zM5 19h14v2H5z"/>',
  ticket: '<path d="M3 9V6h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M13 6v2M13 11v2M13 16v2"/>',
  suitcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 7v13M16 7v13"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  plane: '<g transform="rotate(45 12 12)"><path d="M12 2.5c1 0 1.5 1.2 1.5 2.5V10l7 4v2l-7-2v4.5l2.5 2V22l-4-1-4 1v-1.5l2.5-2V14l-7 2v-2l7-4V5c0-1.3.5-2.5 1.5-2.5z"/></g>',
  ship: '<path d="M3 15l9-3 9 3-2 5H5zM6 12V8h12v4M12 8V4M9 8V6h6v2"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 17l-2 4M15 17l2 4"/>' + dot(9, 13.5) + dot(15, 13.5),
  car: '<path d="M4 16l2-6a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 10l2 6M3 16h18v3H3zM5 19v2M19 19v2"/>' + dot(7, 17.5) + dot(17, 17.5),
  mountain: '<path d="M3 20l6.5-13 4 7.5M13 12l2-3 6 11H3M7.8 10.5L9.5 9l1.7 1.5"/>',
  beach: '<path d="M4 12a8.5 8.5 0 0 1 17 0zM12.5 12v9M3 21h18M8 12c0-4 2-7.5 4.5-8.5M17 12c0-4-2-7.5-4.5-8.5"/>',
  palm: '<path d="M11 21c.5-5 1.5-9 4-12M15 9q-5-1-8 3q4-1 8 0zM15 9q-3-4-1-7q2 2 2 7zM15 9q2-4 6-3q-3 1-5 4zM15 9q5 0 6 4q-3-2-6-2z"/>' + dot(14, 10.5) + dot(16.5, 11),
  cactus: '<path d="M9.5 21V6a2.5 2.5 0 0 1 5 0v15M9.5 13H7a2 2 0 0 1-2-2V8M14.5 11h2.5a2 2 0 0 0 2-2V6M7 21h10"/>',
  castle: '<path d="M4 21V9l2-2V4h2v2h2V4h2v2h2V4h2v2h2V4h2v3l2 2v12zM10 21v-5a2 2 0 0 1 4 0v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  rain: '<path d="M7 15a4 4 0 0 1-.5-8A6 6 0 0 1 18 8a3.5 3.5 0 0 1 0 7zM8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2"/>',
  rainbow: '<path d="M3 17a9 9 0 0 1 18 0M6.5 17a5.5 5.5 0 0 1 11 0M10 17a2 2 0 0 1 4 0"/>',
  sea: '<path d="M2 10c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
  flag: '<path d="M5 21V4M5 4h13l-2 4 2 4H5"/><path d="M5 4h4v4H5zM13 4h4v4h-4zM9 8h4v4H9z" fill="currentColor" stroke="none"/>',
  signpost: '<path d="M5 5h11l3 2.5L16 10H5zM19 13H8l-3 2.5L8 18h11zM12 3v2M12 10v3M12 18v3M9 21h6"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v3l5 6-5 6v3M17 3v3l-5 6 5 6v3M9.5 19.5h5"/>',
  penguin: '<path d="M12 3c-3.5 0-5 3-5 7v6a5 5 0 0 0 10 0v-6c0-4-1.5-7-5-7zM7 11l-2 5M17 11l2 5M9 21h2M13 21h2"/>' + dot(10.5, 7, 0.9) + dot(13.5, 7, 0.9) + '<path d="M11 9h2l-1 1.5z" fill="currentColor"/>',
};

export const EMOJI: readonly Emoji[] = Object.entries(GLYPHS).map(([code, glyph]) => ({ code, glyph }));

const SHORTCODE = /:([a-z0-9_]+):/gi;

/**
 * What makes the drawings look pencilled: a little noise bends every line
 * and a second, grainier noise breaks the stroke's alpha up like graphite
 * on paper. Defined once per page - `glyphSvg` refers to it by id, so the
 * defs have to be in the document (see `PENCIL_DEFS`). The frequencies are
 * in the 24-grid's units, so the effect scales with the glyph.
 */
export const PENCIL_FILTER_ID = 'pencil';
export const PENCIL_DEFS = `<svg class="glyph-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="${PENCIL_FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="3" result="wobble"/>
    <feDisplacementMap in="SourceGraphic" in2="wobble" scale="1" xChannelSelector="R" yChannelSelector="G" result="bent"/>
    <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed="11" result="grain"/>
    <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .6 0 0 0 .7" result="graphite"/>
    <feComposite in="bent" in2="graphite" operator="in"/>
  </filter>
</defs></svg>`;

/** The drawing for one code as an inline SVG - `null` for a code nobody knows. */
export function glyphSvg(code: string): string | null {
  const glyph = GLYPHS[code.toLowerCase()];
  if (!glyph) return null;
  // The faint stroke underneath, a touch turned and shifted, is the sketch's first go.
  return `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=":${code.toLowerCase()}:">`
    + `<g filter="url(#${PENCIL_FILTER_ID})"><g opacity=".35" transform="rotate(-2.5 12 12) translate(.35 .25)">${glyph}</g>${glyph}</g></svg>`;
}

/**
 * `:shrug:` becomes its drawing, unknown codes stay as they are. Expects
 * text that is already HTML-escaped - the shortcodes survive escaping, the
 * markup put in here must not be escaped again.
 */
export function renderGlyphs(escapedText: string): string {
  return escapedText.replace(SHORTCODE, (whole, code: string) => glyphSvg(code) ?? whole);
}

/**
 * The shortcode being typed at the caret: from the last `:` that has only
 * word characters after it up to the caret. `null` when there is none - or
 * the code is already closed.
 */
export function shortcodeAt(text: string, caret: number): { start: number; query: string } | null {
  const head = text.slice(0, caret);
  const m = /(?:^|\s):([a-z0-9_]*)$/i.exec(head);
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]!.toLowerCase() };
}

/** Codes starting with the query first, then those containing it - a handful at most. */
export function suggest(query: string, max = 6): Emoji[] {
  const starts = EMOJI.filter((e) => e.code.startsWith(query));
  const contains = query ? EMOJI.filter((e) => !e.code.startsWith(query) && e.code.includes(query)) : [];
  return [...starts, ...contains].slice(0, max);
}

/** Nothing but known shortcodes (and spaces) - those get shown big, like a stamp. */
export function glyphsOnly(text: string): boolean {
  const known = (code: string): boolean => GLYPHS[code.toLowerCase()] !== undefined;
  if (![...text.matchAll(SHORTCODE)].some((m) => known(m[1]!))) return false;
  return text.replace(SHORTCODE, (whole, code: string) => (known(code) ? '' : whole)).trim() === '';
}
