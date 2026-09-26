// The notes - what is played, not how.
//
// Everything here is plain data in tiny-orchestra's score format: parts with
// an instrument and notes as [beat, MIDI, length in beats, velocity?]. The
// accompaniment is generated from chord symbols instead of being written out
// note by note - that keeps every score to a handful of lines, and a changed
// harmony drags harp, pizzicato and pad along by itself.
//
// Both themes are in D major and share a motif (F# - A - D, the start of the
// flute melody). It returns in the horn while guessing, so lobby and round
// sound like the same film.

import type { Part, Score, ScoreNote } from 'tiny-orchestra';
import type { Anthem, Key } from 'anthem-scores';

export type MusicKey = Key;

/** A plain three-number note: [beat, midi, lengthBeats]. */
type Note3 = [beat: number, midi: number, lengthBeats: number];

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#5" -> 78. Usual octave numbering: C4 is middle C. */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Unknown note: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PC[m[1]!]! + acc;
}

const QUALITY: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  add9: [0, 2, 4, 7],
  madd9: [0, 2, 3, 7],
  m9: [0, 2, 3, 7, 10],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
};

export interface Chord {
  /** Pitch classes, root first. */
  pcs: number[];
  /** Pitch class of the bass (the slash note, or the root). */
  bass: number;
}

