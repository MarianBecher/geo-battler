import { describe, expect, it } from 'vitest';
import { INSTRUMENT_NAMES, type Score } from 'tiny-orchestra';
import type { Anthem } from 'anthem-scores';
import { anthemScore, cadenceScore, chord, dominantOf, HOME_KEY, lobbyTheme, midi, travelTheme } from '../src/audio/music.ts';

/** A score tiny-orchestra can play: known instruments, sane notes inside the length. */
function expectValid(score: Score): void {
  expect(score.bpm).toBeGreaterThan(0);
  expect(score.lengthBeats).toBeGreaterThan(0);
  const length = score.lengthBeats ?? Infinity;
  for (const part of score.parts) {
    expect(INSTRUMENT_NAMES).toContain(part.instrument);
    for (const [beat, pitch, len, velocity] of part.notes) {
      expect(beat).toBeGreaterThanOrEqual(0);
      expect(beat).toBeLessThan(length);
      expect(len).toBeGreaterThan(0);
      if (pitch !== null) {
        expect(Number.isInteger(pitch)).toBe(true);
        expect(pitch).toBeGreaterThanOrEqual(21);
        expect(pitch).toBeLessThanOrEqual(108);
      }
      if (velocity !== undefined) {
        expect(velocity).toBeGreaterThan(0);
        expect(velocity).toBeLessThanOrEqual(1);
      }
    }
  }
}

describe('midi', () => {
  it('names notes the usual way', () => {
    expect(midi('F#5')).toBe(78);
    expect(midi('C4')).toBe(60);
    expect(midi('A4')).toBe(69);
    expect(midi('Bb5')).toBe(82);
    expect(midi('C-1')).toBe(0);
  });

  it('rejects nonsense', () => {
    expect(() => midi('H2')).toThrow();
    expect(() => midi('C')).toThrow();
  });
});

describe('chord', () => {
  it('parses triads', () => {
    expect(chord('D')).toEqual({ pcs: [2, 6, 9], bass: 2 });
    expect(chord('Bm')).toEqual({ pcs: [11, 2, 6], bass: 11 });
  });

  it('parses qualities and slash basses', () => {
    expect(chord('E7/G#')).toEqual({ pcs: [4, 8, 11, 2], bass: 8 });
    expect(chord('Gmaj7')).toEqual({ pcs: [7, 11, 2, 6], bass: 7 });
    expect(chord('Asus4')).toEqual({ pcs: [9, 2, 4], bass: 9 });
    expect(chord('D/F#').bass).toBe(6);
    expect(chord('Bmadd9').pcs).toEqual([11, 1, 2, 6]);
  });

  it('rejects unknown symbols', () => {
    expect(() => chord('Dsus9')).toThrow();
  });
});

describe('themes', () => {
  it('builds a valid lobby waltz of two passes', () => {
    const score = lobbyTheme();
    expectValid(score);
    expect(score.beatsPerBar).toBe(3);
    expect(score.lengthBeats).toBe(2 * 16 * 3);
  });

  it('builds a valid travel theme', () => {
    const score = travelTheme();
    expectValid(score);
    expect(score.beatsPerBar).toBe(4);
    expect(score.lengthBeats).toBe(2 * 16 * 4);
  });

  it('builds a valid cadence', () => {
    expectValid(cadenceScore());
  });
});

const sample: Anthem = {
  code: 'XX',
  title: 'Test anthem',
  composer: 'traditional',
  source: 'https://example.org',
  author: 'nobody',
  license: 'CC0',
  bpm: 110,
  tempoGuessed: false,
  beatsPerBar: 3,
  pickupBeats: 0,
  key: { tonic: 2, mode: 'major' },
  lengthBeats: 6,
  melody: [[0, 69, 2], [2, 67, 1], [3, 66, 2], [5, 62, 1]],
  bass: [[0, 50, 2], [2, 38, 1], [3, 50, 3]],
  inner: [[0, [62, 66], 2], [2, [57, 61], 1], [3, [57, 62], 3]],
};

describe('anthemScore', () => {
  it('orchestrates melody, bass and inner voices', () => {
    const score = anthemScore(sample);
    expectValid(score);
    expect(score.bpm).toBe(110);
    expect(score.lengthBeats).toBe(6);
    const part = (name: string) => score.parts.find((p) => p.instrument === name);
    expect(part('trumpet')?.notes).toEqual(sample.melody);
    expect(part('tuba')?.notes.length).toBe(sample.bass.length);
    expect(part('violas')?.notes.length).toBe(6);
    // Ends on the tonic D: the timpani joins on the last note.
    expect(part('timpani')?.notes).toEqual([[5, 50, 1]]);
  });

  it('adds a pedal and a lower horn when there is only a melody', () => {
    const score = anthemScore({ ...sample, bass: [], inner: [], tempoGuessed: true, bpm: 100 });
    expectValid(score);
    expect(score.bpm).toBe(84);
    expect(score.parts.some((p) => p.instrument === 'tuba')).toBe(false);
    const horn = score.parts.find((p) => p.instrument === 'horn');
    expect(horn?.notes[0]).toEqual([0, 57, 2]);
  });

  it('leaves the timpani out when the ending is not root or fifth', () => {
    const melody: Anthem['melody'] = [[0, 69, 3], [3, 66, 3]]; // ends on the third
    const score = anthemScore({ ...sample, melody });
    expect(score.parts.find((p) => p.instrument === 'timpani')?.notes).toEqual([]);
  });
});

describe('dominantOf', () => {
  it('builds the dominant seventh of D major on A', () => {
    const d = dominantOf(HOME_KEY);
    expect(d.bass % 12).toBe(9); // A
    expect(d.mid.map((m) => m % 12)).toEqual([1, 7]); // C# and G
    expect(d.top % 12).toBe(4); // E, the fifth of A
    expect(d.bass).toBeGreaterThanOrEqual(38);
    expect(d.bass).toBeLessThan(50);
  });

  it('follows the key of the anthem', () => {
    expect(dominantOf({ tonic: 0, mode: 'minor' }).bass % 12).toBe(7); // G for C minor
  });
});
