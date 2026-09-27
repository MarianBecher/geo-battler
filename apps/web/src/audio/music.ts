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
export const GAME_CHORDS = [
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

/** Bars of one pass of the travel theme - its chord grid repeats after that. */
export const GAME_BARS = GAME_CHORDS.length;

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

// --- Time pressure: the end of a round ---------------------------------------
//
// Not a piece of its own but a layer over the travel theme, on the same
// chord grid, so it can come in at any bar line and still fit. The tempo
// stays, the note values shrink: celli in semiquavers, basses in quavers,
// the violins in a running arpeggio. Every pitch is a tone of the chord of
// its bar - urgent, not eerie: nothing grinds against the harmony.
//
// The melody is the motif of both themes (F# - A - D: third, fifth and root
// of the chord, upwards), carried through the chord grid - bar by bar the
// call goes up, the next bar answers downwards. First in the horns, at the
// end in the trumpets, in a tighter rhythm.
//
// It must be noticed, so it enters with a blow: crash, bass drum and a
// brass chord on the downbeat, thirty seconds before the end - a call to
// attention, not yet the climax. From there every stage plays harder.
// After that three stages of three bars each (a bar is about 3.6 s, so the
// last one covers roughly the final eight seconds):
//   1. drive: strings, heartbeat, timpani, the motif in the horns
//   2. alarm: snare, fills, syncopated trombones, crashes, violas double
//      the violins an octave lower
//   3. all in: trumpets take the motif, timpani in quavers, the bass
//      drum on every beat, crashes every other bar
// A snare roll leads into each new stage. The crescendo on top comes from
// the bus, see sound.ts.

/** Bars per stage of the pressure layer. */
export const PRESSURE_BUILD_BARS = 3;
/** Velocity factor per stage: it starts held back and keeps growing. */
const STAGE_LEVEL = [0.75, 0.95, 1.15] as const;

/** Root, third and fifth of a chord - the third may be a sus note. */
function triadPcs({ pcs }: Chord): [root: number, third: number, fifth: number] {
  const root = pcs[0]!;
  const has = (i: number): boolean => pcs.includes((root + i) % 12);
  const third = [4, 3, 5, 2].find(has) ?? 4;
  return [root, (root + third) % 12, (root + 7) % 12];
}

/** Third, fifth and the root above them. */
type Degree = 't' | 'f' | 'r+';
/** Figures of the motif: [beat, degree, length, velocity]. */
type Figure = readonly (readonly [beat: number, degree: Degree, length: number, velocity: number])[];

// Up (the motif) and the answer down, alternating bar by bar.
const CALL: Figure = [[0, 't', 1, 0.5], [1, 'f', 1, 0.52], [2, 'r+', 2, 0.58]];
const ANSWER: Figure = [[0, 'r+', 1.5, 0.55], [1.5, 'f', 0.5, 0.48], [2, 't', 2, 0.5]];
// The last stage: the same, with a push in front of every step.
const CALL_URGENT: Figure = [[0, 't', 0.75, 0.55], [0.75, 't', 0.25, 0.45], [1, 'f', 1, 0.58], [2, 'r+', 2, 0.62]];
const ANSWER_URGENT: Figure = [[0, 'r+', 0.75, 0.6], [0.75, 'r+', 0.25, 0.48], [1, 'f', 0.5, 0.55], [1.5, 't', 0.5, 0.52], [2, 'f', 2, 0.58]];

/** The motif over a chord from `lo` up: third, fifth above it, root above that. */
function motifNotes(ch: Chord, lo: number): Record<Degree, number> {
  const [root, third, fifth] = triadPcs(ch);
  const t = place(third, lo);
  const f = place(fifth, t + 1);
  const top = place(root, f + 1);
  return { t, f, 'r+': top };
}

export function pressureLayer(startBar = 0): Score {
  const B = 4;
  const bars = GAME_CHORDS.length;
  const celli: ScoreNote[] = [];
  const basses: ScoreNote[] = [];
  const violins: ScoreNote[] = [];
  const violas: ScoreNote[] = [];
  const horn: ScoreNote[] = [];
  const trombone: ScoreNote[] = [];
  const trumpet: ScoreNote[] = [];
  const tuba: ScoreNote[] = [];
  const timp: ScoreNote[] = [];
  const drum: ScoreNote[] = [];
  const snare: ScoreNote[] = [];
  const roll: ScoreNote[] = [];
  const cymbal: ScoreNote[] = [];

  /** Low brass in open position: root, fifth, then the third above. */
  const openBrass = (ch: Chord): number[] => {
    const [root, third, fifth] = triadPcs(ch);
    const r = place(root, 38);
    const f = place(fifth, r + 1);
    return [r, f, place(third, f + 1)];
  };

  for (let k = 0; k < bars; k++) {
    const at = k * B;
    const ch = chord(GAME_CHORDS[(startBar + k) % bars]!);
    const [root, third, fifth] = triadPcs(ch);
    const stage = Math.min(2, Math.floor(k / PRESSURE_BUILD_BARS));
    const lastOfStage = k % PRESSURE_BUILD_BARS === PRESSURE_BUILD_BARS - 1 && stage < 2;

    // Strings - the motor. Celli accented 3+3+2, which pushes forward; the
    // violins run root - third - fifth - third through the chord.
    const low = place(ch.bass, 38);
    const accents = new Set([0, 3, 6, 8, 11, 14]);
    const r = place(root, 62);
    const run = [r, place(third, r + 1), place(fifth, r + 1), place(third, r + 1)];
    for (let s = 0; s < 4 * B; s++) {
      celli.push([at + s * 0.25, low, 0.25, accents.has(s) ? 0.6 : 0.36]);
      const v = s % 4 === 0 ? 0.34 : 0.22;
      violins.push([at + s * 0.25, run[s % 4]!, 0.25, v]);
      if (stage > 0) violas.push([at + s * 0.25, run[s % 4]! - 12, 0.25, v - 0.04]);
    }
    for (let q = 0; q < 2 * B; q++) basses.push([at + q * 0.5, place(ch.bass, 28), 0.5, q % 2 ? 0.42 : 0.58]);

    // The motif: horns first, trumpets at the end with the horns an octave below.
    const answer = k % 2 === 1;
    const figure = stage === 2 ? (answer ? ANSWER_URGENT : CALL_URGENT) : answer ? ANSWER : CALL;
    const hornAt = motifNotes(ch, stage === 2 ? 52 : 57);
    const trumpetAt = motifNotes(ch, 64);
    for (const [b, degree, len, vel] of figure) {
      horn.push([at + b, hornAt[degree], len, vel]);
      if (stage === 2) trumpet.push([at + b, trumpetAt[degree], len, vel]);
    }

    // Low brass: short chords from the second stage on, off the beat.
    if (stage > 0) {
      for (const off of [0, 2.5]) {
        for (const m of openBrass(ch)) trombone.push([at + off, m, 0.5, off ? 0.4 : 0.48]);
      }
    }
    if (stage === 2) tuba.push([at, place(ch.bass, 29), 1, 0.5]);

    // Timpani on the bass of the chord: quarters, quavers at the end.
    const drumPitch = place(ch.bass, 41);
    const step = stage === 2 ? 0.5 : 1;
    for (let b = 0; b < B; b += step) timp.push([at + b, drumPitch, step, b === 0 ? 0.55 : 0.36]);
    if (stage === 1) timp.push([at + 3.5, drumPitch, 0.25, 0.4], [at + 3.75, drumPitch, 0.25, 0.45]);

    // Bass drum: a heartbeat, at the end on every beat.
    if (stage < 2) drum.push([at, null, 1, 0.45], [at + 0.5, null, 1, 0.3], [at + 2, null, 1, 0.4], [at + 2.5, null, 1, 0.28]);
    else for (let b = 0; b < B; b++) drum.push([at + b, null, 1, b % 2 ? 0.38 : 0.5]);

    if (stage > 0) {
      snare.push([at + 1, null, 0.5, 0.45], [at + 3, null, 0.5, 0.45]);
      if (!lastOfStage) [3, 3.25, 3.5, 3.75].forEach((b, i) => snare.push([at + b, null, 0.25, 0.25 + i * 0.07]));
      if (stage === 2) snare.push([at + 1.75, null, 0.25, 0.3], [at + 2.5, null, 0.25, 0.3]);
    }
    if (lastOfStage) roll.push([at + (stage === 0 ? 0 : 2), null, stage === 0 ? B : 2, 0.45]);
    if (k === PRESSURE_BUILD_BARS || (stage === 2 && k % 2 === 0)) cymbal.push([at, null, 2]);
  }

  // Every stage plays harder than the one before - louder notes also pick
  // the brighter samples, so it grows in colour, not only in level.
  for (const notes of [celli, basses, violins, violas, horn, trombone, trumpet, tuba, timp, drum, snare, roll]) {
    for (const note of notes) {
      const stage = Math.min(2, Math.floor(note[0] / (PRESSURE_BUILD_BARS * B)));
      if (note[3] !== undefined) note[3] = Math.min(1, note[3] * STAGE_LEVEL[stage]!);
    }
  }

  // The entry: one blow so that everyone looks up - but only a call to
  // attention, the loud part comes at the end.
  const first = chord(GAME_CHORDS[startBar % bars]!);
  cymbal.push([0, null, 2, 0.42]);
  drum.push([0, null, 1, 0.5]);
  for (const m of openBrass(first)) trombone.push([0, m, 1, 0.4]);
  tuba.push([0, place(first.bass, 29), 1, 0.4]);

  return {
    bpm: GAME_BPM,
    beatsPerBar: B,
    lengthBeats: bars * B,
    parts: [
      { instrument: 'celli', notes: celli, pan: 0.2 },
      { instrument: 'basses', notes: basses },
      { instrument: 'violins', notes: violins, pan: -0.2 },
      { instrument: 'violas', notes: violas, pan: 0.1 },
      { instrument: 'horn', notes: horn, pan: 0.1 },
      { instrument: 'trombone', notes: trombone, pan: 0.25 },
      { instrument: 'trumpet', notes: trumpet, pan: -0.1 },
      { instrument: 'tuba', notes: tuba },
      { instrument: 'timpani', notes: timp },
      { instrument: 'bassdrum', variant: 'hit', notes: drum },
      { instrument: 'snare', notes: snare, pan: -0.1 },
      { instrument: 'snareRoll', notes: roll, pan: -0.1 },
      { instrument: 'cymbal', velocity: 0.45, variant: 'crash', notes: cymbal, pan: 0.15 },
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