/** "E7/G#" -> pitch classes and bass note. */
export function chord(symbol: string): Chord {
  const m = /^([A-G][#b]?)(maj7|madd9|m9|m7|m|7sus4|sus4|add9|7)?(?:\/([A-G][#b]?))?$/.exec(symbol);
  if (!m) throw new Error(`Unknown chord: ${symbol}`);
  const pcOf = (n: string): number => midi(`${n}0`) % 12;
  const root = pcOf(m[1]!);
  return {
    pcs: QUALITY[m[2] ?? '']!.map((i) => (root + i) % 12),
    bass: pcOf(m[3] ?? m[1]!),
  };
}

/** Put a pitch class into the octave starting at `lo`. */
const place = (pc: number, lo: number): number => lo + ((((pc - lo) % 12) + 12) % 12);

/** Close position from `lo` up - enough for pads, the reverb joins the rest. */
const voicing = (pcs: readonly number[], lo: number): number[] => pcs.map((pc) => place(pc, lo)).sort((a, b) => a - b);

/** Highest and second highest note of a voicing (voicings have at least three). */
const top1 = (v: readonly number[]): number => v[v.length - 1]!;
const top2 = (v: readonly number[]): number => v[v.length - 2]!;

type TuneNote = [bar: number, beat: number, name: string, length: number];

/** Melody written in bars: [[bar, beat, note, length], ...] -> score notes. */
function tune(bars: readonly TuneNote[], beatsPerBar: number, offset = 0, transpose = 0): ScoreNote[] {
  return bars.map(([bar, beat, name, len]): ScoreNote => [offset + bar * beatsPerBar + beat, midi(name) + transpose, len]);
}

// --- Lobby: the travel theme -------------------------------------------------
//
// A waltz, because triple time sounds like setting off: harp and pizzicato
// as "oom-pah-pah", the flute on top. The second pass first drops the melody
// and then gives it to the oboe - whoever waits in the lobby should not hear
// the same flute every thirty seconds.

const LOBBY_BPM = 100;
const LOBBY_CHORDS = [
  'D', 'D', 'G/D', 'D', 'Bm', 'G', 'E7/G#', 'A7',
  'D', 'D', 'G', 'Gm', 'D/A', 'A7', 'D', 'D',
];

// bar (0-based), beat, note, length
const LOBBY_TUNE: TuneNote[] = [
  [0, 0, 'F#5', 2], [0, 2, 'E5', 0.5], [0, 2.5, 'F#5', 0.5],
  [1, 0, 'A5', 3],
  [2, 0, 'B5', 1.5], [2, 1.5, 'A5', 0.5], [2, 2, 'G5', 1],
  [3, 0, 'F#5', 3],
  [4, 0, 'D5', 1], [4, 1, 'F#5', 1], [4, 2, 'B5', 1],
  [5, 0, 'D6', 1.5], [5, 1.5, 'B5', 0.5], [5, 2, 'G5', 1],
  [6, 0, 'G#5', 1], [6, 1, 'B5', 1], [6, 2, 'D6', 1],
  [7, 0, 'C#6', 2], [7, 2, 'A5', 1],
  [8, 0, 'F#5', 2], [8, 2, 'E5', 0.5], [8, 2.5, 'F#5', 0.5],
  [9, 0, 'D6', 3],
  [10, 0, 'B5', 1], [10, 1, 'D6', 1], [10, 2, 'B5', 1],
  [11, 0, 'Bb5', 2], [11, 2, 'A5', 0.5], [11, 2.5, 'G5', 0.5],
  [12, 0, 'F#5', 1.5], [12, 1.5, 'A5', 0.5], [12, 2, 'D6', 1],
  [13, 0, 'A5', 1.5], [13, 1.5, 'G5', 0.5], [13, 2, 'E5', 1],
  [14, 0, 'D5', 3],
];

export function lobbyTheme(): Score {
  const B = 3;
  const harp: ScoreNote[] = [];
  const celli: ScoreNote[] = [];
  const pizz: ScoreNote[] = [];
  const violas: ScoreNote[] = [];
  const glock: ScoreNote[] = [];

  for (let pass = 0; pass < 2; pass++) {
    LOBBY_CHORDS.forEach((symbol, i) => {
      const at = (pass * LOBBY_CHORDS.length + i) * B;
      const { pcs, bass } = chord(symbol);
      const low = place(bass, 38);
      const up = voicing(pcs, 62);

      // Harp: from low up and back down a little at the top - six quavers per bar.
      const arp = voicing(pcs, 50);
      const run = [low, ...arp, arp[0]! + 12, arp[1]! + 12].slice(0, 6);
      run.forEach((m, k) => harp.push([at + k * 0.5, m, 0.5, k === 0 ? 0.55 : 0.4]));

      celli.push([at, low, 1]);
      for (const beat of [1, 2]) {
        pizz.push([at + beat, top2(up), 0.5], [at + beat, top1(up), 0.5]);
      }
      for (const m of voicing(pcs, 55)) violas.push([at, m, B]);

      // Second pass, first half: a few bell notes instead of the melody.
      if (pass === 1 && i < 8 && i % 2 === 0) glock.push([at, top1(up) + 12, 2]);
    });
  }

  const bars = LOBBY_CHORDS.length;
  const oboe = tune(LOBBY_TUNE.filter(([bar]) => bar >= 8), B, bars * B);

  return {
    bpm: LOBBY_BPM,
    beatsPerBar: B,
    lengthBeats: 2 * bars * B,
    parts: [
      { instrument: 'harp', velocity: 0.45, notes: harp, pan: -0.25 },
      { instrument: 'celliPizz', velocity: 0.55, notes: celli },
      { instrument: 'violinsPizz', velocity: 0.28, notes: pizz, pan: 0.2 },
      { instrument: 'violas', velocity: 0.18, notes: violas },
      { instrument: 'flute', velocity: 0.5, notes: tune(LOBBY_TUNE, B), pan: 0.1 },
      { instrument: 'oboe', velocity: 0.45, notes: oboe, pan: 0.15 },
      { instrument: 'glockenspiel', velocity: 0.22, notes: glock, pan: 0.3 },
      { instrument: 'triangle', velocity: 0.2, notes: [[0, null, 1], [bars * B, null, 1]] },
    ],
  };
}

// --- Guessing: on the road ---------------------------------------------------
//
// While guessing people think, they do not dance: broad string pads, slowly
// wandering harmonies, the harp only trickles. The E major over D in the bass
// (Lydian) is the wanderlust - it sounds like distance without pushing.
// Melody only comes in fragments, alternating oboe and horn.

const GAME_BPM = 66;
const GAME_CHORDS = [
  'Dadd9', 'E/D', 'Bm7', 'Gmaj7', 'D/F#', 'Em7', 'G/A', 'A',
  'Dadd9', 'E/D', 'F#m7', 'Bmadd9', 'Gmaj7', 'Em9', 'Asus4', 'A7',
];

const GAME_OBOE: TuneNote[] = [ // first pass, bars 9-12
  [8, 0, 'A5', 2], [8, 2, 'F#5', 1], [8, 3, 'E5', 1],
  [9, 0, 'G#5', 3], [9, 3, 'F#5', 1],
  [10, 0, 'A5', 2], [10, 2, 'E5', 2],
  [11, 0, 'F#5', 4],
];

const GAME_HORN: TuneNote[] = [ // second pass, bars 5-8: the motif from the lobby
  [4, 0, 'F#4', 2], [4, 2, 'A4', 2],
  [5, 0, 'D5', 3], [5, 3, 'C#5', 1],
  [6, 0, 'B4', 2], [6, 2, 'A4', 2],
  [7, 0, 'A4', 4],
];

export function travelTheme(): Score {
  const B = 4;
  const bars = GAME_CHORDS.length;
  const violins: ScoreNote[] = [];
  const violas: ScoreNote[] = [];
  const celli: ScoreNote[] = [];
  const basses: ScoreNote[] = [];
  const harp: ScoreNote[] = [];
  const glock: ScoreNote[] = [];

  for (let pass = 0; pass < 2; pass++) {
    GAME_CHORDS.forEach((symbol, i) => {
      const at = (pass * bars + i) * B;
      const { pcs, bass } = chord(symbol);
      const mid = voicing(pcs, 57);

      for (const m of mid) violas.push([at, m, B]);
      violins.push([at, place(top1(pcs), 69), B], [at, place(pcs[1]!, 72), B]);
      celli.push([at, place(bass, 38), B]);
      if (i % 4 === 0) basses.push([at, place(bass, 28), 2 * B]);

      // Odd bars: a run upwards. Even bars: only two notes as an echo.
      const arp = voicing(pcs, 62);
      if (i % 2 === 0) {
        [place(bass, 50), ...arp, arp[0]! + 12].slice(0, 6)
          .forEach((m, k) => harp.push([at + k * 0.5, m, 1, 0.35 + k * 0.03]));
      } else {
        harp.push([at + 2, top1(arp) + 12, 1, 0.3], [at + 3, arp[1]! + 12, 1, 0.25]);
      }

      if (i % 4 === 2) glock.push([at + 2, top1(arp) + 24, 2]);
    });
  }

  return {
    bpm: GAME_BPM,
    beatsPerBar: B,
    lengthBeats: 2 * bars * B,
    parts: [
      { instrument: 'violas', velocity: 0.22, notes: violas, pan: 0.15 },
      { instrument: 'violins', velocity: 0.16, notes: violins, pan: -0.2 },
      { instrument: 'celli', velocity: 0.26, notes: celli, pan: 0.25 },
      { instrument: 'basses', velocity: 0.22, notes: basses },
      { instrument: 'harp', velocity: 0.4, notes: harp, pan: -0.3 },
      { instrument: 'glockenspiel', velocity: 0.16, notes: glock, pan: 0.35 },
      { instrument: 'oboe', velocity: 0.34, notes: tune(GAME_OBOE, B), pan: 0.1 },
      { instrument: 'horn', velocity: 0.34, notes: tune(GAME_HORN, B, bars * B), pan: -0.1 },
    ],
  };
}

// --- Arrival: the anthem -----------------------------------------------------
//
// The anthem data (anthem-scores) only brings melody, bass and inner voices -
// the orchestration comes from here: melody in trumpet and violins, the inner
// voices in horn and viola, the bass in celli, double basses and tuba. An
// anthem is a brass piece, but with strings beneath it the brass band turns
// into an orchestra.

const clampBpm = (bpm: number): number => Math.min(128, Math.max(56, bpm || 80));

// When the source names no tempo, it carries the default of its notation
// program (100). For an anthem that is usually too brisk - rather stately.
const GUESSED_BPM = 84;

/** Shift a note list - for octave positions and the bass. */
const shift = (notes: readonly Note3[], by: number): Note3[] => notes.map(([beat, m, len]): Note3 => [beat, m + by, len]);

/** Bring the lowest note into an octave the instrument actually has. */
function octaveInto(notes: readonly Note3[], lo: number): number {
  if (!notes.length) return 0;
  const min = Math.min(...notes.map((n) => n[1]));
  return Math.ceil((lo - min) / 12) * 12;
}

export function anthemScore(anthem: Anthem): Score {
  const { melody, bass, key } = anthem;
  const inner = anthem.inner.flatMap(([beat, notes, len]) => notes.map((m): Note3 => [beat, m, len]));
  const last = melody[melody.length - 1];
  const tonic = key.tonic;
  const rel = (m: number): number => (((m - tonic) % 12) + 12) % 12;
  const bar = anthem.beatsPerBar;
  const firstDownbeat = anthem.pickupBeats;

  const bassShift = octaveInto(bass, 36);
  const innerShift = octaveInto(inner, 53);

  // Timpani only on the final note, and only when that is surely the root
  // or the fifth - everybody hears a timpani on the wrong degree.
  const ending = last && (rel(last[1]) === 0 || rel(last[1]) === 7) ? last : null;
  const timp: Note3[] = ending ? [[ending[0], place(ending[1] % 12, 41), ending[2]]] : [];

  // Many sources only have the melody. In unison that sounds like a brass
  // band on the market square - so the horn joins an octave lower and a
  // pedal point goes into the bass: in the first bar the tonic (almost every
  // anthem starts on it), at the end the note it finishes on.
  const lowParts: Part[] = [];
  if (!bass.length && !inner.length) {
    const pedal: Note3[] = [[0, place(tonic, 38), firstDownbeat + bar]];
    if (ending) pedal.push([ending[0], place(ending[1] % 12, 38), ending[2]]);
    lowParts.push(
      { instrument: 'horn', velocity: 0.38, notes: shift(melody, -12), pan: 0.2 },
      { instrument: 'celli', velocity: 0.4, notes: pedal, pan: 0.25 },
      { instrument: 'basses', velocity: 0.35, notes: shift(pedal, -12) },
    );
  } else {
    lowParts.push(
      { instrument: 'horn', velocity: 0.42, notes: shift(inner, innerShift), pan: 0.2 },
      { instrument: 'violas', velocity: 0.35, notes: shift(inner, innerShift) },
      { instrument: 'celli', velocity: 0.45, notes: shift(bass, bassShift), pan: 0.25 },
      { instrument: 'basses', velocity: 0.4, notes: shift(bass, bassShift - 12) },
      { instrument: 'tuba', velocity: 0.3, notes: shift(bass, bassShift - 12) },
    );
  }

  // The flute doubles an octave higher - but only while it can get up there,
  // otherwise the pitch shifting squeaks.
  const top = Math.max(...melody.map((n) => n[1]));
  const flute = top + 12 <= 93 ? shift(melody, 12) : [];

  return {
    bpm: clampBpm(anthem.tempoGuessed ? GUESSED_BPM : anthem.bpm),
    beatsPerBar: bar,
    lengthBeats: anthem.lengthBeats,
    parts: [
      { instrument: 'trumpet', velocity: 0.55, notes: [...melody], pan: -0.05 },
      { instrument: 'violins', velocity: 0.5, notes: [...melody], pan: -0.2 },
      { instrument: 'flute', velocity: 0.28, notes: flute, pan: 0.1 },
      ...lowParts,
      { instrument: 'timpani', velocity: 0.55, notes: timp },
      { instrument: 'cymbal', velocity: 0.35, variant: 'soft', notes: [[firstDownbeat, null, 2]] },
    ],
  };
}

export interface Dominant {
  bass: number;
  mid: number[];
  top: number;
}

/**
 * The transition into the anthem: a dominant seventh chord of its key.
 * After it the ear expects the tonic - and that is exactly where the anthem
 * comes in, whatever key the round was in before.
 */
export function dominantOf(key: MusicKey): Dominant {
  const root = (key.tonic + 7) % 12;
  return {
    bass: place(root, 38),
    mid: voicing([(root + 4) % 12, (root + 10) % 12], 58),
    top: place((root + 7) % 12, 67),
  };
}

/** Home key of both themes: D major. */
export const HOME_KEY: MusicKey = { tonic: 2, mode: 'major' };

/** Without an anthem (sea, missing data): a small cadence that still arrives. */
export function cadenceScore(): Score {
  const violins: ScoreNote[] = [];
  const violas: ScoreNote[] = [];
  const celli: ScoreNote[] = [];
  const horn: ScoreNote[] = [];
  const harp: ScoreNote[] = [];
  ['G', 'A7', 'D'].forEach((symbol, i) => {
    const { pcs, bass } = chord(symbol);
    const at = i * 2;
    const len = i === 2 ? 4 : 2;
    celli.push([at, place(bass, 38), len]);
    for (const m of voicing(pcs, 57)) violas.push([at, m, len]);
    violins.push([at, place(pcs[0]!, 69), len]);
    horn.push([at, place(pcs[1]!, 60), len]);
    if (i === 2) voicing(pcs, 62).concat(voicing(pcs, 74)).forEach((m, k) => harp.push([at + k * 0.16, m, 2]));
  });
  return {
    bpm: 84,
    beatsPerBar: 2,
    lengthBeats: 8,
    parts: [
      { instrument: 'violins', velocity: 0.4, notes: violins },
      { instrument: 'violas', velocity: 0.35, notes: violas },
      { instrument: 'celli', velocity: 0.45, notes: celli },
      { instrument: 'horn', velocity: 0.38, notes: horn },
      { instrument: 'harp', velocity: 0.45, notes: harp },
    ],
  };
}
